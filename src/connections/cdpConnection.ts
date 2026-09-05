import WebSocket, { type RawData } from 'ws'
import type { CloseHandler, Connection, MessageHandler, Unsubscribe } from '../protocol/connection'

// Primeira implementação de `Connection`: fala o Chrome DevTools Protocol (CDP)
// cru com o runtime Hermes de um device, pelo WebSocket que o Metro expõe em
// `webSocketDebuggerUrl` (/json/list). Correlaciona request/response por `id`.
//
// Sem reconexão automática neste passo do M1: se o socket cair, as requests
// pendentes rejeitam e quem chamou decide o que fazer. Interpretar a semântica
// das mensagens ("isso é um log", "isso é um erro") NÃO é papel desta camada.

const DEFAULT_CONNECT_TIMEOUT_MS = 5000
const DEFAULT_REQUEST_TIMEOUT_MS = 5000

export type CdpErrorCode =
  'connect-failed' | 'connect-timeout' | 'request-timeout' | 'request-failed' | 'connection-closed'

export class CdpError extends Error {
  constructor(
    readonly code: CdpErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CdpError'
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: CdpError) => void
  timer: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  return data.toString('utf8')
}

// O InspectorProxy do Metro (@react-native/dev-middleware) responde 401 no
// upgrade do WebSocket se o header `Origin` não bater com o dev server — é a
// proteção contra um site qualquer abrir o debugger. Um cliente Node não manda
// `Origin` sozinho, então derivamos a origem HTTP da própria URL do ws.
function httpOriginFromWsUrl(wsUrl: string): string | undefined {
  try {
    const parsed = new URL(wsUrl)
    const scheme = parsed.protocol === 'wss:' ? 'https:' : 'http:'
    return `${scheme}//${parsed.host}`
  } catch {
    return undefined
  }
}

// No Windows, o Node resolve `localhost` para o endereço IPv6 de loopback
// (`::1`) antes do IPv4 (`127.0.0.1`). O InspectorProxy aceita o upgrade do
// WebSocket normalmente nesse endereço, mas derruba a conexão logo em seguida
// (fechamento abrupto, código 1006, sem log nenhum do lado do Metro) — uma
// checagem de loopback do lado do Metro que não reconhece `::1` como
// equivalente a `127.0.0.1`. O Chrome DevTools não tem esse problema porque
// resolve para IPv4 nesse cenário. Forçamos IPv4 aqui pra igualar o comportamento.
function forceIPv4Loopback(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1'
    return parsed.toString()
  } catch {
    return url
  }
}

export interface CdpConnectionOptions {
  connectTimeoutMs?: number
  requestTimeoutMs?: number
  /** Header `Origin` do upgrade. Default: a origem HTTP derivada da URL do ws. */
  origin?: string
}

export class CDPConnection implements Connection {
  private ws: WebSocket | undefined
  // Em voo enquanto o WebSocket está em CONNECTING. Sem isto, uma segunda
  // chamada a `connect()` antes da primeira abrir cria um SEGUNDO WebSocket
  // para a mesma URL — o InspectorProxy do Metro só aceita um debugger por
  // página, então a conexão nova derruba a antiga com `connection-closed`.
  private connectingPromise: Promise<void> | undefined
  private nextId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly messageHandlers = new Set<MessageHandler>()
  private readonly closeHandlers = new Set<CloseHandler>()
  private readonly url: string
  private readonly connectTimeoutMs: number
  private readonly requestTimeoutMs: number
  private readonly origin: string | undefined

  constructor(url: string, options: CdpConnectionOptions = {}) {
    this.url = forceIPv4Loopback(url)
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.origin = options.origin ?? httpOriginFromWsUrl(this.url)
  }

  connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.connectingPromise) return this.connectingPromise

    this.connectingPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, this.origin ? { origin: this.origin } : undefined)
      this.ws = ws
      let settled = false

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        ws.terminate()
        reject(
          new CdpError(
            'connect-timeout',
            `CDP não abriu em ${this.connectTimeoutMs}ms (${this.url})`
          )
        )
      }, this.connectTimeoutMs)

      ws.on('open', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      })

      ws.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new CdpError('connect-failed', err.message))
          return
        }
        // Erro depois de conectado: o evento 'close' vem logo em seguida e
        // cuida de rejeitar as pendências e notificar os closeHandlers.
      })

      ws.on('message', (data: RawData) => this.handleMessage(data))
      ws.on('close', (code: number, reason: Buffer) =>
        this.handleClose(code, reason.toString('utf8'))
      )
    }).finally(() => {
      this.connectingPromise = undefined
    })

    return this.connectingPromise
  }

  async disconnect(): Promise<void> {
    const ws = this.ws
    this.ws = undefined
    this.rejectAllPending(new CdpError('connection-closed', 'conexão encerrada por disconnect()'))
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close()
    }
  }

  send(message: unknown): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new CdpError('connection-closed', 'send() chamado sem uma conexão CDP aberta')
      )
    }

    const id = this.nextId++
    // CDP é JSON-RPC: todo comando real (inclusive o que o Chrome DevTools manda)
    // inclui `params`, mesmo vazio. Sem ele, o InspectorProxy do Metro derruba o
    // socket cru (fechamento 1006) ao tentar processar a mensagem.
    const payload = isRecord(message) ? { params: {}, ...message, id } : { id, value: message }

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          new CdpError(
            'request-timeout',
            `sem resposta CDP para o id ${id} em ${this.requestTimeoutMs}ms`
          )
        )
      }, this.requestTimeoutMs)

      this.pending.set(id, { resolve, reject, timer })

      ws.send(JSON.stringify(payload), (err) => {
        if (!err) return
        const pending = this.pending.get(id)
        if (!pending) return
        this.pending.delete(id)
        clearTimeout(pending.timer)
        reject(new CdpError('request-failed', err.message))
      })
    })
  }

  onMessage(handler: MessageHandler): Unsubscribe {
    this.messageHandlers.add(handler)
    return () => this.messageHandlers.delete(handler)
  }

  onClose(handler: CloseHandler): Unsubscribe {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  private handleMessage(data: RawData): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawDataToString(data))
    } catch {
      return // frame não-JSON: ignora, não é problema desta camada
    }

    if (isRecord(parsed) && typeof parsed.id === 'number') {
      const pending = this.pending.get(parsed.id)
      if (!pending) return
      this.pending.delete(parsed.id)
      clearTimeout(pending.timer)

      const error = parsed.error
      if (isRecord(error)) {
        const detail = typeof error.message === 'string' ? error.message : JSON.stringify(error)
        pending.reject(new CdpError('request-failed', detail))
      } else {
        pending.resolve(parsed.result ?? null)
      }
      return
    }

    for (const handler of this.messageHandlers) handler(parsed)
  }

  private handleClose(code: number, reason: string): void {
    const detail = reason
      ? `WebSocket CDP fechado (code ${code}): ${reason}`
      : `WebSocket CDP fechado (code ${code})`
    this.rejectAllPending(new CdpError('connection-closed', detail))
    for (const handler of this.closeHandlers) handler({ code, reason })
  }

  private rejectAllPending(error: CdpError): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
