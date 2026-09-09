import type { DeviceManager } from '../devices/deviceManager'
import { CDPConnection, CdpError, type CdpErrorCode } from '../connections/cdpConnection'
import type { Connection } from '../protocol/connection'
import type { DeviceSession } from '../protocol/session'
import type { ConsoleEntry } from '../protocol/console'
import type { EvaluateError, EvaluateResult } from '../protocol/evaluate'
import type {
  Breakpoint,
  DebuggerCommandResult,
  DebuggerScope,
  DebuggerState,
  ScopeVariable
} from '../protocol/debugger'
import type { NetworkRequest } from '../protocol/network'
import { parseConsoleEntry, type StackFrame } from './consoleEvents'
import {
  isDebuggerResumed,
  parseDebuggerPaused,
  parseScriptParsed,
  type ParsedPausedFrame
} from './debuggerEvents'
import { parseNetworkWireEvent, type NetworkWireEvent } from './networkEvents'
import { NETWORK_INTERCEPTOR_SCRIPT } from './networkInterceptorScript'
import { formatRemoteObject, isRecord } from './remoteObject'
import { symbolicateFrames, symbolicateStructured } from './symbolicate'
import { findGeneratedPosition, listSourceFiles, type GeneratedPosition } from './sourcePosition'

const CONNECT_RETRY_ATTEMPTS = 3
const CONNECT_RETRY_DELAY_MS = 500
const MAX_CONSOLE_ENTRIES = 1000
const MAX_NETWORK_REQUESTS = 500

// Um `close` no CDP pode ser um reload rápido (a página reconecta em segundos)
// OU o app inteiro tendo sido fechado e reaberto à mão pelo usuário — que pode
// levar bem mais de 10-20s (achar o app, abrir, esperar o bundle recarregar).
// Nesse segundo caso o device chega a sumir de `deviceManager.list()` por um
// tempo até reaparecer — não é um erro definitivo, é só o intervalo entre o
// app cair e o usuário terminar de reabri-lo. Por isso este loop NÃO tem um
// número fixo de tentativas: insiste indefinidamente (até a conexão voltar,
// outra chamada já ter reconectado, ou o SessionManager ser descartado), sem
// tratar "device sumiu da lista agora" como motivo pra desistir. Cada
// tentativa falha rápido e barato (só olha a lista em memória), então não tem
// custo real em ficar tentando. `RECONNECT_AFTER_CLOSE_DELAY_MS` dá uma folga
// antes de cada tentativa (inclusive a primeira) pra não bater em cima da hora
// do fechamento — reconectar rápido demais colide com o InspectorProxy do
// Metro ainda no meio do handshake de repareamento, o que na prática já
// derrubou o Metro inteiro numa tentativa anterior mais agressiva.
const RECONNECT_AFTER_CLOSE_DELAY_MS = 1500

// `Runtime.executionContextCreated` (ver `isExecutionContextCreated`) é o
// sinal mais rápido de reload, mas provou não ser confiável na prática — em
// mais de um teste real o Metro simplesmente não repassou NENHUM evento de
// ciclo de vida (nem esse, nem um `close` de socket) pro reload que de fato
// aconteceu, deixando o interceptor de rede sem ser reinstalado e a captura
// muda depois do reload. Como o script é idempotente (ver
// `networkInterceptorScript.ts`), reenviá-lo sem parar é inofensivo — esta
// poll é a rede de segurança que garante que o interceptor volta sozinho
// mesmo quando nenhum evento de ciclo de vida chega. Curto de propósito: é só
// um Runtime.evaluate minúsculo, e o atraso até a captura voltar depois de um
// reload é literalmente esse intervalo — 3s era perceptível demais.
const NETWORK_INTERCEPTOR_POLL_MS = 400

