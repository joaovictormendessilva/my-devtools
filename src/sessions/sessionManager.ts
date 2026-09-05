import type { DeviceManager } from '../devices/deviceManager'
import { CDPConnection, CdpError, type CdpErrorCode } from '../connections/cdpConnection'
import type { Connection } from '../protocol/connection'
import type { DeviceSession } from '../protocol/session'
import type { ConsoleEntry } from '../protocol/console'
import type { EvaluateError, EvaluateResult } from '../protocol/evaluate'
import { parseConsoleEntry, type StackFrame } from './consoleEvents'
import { symbolicateFrames } from './symbolicate'

const CONNECT_RETRY_ATTEMPTS = 3
const CONNECT_RETRY_DELAY_MS = 500
const MAX_CONSOLE_ENTRIES = 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function evaluateErrorFromCdp(code: CdpErrorCode): EvaluateError {
  switch (code) {
    case 'connect-failed':
      return 'connect-failed'
    case 'connect-timeout':
      return 'connect-timeout'
    case 'request-timeout':
      return 'request-timeout'
    case 'connection-closed':
      return 'connection-closed'
    case 'request-failed':
      return 'evaluate-failed'
  }
}

// CDP `Runtime.evaluate` responde `{ result: RemoteObject, exceptionDetails? }`.
// Com `returnByValue: true`, o valor serializado vive em `result.result.value`.
function readEvaluateValue(
  response: unknown
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (!isRecord(response)) return { ok: false, message: 'resposta CDP inesperada' }
  if (isRecord(response.exceptionDetails)) {
    const text =
      typeof response.exceptionDetails.text === 'string'
        ? response.exceptionDetails.text
        : 'exceção no runtime'
    return { ok: false, message: text }
  }
  const remoteObject = isRecord(response.result) ? response.result : undefined
  return { ok: true, value: remoteObject ? remoteObject.value : undefined }
}

// O InspectorProxy do Metro pode aceitar o WebSocket do debugger antes de
// terminar de parear o device físico com a página do inspector — nesse caso
// ele derruba o socket cru (fechamento 1006) e loga no terminal do Metro
// "Waiting for a DevTools connection... Try again when the main bundle for
// the app is built and connection is established." Só reflete uma race de
// pareamento, não um erro real — tentamos de novo em vez de propagar pro usuário.
function isRetryableEvaluateError(error: EvaluateError): boolean {
  return error === 'connect-failed' || error === 'connect-timeout' || error === 'connection-closed'
}

type ConnectionResult =
  | { ok: true; session: DeviceSession; connection: Connection }
  | { ok: false; error: EvaluateError; message: string }

export type ConsoleEntryListener = (deviceId: string, entry: ConsoleEntry) => void
export type Unsubscribe = () => void

// Cria/mantém uma `DeviceSession` por device (ver ARCHITECTURE.md §1 e §3).
// Hoje a sessão guarda a conexão CDP e o buffer de console; é o substituto real
// do `Map` solto de conexões que existia antes disso ser formalizado.
export class SessionManager {
  private readonly sessions = new Map<string, DeviceSession>()
  private readonly consoleListeners = new Set<ConsoleEntryListener>()

  constructor(private readonly deviceManager: DeviceManager) {}

  async evaluate(deviceId: string, expression: string): Promise<EvaluateResult> {
    let result = await this.attemptEvaluate(deviceId, expression)

    for (
      let attempt = 1;
      attempt < CONNECT_RETRY_ATTEMPTS && !result.ok && isRetryableEvaluateError(result.error);
      attempt++
    ) {
      await delay(CONNECT_RETRY_DELAY_MS)
      result = await this.attemptEvaluate(deviceId, expression)
    }

    return result
  }

  /**
   * Garante a conexão CDP do device (conecta e liga a captura de console se
   * necessário) e devolve o console já capturado até agora. Chamado quando o
   * painel Console abre para um device — o histórico anterior à conexão não
   * existe (CDP não tem replay de `consoleAPICalled`), só o que vier depois.
   */
  async consoleEntries(deviceId: string): Promise<ConsoleEntry[]> {
    let result = await this.ensureConnection(deviceId)

    for (
      let attempt = 1;
      attempt < CONNECT_RETRY_ATTEMPTS && !result.ok && isRetryableEvaluateError(result.error);
      attempt++
    ) {
      await delay(CONNECT_RETRY_DELAY_MS)
      result = await this.ensureConnection(deviceId)
    }

    return this.sessions.get(deviceId)?.stores.console ?? []
  }

