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
import { parseConsoleEntry, type StackFrame } from './consoleEvents'
import {
  isDebuggerResumed,
  parseDebuggerPaused,
  parseScriptParsed,
  type ParsedPausedFrame
} from './debuggerEvents'
import { formatRemoteObject, isRecord } from './remoteObject'
import { symbolicateFrames, symbolicateStructured } from './symbolicate'
import { findGeneratedPosition, listSourceFiles, type GeneratedPosition } from './sourcePosition'

const CONNECT_RETRY_ATTEMPTS = 3
const CONNECT_RETRY_DELAY_MS = 500
const MAX_CONSOLE_ENTRIES = 1000

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

type ConnectionResult =
  | { ok: true; session: DeviceSession; connection: Connection }
  | { ok: false; error: EvaluateError; message: string }

export type ConsoleEntryListener = (deviceId: string, entry: ConsoleEntry) => void
export type DebuggerStateListener = (deviceId: string, state: DebuggerState) => void
export type Unsubscribe = () => void

// Cria/mantém uma `DeviceSession` por device (ver ARCHITECTURE.md §1 e §3).
// Hoje a sessão guarda a conexão CDP e os stores de console/debugger; é o
// substituto real do `Map` solto de conexões que existia antes disso ser
// formalizado.
export class SessionManager {
  private readonly sessions = new Map<string, DeviceSession>()
  private readonly consoleListeners = new Set<ConsoleEntryListener>()
  private readonly debuggerListeners = new Set<DebuggerStateListener>()
  // scriptId (CDP) -> url do arquivo, por device. Só existe pra traduzir a
  // location de `Debugger.paused` de volta pra um arquivo legível — não faz
  // parte do contrato público de `DeviceSession`.
  private readonly scriptUrlsByDevice = new Map<string, Map<string, string>>()

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

  async disposeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      const connection = session.connections.cdp
      if (connection) void connection.disconnect().catch(() => {})
    }
    this.sessions.clear()
    this.scriptUrlsByDevice.clear()
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
        stores: { console: [], debugger: IDLE_DEBUGGER_STATE }
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
        await connection.send({ method: 'Debugger.enable' })
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
