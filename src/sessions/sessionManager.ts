import type { DeviceManager } from '../devices/deviceManager'
import { CDPConnection, CdpError, type CdpErrorCode } from '../connections/cdpConnection'
import type { DeviceSession } from '../protocol/session'
import type { EvaluateError, EvaluateResult } from '../protocol/evaluate'

const CONNECT_RETRY_ATTEMPTS = 3
const CONNECT_RETRY_DELAY_MS = 500

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

// Cria/mantém uma `DeviceSession` por device (ver ARCHITECTURE.md §1 e §3).
// Hoje a sessão só guarda a conexão CDP; é o substituto real do `Map` solto de
// conexões que existia antes disso ser formalizado.
export class SessionManager {
  private readonly sessions = new Map<string, DeviceSession>()

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
      session = { id: deviceId, deviceId, connections: {} }
      this.sessions.set(deviceId, session)
    }
    return session
  }

  private async attemptEvaluate(deviceId: string, expression: string): Promise<EvaluateResult> {
    if (!this.deviceManager.list().some((device) => device.id === deviceId)) {
      return {
        ok: false,
        error: 'no-device',
        message: `device ${deviceId} não está na lista atual`
      }
    }

    const session = this.getOrCreateSession(deviceId)
    let connection = session.connections.cdp
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
      await connection.send({ method: 'Runtime.enable' })
      const response = await connection.send({
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
}