  /** Notifica cada novo evento de console de qualquer device, assim que chega. */
  onConsoleEntry(listener: ConsoleEntryListener): Unsubscribe {
    this.consoleListeners.add(listener)
    return () => this.consoleListeners.delete(listener)
  }

  async disposeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      const connection = session.connections.cdp
      if (connection) void connection.disconnect().catch(() => {})
    }
    this.sessions.clear()
  }

  private getOrCreateSession(deviceId: string): DeviceSession {
    let session = this.sessions.get(deviceId)
    if (!session) {
      session = { id: deviceId, deviceId, connections: {}, stores: { console: [] } }
      this.sessions.set(deviceId, session)
    }
    return session
  }

  private async ensureConnection(deviceId: string): Promise<ConnectionResult> {
    if (!this.deviceManager.list().some((device) => device.id === deviceId)) {
      return {
        ok: false,
        error: 'no-device',
        message: `device ${deviceId} não está na lista atual`
      }
    }

    const session = this.getOrCreateSession(deviceId)
    let connection = session.connections.cdp
    const isNewConnection = !connection
    if (!connection) {
      const url = this.deviceManager.debuggerUrlFor(deviceId)
      if (!url) {
        return {
          ok: false,
          error: 'no-debugger-url',
          message: 'device não expõe uma página CDP debugável'
        }
      }
      connection = new CDPConnection(url)
    }

    try {
      await connection.connect()
      session.connections.cdp = connection
      if (isNewConnection) {
        connection.onMessage((message) => this.handleCdpEvent(session, message))
        await connection.send({ method: 'Runtime.enable' })
      }
      return { ok: true, session, connection }
    } catch (error) {
      if (error instanceof CdpError) {
        if (error.code !== 'request-failed') {
          // Conexão suja (não abriu / caiu): descarta para a próxima tentativa recriar.
          session.connections.cdp = undefined
          void connection.disconnect().catch(() => {})
        }
        return { ok: false, error: evaluateErrorFromCdp(error.code), message: error.message }
      }
      return {
        ok: false,
        error: 'evaluate-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private handleCdpEvent(session: DeviceSession, message: unknown): void {
    const parsed = parseConsoleEntry(message)
    if (!parsed) return
    void this.publishConsoleEntry(session, parsed.entry, parsed.frames)
  }

  // Assíncrono por causa da symbolication (consulta o Metro). Isso pode fazer
  // esta entrada aparecer fora de ordem em relação a outra que chegou logo
  // depois mas não precisou symbolicar — aceitável nesta fatia, não vale a
  // complexidade de uma fila de ordenação pra um caso raro.
  private async publishConsoleEntry(
    session: DeviceSession,
    entry: ConsoleEntry,
    frames: StackFrame[]
  ): Promise<void> {
    const stack = await symbolicateFrames(frames)
    const resolved: ConsoleEntry = stack ? { ...entry, text: `${entry.text}\n${stack}` } : entry

    session.stores.console.push(resolved)
    if (session.stores.console.length > MAX_CONSOLE_ENTRIES) session.stores.console.shift()

    for (const listener of this.consoleListeners) listener(session.deviceId, resolved)
  }

  private async attemptEvaluate(deviceId: string, expression: string): Promise<EvaluateResult> {
    const ensured = await this.ensureConnection(deviceId)
    if (!ensured.ok) return ensured

    try {
      const response = await ensured.connection.send({
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true }
      })
      const value = readEvaluateValue(response)
      return value.ok
        ? { ok: true, value: value.value }
        : { ok: false, error: 'evaluate-failed', message: value.message }
    } catch (error) {
      if (error instanceof CdpError) {
        if (error.code !== 'request-failed') {
          ensured.session.connections.cdp = undefined
          void ensured.connection.disconnect().catch(() => {})
        }
        return { ok: false, error: evaluateErrorFromCdp(error.code), message: error.message }
      }
      return {
        ok: false,
        error: 'evaluate-failed',
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