const IDLE_DEBUGGER_STATE: DebuggerState = {
  status: 'idle',
  frames: [],
  scopes: [],
  breakpoints: []
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function extractScopeVariables(response: unknown): ScopeVariable[] {
  if (!isRecord(response) || !Array.isArray(response.result)) return []
  return response.result
    .filter(isRecord)
    .filter((property) => typeof property.name === 'string')
    .map((property) => ({ name: String(property.name), value: formatRemoteObject(property.value) }))
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

// Sinal de reload de JS na mesma conexão CDP (ver `handleCdpEvent`): o Hermes
// dispara isto quando recria o contexto global depois de um reload.
function isExecutionContextCreated(message: unknown): boolean {
  return isRecord(message) && message.method === 'Runtime.executionContextCreated'
}

type ConnectionResult =
  | { ok: true; session: DeviceSession; connection: Connection }
  | { ok: false; error: EvaluateError; message: string }

export type ConsoleEntryListener = (deviceId: string, entry: ConsoleEntry) => void
export type DebuggerStateListener = (deviceId: string, state: DebuggerState) => void
export type NetworkRequestListener = (deviceId: string, request: NetworkRequest) => void
export type Unsubscribe = () => void

// Cria/mantém uma `DeviceSession` por device (ver ARCHITECTURE.md §1 e §3).
// Hoje a sessão guarda a conexão CDP e os stores de console/debugger; é o
// substituto real do `Map` solto de conexões que existia antes disso ser
// formalizado.
export class SessionManager {
  private readonly sessions = new Map<string, DeviceSession>()
  private readonly consoleListeners = new Set<ConsoleEntryListener>()
  private readonly debuggerListeners = new Set<DebuggerStateListener>()
  private readonly networkListeners = new Set<NetworkRequestListener>()
  // scriptId (CDP) -> url do arquivo, por device. Só existe pra traduzir a
  // location de `Debugger.paused` de volta pra um arquivo legível — não faz
  // parte do contrato público de `DeviceSession`.
  private readonly scriptUrlsByDevice = new Map<string, Map<string, string>>()
  // Tentativa de conexão em andamento por device — ver `ensureConnection`.
  private readonly connectingByDevice = new Map<string, Promise<ConnectionResult>>()
  // Poll de reinstalação do interceptor de rede por device — ver
  // `startNetworkInterceptorPolling`.
  private readonly networkInterceptorTimers = new Map<string, ReturnType<typeof setInterval>>()
  // Devices com um loop de `reconnectAfterClose` em andamento — evita duas
  // chamadas de `close` empilharem dois loops pro mesmo device.
  private readonly reconnectingDevices = new Set<string>()
  // Vira `true` em `disposeAll` — os loops de `reconnectAfterClose` em
  // andamento checam isto pra parar de tentar em vez de rodar pra sempre.
  private disposed = false

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
    const session = await this.ensureConnectionWithRetry(deviceId)
    return session?.stores.console ?? []
  }

  /** Igual a `consoleEntries`, mas devolve o estado ao vivo do Debugger. */
  async debuggerState(deviceId: string): Promise<DebuggerState> {
    const session = await this.ensureConnectionWithRetry(deviceId)
    return session?.stores.debugger ?? IDLE_DEBUGGER_STATE
  }

  /** Igual a `consoleEntries`, mas devolve as requisições de rede capturadas. */
  async networkRequests(deviceId: string): Promise<NetworkRequest[]> {
    const session = await this.ensureConnectionWithRetry(deviceId)
    return session?.stores.network ?? []
  }

  /**
   * Arquivos-fonte originais (do source map do bundle) que dá pra usar em
   * `setBreakpoint` — sem visualizador de código, é a única forma de saber o
   * que digitar. `node_modules` fica de fora da sugestão (é gigante e quase
   * nunca é o alvo) — mas ainda dá pra digitar um arquivo de lá na mão, isso
   * só afeta a lista de sugestões, não o casamento de `setBreakpoint`.
   */
  async knownSourceFiles(deviceId: string): Promise<string[]> {
    await this.ensureConnectionWithRetry(deviceId)
    const bundleUrls = [...this.getScriptUrls(deviceId).values()]
    const files = await Promise.all(bundleUrls.map((url) => listSourceFiles(url)))
    const unique = [...new Set(files.flat())]
    return unique.filter((file) => !file.includes('node_modules'))
  }

  async setBreakpoint(
    deviceId: string,
    file: string,
    lineNumber: number
  ): Promise<DebuggerCommandResult> {
    const ensured = await this.ensureConnection(deviceId)
    if (!ensured.ok) return { ok: false, message: ensured.message }

    // O Metro serve o app inteiro como UM script (o bundle) — "App.js" nunca
    // existe como URL própria (isso é o que `knownScripts`/o `<datalist>` do
    // painel mostram na prática). A posição real do breakpoint só existe
    // dentro do source map do bundle, então traduzimos arquivo+linha
    // (posição original) pra linha+coluna do bundle (posição gerada) antes de
    // pedir pro CDP.
    const bundleUrls = [...this.getScriptUrls(deviceId).values()]
    if (bundleUrls.length === 0) {
      return { ok: false, message: 'nenhum script carregado ainda' }
    }

    let resolvedPosition: GeneratedPosition | undefined
    let resolvedBundleUrl: string | undefined
    let lastError = 'não consegui localizar esse arquivo/linha em nenhum bundle carregado'
    for (const bundleUrl of bundleUrls) {
      const found = await findGeneratedPosition(bundleUrl, file, lineNumber)
      if (found.ok) {
        resolvedPosition = found.position
        resolvedBundleUrl = bundleUrl
        break
      }
      lastError = found.message
    }
    if (!resolvedPosition || !resolvedBundleUrl) return { ok: false, message: lastError }

    try {
      const response = await ensured.connection.send({
        method: 'Debugger.setBreakpointByUrl',
        params: {
          url: resolvedBundleUrl,
          lineNumber: Math.max(0, resolvedPosition.line - 1),
          columnNumber: resolvedPosition.column
        }
      })
      const breakpointId =
        isRecord(response) && typeof response.breakpointId === 'string'
          ? response.breakpointId
          : undefined
      if (!breakpointId) return { ok: false, message: 'CDP não devolveu um breakpointId' }

      const breakpoint: Breakpoint = { id: breakpointId, file, lineNumber }
      this.updateDebuggerState(ensured.session, (state) => ({
        ...state,
        breakpoints: [...state.breakpoints, breakpoint]
      }))

      // Posição certa não garante que ESSA linha tem código executável (linha
      // em branco, comentário, chave de fechamento) — CDP resolve pro
      // breakable mais próximo e devolve isso em `locations`; vazio é sinal
      // real de problema, mesmo com a posição correta.
      const locations =
        isRecord(response) && Array.isArray(response.locations) ? response.locations : []
      if (locations.length === 0) {
        return {
          ok: true,
          warning: 'a linha não parece ter código executável — o breakpoint pode nunca ser atingido'
        }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async removeBreakpoint(deviceId: string, breakpointId: string): Promise<DebuggerCommandResult> {
    const ensured = await this.ensureConnection(deviceId)
    if (!ensured.ok) return { ok: false, message: ensured.message }

    try {
      await ensured.connection.send({
        method: 'Debugger.removeBreakpoint',
        params: { breakpointId }
      })
      this.updateDebuggerState(ensured.session, (state) => ({
        ...state,
        breakpoints: state.breakpoints.filter((breakpoint) => breakpoint.id !== breakpointId)
      }))
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  resume(deviceId: string): Promise<DebuggerCommandResult> {
    return this.sendDebuggerCommand(deviceId, 'Debugger.resume')
  }

  stepOver(deviceId: string): Promise<DebuggerCommandResult> {
    return this.sendDebuggerCommand(deviceId, 'Debugger.stepOver')
  }

  stepInto(deviceId: string): Promise<DebuggerCommandResult> {
    return this.sendDebuggerCommand(deviceId, 'Debugger.stepInto')
  }

  stepOut(deviceId: string): Promise<DebuggerCommandResult> {
    return this.sendDebuggerCommand(deviceId, 'Debugger.stepOut')
  }

  /** Notifica cada novo evento de console de qualquer device, assim que chega. */
  onConsoleEntry(listener: ConsoleEntryListener): Unsubscribe {
    this.consoleListeners.add(listener)
    return () => this.consoleListeners.delete(listener)
  }

  /** Notifica toda mudança no estado do Debugger (pausa, resume, breakpoints). */
  onDebuggerState(listener: DebuggerStateListener): Unsubscribe {
    this.debuggerListeners.add(listener)
    return () => this.debuggerListeners.delete(listener)
  }

  /** Notifica request nova ou atualizada (resposta/erro chegando) de qualquer device. */
  onNetworkRequest(listener: NetworkRequestListener): Unsubscribe {
    this.networkListeners.add(listener)
    return () => this.networkListeners.delete(listener)
  }

  async disposeAll(): Promise<void> {
    this.disposed = true
    for (const session of this.sessions.values()) {
      const connection = session.connections.cdp
      if (connection) void connection.disconnect().catch(() => {})
    }
    for (const deviceId of this.networkInterceptorTimers.keys()) {
      this.stopNetworkInterceptorPolling(deviceId)
    }
    this.sessions.clear()
    this.scriptUrlsByDevice.clear()
    this.connectingByDevice.clear()
  }

  private async ensureConnectionWithRetry(deviceId: string): Promise<DeviceSession | undefined> {
    let result = await this.ensureConnection(deviceId)

    for (
      let attempt = 1;
      attempt < CONNECT_RETRY_ATTEMPTS && !result.ok && isRetryableEvaluateError(result.error);
      attempt++
    ) {
      await delay(CONNECT_RETRY_DELAY_MS)
      result = await this.ensureConnection(deviceId)
    }

    return this.sessions.get(deviceId)
  }

  private getOrCreateSession(deviceId: string): DeviceSession {
    let session = this.sessions.get(deviceId)
    if (!session) {
      session = {
        id: deviceId,
        deviceId,
        connections: {},
        stores: { console: [], debugger: IDLE_DEBUGGER_STATE, network: [] }
      }
      this.sessions.set(deviceId, session)
    }
    return session
  }

  private getScriptUrls(deviceId: string): Map<string, string> {
    let scriptUrls = this.scriptUrlsByDevice.get(deviceId)
    if (!scriptUrls) {
      scriptUrls = new Map()
      this.scriptUrlsByDevice.set(deviceId, scriptUrls)
    }
    return scriptUrls
  }

  private updateDebuggerState(
    session: DeviceSession,
    update: (state: DebuggerState) => DebuggerState
  ): void {
    session.stores.debugger = update(session.stores.debugger)
    for (const listener of this.debuggerListeners)
      listener(session.deviceId, session.stores.debugger)
  }

  private async sendDebuggerCommand(
    deviceId: string,
    method: string
  ): Promise<DebuggerCommandResult> {
    const ensured = await this.ensureConnection(deviceId)
    if (!ensured.ok) return { ok: false, message: ensured.message }

    try {
      await ensured.connection.send({ method })
      return { ok: true }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // Console, Debugger e Network ficam todos montados ao mesmo tempo (ver
  // App.tsx) e cada um chama `ensureConnection` assim que abre — sem essa
  // trava, duas chamadas concorrentes viam `session.connections.cdp` ainda
  // `undefined` (nenhuma tinha terminado de conectar) e cada uma criava sua
  // própria `CDPConnection`. As duas conseguiam abrir o socket, cada uma
  // registrava seu próprio `onMessage`, e o Metro/Hermes entregava cada
  // evento pras DUAS — daí "requests duplicadas" no painel Network (um
  // evento de request virava duas entradas com o mesmo id; o evento de
  // response só atualizava a primeira, via `find`, deixando a segunda presa
  // em "sem status"). A trava faz chamadas concorrentes esperarem a MESMA
  // tentativa de conexão em vez de cada uma abrir a sua.
  private async ensureConnection(deviceId: string): Promise<ConnectionResult> {
    const inFlight = this.connectingByDevice.get(deviceId)
    if (inFlight) return inFlight

    const attempt = this.connectOnce(deviceId).finally(() => {
      this.connectingByDevice.delete(deviceId)
    })
    this.connectingByDevice.set(deviceId, attempt)
    return attempt
  }

  private async connectOnce(deviceId: string): Promise<ConnectionResult> {
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
        connection.onClose(() => this.handleConnectionClosed(deviceId, session, connection))
        await connection.send({ method: 'Runtime.enable' })
        await connection.send({ method: 'Debugger.enable' })
        // Painel Network: instala o interceptor de fetch/XHR (ver
        // `networkInterceptorScript.ts`) — não depende do domínio CDP
        // `Network` (sem garantia de suporte no Hermes/Metro do RN).
        await connection.send({
          method: 'Runtime.evaluate',
          params: { expression: NETWORK_INTERCEPTOR_SCRIPT }
        })
        this.startNetworkInterceptorPolling(deviceId, session)
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

  // Reload do app RN (não apenas Fast Refresh) derruba o WebSocket CDP — o
  // InspectorProxy do Metro fecha a conexão junto com o contexto JS antigo.
  // Sem isto, `session.connections.cdp` continuava apontando pra uma conexão
  // morta pra sempre: nenhum painel voltava a atualizar sozinho, só reiniciando
  // o Electron inteiro (o que recria o SessionManager do zero). Ao fechar,
  // esquece a conexão morta e tenta reconectar sozinho — o próximo
  // `connectOnce` já vê `isNewConnection = true` de novo e reinstala
  // `Runtime.enable`/`Debugger.enable`/o interceptor de rede na nova conexão.
  //
  // A checagem de identidade evita apagar uma conexão mais nova: se outra
  // chamada já havia substituído `session.connections.cdp` antes deste
  // fechamento chegar, não há nada a limpar aqui.
  private handleConnectionClosed(
    deviceId: string,
    session: DeviceSession,
    connection: Connection
  ): void {
    if (session.connections.cdp !== connection) return
    session.connections.cdp = undefined
    void this.reconnectAfterClose(deviceId, session)
  }

  // Mais paciente que `ensureConnectionWithRetry`: essa é uma ação de fundo
  // reagindo a um `close`, não uma chamada interativa do usuário — pode e deve
  // esperar o vaivém de reconexão do Metro/reload terminar (ver comentário de
  // `RECONNECT_AFTER_CLOSE_DELAY_MS` — sem limite de tentativas de propósito).
  // Cada nova conexão criada aqui registra seu próprio `onClose` de novo
  // (branch `isNewConnection` do `connectOnce`), então se ela cair de novo, o
  // ciclo se repete sozinho. A checagem de `session.connections.cdp` a cada
  // volta desiste cedo se outra chamada (ex: o usuário reselecionando o
  // device) já reconectou nesse meio tempo, em vez de insistir por cima de uma
  // conexão boa. `reconnectingDevices` evita dois `close` seguidos (comum
  // durante o vaivém de um reload) empilharem dois loops pro mesmo device.
  private async reconnectAfterClose(deviceId: string, session: DeviceSession): Promise<void> {
    if (this.reconnectingDevices.has(deviceId)) return
    this.reconnectingDevices.add(deviceId)
    try {
      while (!this.disposed) {
        await delay(RECONNECT_AFTER_CLOSE_DELAY_MS)
        if (this.disposed || session.connections.cdp) return
        const result = await this.ensureConnection(deviceId)
        if (result.ok) return
        // Inclusive 'no-device': o app pode ter sido fechado e reaberto à mão
        // (ver comentário de `RECONNECT_AFTER_CLOSE_DELAY_MS`) — o device some
        // da lista por um tempo até reaparecer, não é motivo pra desistir.
      }
    } finally {
      this.reconnectingDevices.delete(deviceId)
    }
  }

  // Reenvia o script do interceptor (idempotente — ver
  // `networkInterceptorScript.ts`) e loga só quando ele REALMENTE reinstalou
  // (contexto era novo, sinal de reload), não a cada poll sem efeito — senão
  // o terminal enche de linha inútil a cada `NETWORK_INTERCEPTOR_POLL_MS`.
  private async reinstallNetworkInterceptor(session: DeviceSession): Promise<void> {
    const connection = session.connections.cdp
    if (!connection) return
    try {
      const response = await connection.send({
        method: 'Runtime.evaluate',
        params: { expression: NETWORK_INTERCEPTOR_SCRIPT }
      })
      const reinstalled =
        isRecord(response) && isRecord(response.result) && response.result.value === true
      if (reinstalled) {
        console.error(`[net-diag] interceptor de rede reinstalado device=${session.deviceId}`)
      }
    } catch {
      // Conexão pode ter caído nesse meio tempo — o `onClose` (ver
      // `handleConnectionClosed`) já cuida de reconectar.
    }
  }

  // Rede de segurança contra reload que não dispara nenhum evento de ciclo de
  // vida confiável pelo proxy do Metro (ver comentário de
  // `NETWORK_INTERCEPTOR_POLL_MS`). Um timer por device; reenviar o script
  // sem parar é seguro porque ele é idempotente.
  private startNetworkInterceptorPolling(deviceId: string, session: DeviceSession): void {
    if (this.networkInterceptorTimers.has(deviceId)) return
    const timer = setInterval(() => {
      void this.reinstallNetworkInterceptor(session)
    }, NETWORK_INTERCEPTOR_POLL_MS)
    this.networkInterceptorTimers.set(deviceId, timer)
  }

  private stopNetworkInterceptorPolling(deviceId: string): void {
    const timer = this.networkInterceptorTimers.get(deviceId)
    if (!timer) return
    clearInterval(timer)
    this.networkInterceptorTimers.delete(deviceId)
  }

  private handleCdpEvent(session: DeviceSession, message: unknown): void {
    // Reload do app (ex: "r" no Metro) não fecha o WebSocket CDP — o Hermes só
    // destrói o contexto JS antigo e cria um novo por cima da MESMA conexão.
    // `Runtime.enable`/`Debugger.enable` são por sessão CDP, então continuam
    // valendo, mas o interceptor de rede foi instalado via `Runtime.evaluate`
    // dentro do contexto antigo — ele some junto. Reinstala já quando esse
    // sinal chega (mais rápido), com o poll de `startNetworkInterceptorPolling`
    // como rede de segurança pros casos em que ele não chega (ver comentário
    // de `NETWORK_INTERCEPTOR_POLL_MS`).
    if (isExecutionContextCreated(message)) {
      void this.reinstallNetworkInterceptor(session)
      return
    }

    const scriptParsed = parseScriptParsed(message)
    if (scriptParsed) {
      this.getScriptUrls(session.deviceId).set(scriptParsed.scriptId, scriptParsed.url)
      return
    }

    if (isDebuggerResumed(message)) {
      this.updateDebuggerState(session, (state) => ({
        ...state,
        status: 'idle',
        frames: [],
        scopes: []
      }))
      return
    }

    const paused = parseDebuggerPaused(message)
    if (paused) {
      void this.publishDebuggerPaused(session, paused.frames)
      return
    }

    // Checa ANTES de console: o interceptor de rede reporta via
    // `console.debug` (ver `networkInterceptorScript.ts`) — sem isso, cada
    // request/response viraria uma entrada visível no painel Console.
    const networkEvent = parseNetworkWireEvent(message)
    if (networkEvent) {
      this.publishNetworkEvent(session, networkEvent)
      return
    }

    const parsed = parseConsoleEntry(message)
    if (!parsed) return
    void this.publishConsoleEntry(session, parsed.entry, parsed.frames)
  }

  private publishNetworkEvent(session: DeviceSession, event: NetworkWireEvent): void {
    if (event.kind === 'request') {
      const request: NetworkRequest = {
        id: event.id,
        kind: event.type,
        method: event.method,
        url: event.url,
        requestHeaders: event.headers,
        requestBody: event.body,
        startTime: event.startTime
      }
      session.stores.network.push(request)
      if (session.stores.network.length > MAX_NETWORK_REQUESTS) session.stores.network.shift()
      for (const listener of this.networkListeners) listener(session.deviceId, request)
      return
    }

    const existing = session.stores.network.find((request) => request.id === event.id)
    if (!existing) return

    if (event.kind === 'response') {
      existing.status = event.status
      existing.responseHeaders = event.headers
      existing.responseBody = event.body
      existing.endTime = event.endTime
    } else {
      existing.error = event.message
      existing.endTime = event.endTime
    }
    for (const listener of this.networkListeners) listener(session.deviceId, existing)
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

  // Symbolica a pilha de chamadas e busca as variáveis do escopo do frame onde
  // parou (só o topo — inspecionar o escopo de frames mais fundos na pilha
  // fica pra quando houver um consumidor real disso, ver YAGNI no CLAUDE.md).
  private async publishDebuggerPaused(
    session: DeviceSession,
    frames: ParsedPausedFrame[]
  ): Promise<void> {
    const scriptUrls = this.getScriptUrls(session.deviceId)
    const stackFrames: StackFrame[] = frames.map((frame) => ({
      functionName: frame.functionName,
      url: scriptUrls.get(frame.scriptId) ?? frame.scriptId,
      lineNumber: frame.lineNumber,
      columnNumber: frame.columnNumber
    }))
    const symbolicated = await symbolicateStructured(stackFrames)

    const scopes = await this.fetchScopes(session, frames[0])

    this.updateDebuggerState(session, (state) => ({
      ...state,
      status: 'paused',
      frames: frames.map((frame, index) => ({
        callFrameId: frame.callFrameId,
        functionName: symbolicated[index]?.functionName ?? frame.functionName,
        file: symbolicated[index]?.file ?? stackFrames[index].url,
        lineNumber: symbolicated[index]?.lineNumber ?? frame.lineNumber,
        columnNumber: symbolicated[index]?.columnNumber ?? frame.columnNumber
      })),
      scopes
    }))
  }

  private async fetchScopes(
    session: DeviceSession,
    topFrame: ParsedPausedFrame | undefined
  ): Promise<DebuggerScope[]> {
    const connection = session.connections.cdp
    if (!topFrame || !connection) return []

    const scopes: DebuggerScope[] = []
    for (const scope of topFrame.scopeChain) {
      // Escopo 'global' pode ter um número enorme de propriedades (tudo do
      // runtime) — não vale buscar pra uma inspeção de variáveis locais.
      if (scope.type === 'global' || !scope.objectId) continue
      try {
        const response = await connection.send({
          method: 'Runtime.getProperties',
          params: { objectId: scope.objectId, ownProperties: true }
        })
        scopes.push({ type: scope.type, variables: extractScopeVariables(response) })
      } catch {
        // Falha ao buscar um escopo específico não deve derrubar os outros.
      }
    }
    return scopes
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
