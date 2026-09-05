import type { Device } from '../protocol/device'

// O Metro (bundler do Expo/RN) expõe /json/list no servidor de desenvolvimento:
// a lista de alvos de debug de todos os apps registrados agora — físico, emulador
// ou simulador, quem se registra é o próprio app. Aqui só descobrimos e modelamos
// `Device`; conexão real ao runtime (CDP) é passo futuro do M1.
const METRO_JSON_LIST_URL = 'http://localhost:8081/json/list'
const POLL_INTERVAL_MS = 2000
const REQUEST_TIMEOUT_MS = 1500

// Shape externo, sem versão — o Metro pode mudar entre releases do RN. Só
// declaramos os campos que lemos, todos opcionais, e validamos em runtime.
interface MetroListEntry {
  title?: string
  deviceName?: string
  // URL do WebSocket CDP desta página de debug. É por AQUI que a CDPConnection
  // conecta ao Hermes. Um mesmo device pode expor mais de uma página.
  webSocketDebuggerUrl?: string
  // A página anuncia `reactNative.capabilities`? É o sinal de que é uma página
  // de inspector real (e não uma entrada degenerada/legada). Usado para
  // escolher a página certa quando o device expõe mais de uma.
  hasCapabilities: boolean
  reactNative?: {
    logicalDeviceId?: string
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseEntries(payload: unknown): MetroListEntry[] {
  if (!Array.isArray(payload)) return []

  return payload.filter(isRecord).map((entry) => {
    const reactNative = isRecord(entry.reactNative) ? entry.reactNative : undefined
    return {
      title: typeof entry.title === 'string' ? entry.title : undefined,
      deviceName: typeof entry.deviceName === 'string' ? entry.deviceName : undefined,
      webSocketDebuggerUrl:
        typeof entry.webSocketDebuggerUrl === 'string' ? entry.webSocketDebuggerUrl : undefined,
      hasCapabilities: reactNative ? isRecord(reactNative.capabilities) : false,
      reactNative: {
        logicalDeviceId:
          reactNative && typeof reactNative.logicalDeviceId === 'string'
            ? reactNative.logicalDeviceId
            : undefined
      }
    }
  })
}

// Várias versões do RN colocam o nome do device entre parênteses no fim do
// `title` (ex: "com.app.dev (Pixel 7)"). É frágil e varia por versão — só é
// usado como candidato quando `deviceName` não deu um nome legível.
function nameFromTitle(title: string | undefined): string | undefined {
  const match = title?.match(/\(([^)]+)\)\s*$/)
  return match?.[1]?.trim() || undefined
}

// Um candidato só vira nome se for legível por humano. O /json/list às vezes
// manda no lugar do nome um id cru: o próprio logicalDeviceId, um hash hex, ou
// o literal "Unknown" (default do dev-middleware quando o runtime não envia
// `?name=`). Nesses casos ignoramos e caímos pro próximo candidato.
function isHumanReadableName(candidate: string, logicalDeviceId: string): boolean {
  const value = candidate.trim()
  if (value === '') return false
  if (value.toLowerCase() === 'unknown') return false
  if (value === logicalDeviceId) return false
  if (/^[0-9a-f-]{16,}$/i.test(value)) return false // hash / uuid / id hex cru
  return true
}

// Resolução de nome — MESMO caminho para todo device, sem atalho:
//   1. `deviceName` legível de qualquer entrada do grupo
//   2. nome entre parênteses no fim do `title` de qualquer entrada
//   3. fallback: `logicalDeviceId` truncado em 8 chars
function resolveDeviceName(logicalDeviceId: string, entries: MetroListEntry[]): string {
  for (const entry of entries) {
    const name = entry.deviceName?.trim()
    if (name && isHumanReadableName(name, logicalDeviceId)) return name
  }
  for (const entry of entries) {
    const name = nameFromTitle(entry.title)
    if (name && isHumanReadableName(name, logicalDeviceId)) return name
  }
  return logicalDeviceId.slice(0, 8)
}

function toDevice(logicalDeviceId: string, entries: MetroListEntry[]): Device {
  return {
    id: logicalDeviceId,
    name: resolveDeviceName(logicalDeviceId, entries),
    // `status: 'available'` — o device foi descoberto, mas ainda não há
    // DeviceSession/Connection real. `'connected'` só quando isso existir.
    status: 'available'
  }
}

// Limitação conhecida: o InspectorProxy do Metro só remove uma conexão de device
// quando o WebSocket dela fecha — não há timeout. Em device físico, um reload/
// reconexão pode deixar a conexão antiga pendurada (socket meio-aberto), e ela
// aparece como um `logicalDeviceId` a mais para o mesmo aparelho. Não tentamos
// merge por nome aqui de propósito (mascararia o problema); a identidade real é
// reconciliada quando a Connection/CDP conectar de verdade (próximo passo do M1).
function groupEntriesByLogicalDeviceId(entries: MetroListEntry[]): Map<string, MetroListEntry[]> {
  const groups = new Map<string, MetroListEntry[]>()

  for (const entry of entries) {
    const id = entry.reactNative?.logicalDeviceId
    if (!id) continue // entradas sem logicalDeviceId não são devices RN
    const group = groups.get(id)
    if (group) group.push(entry)
    else groups.set(id, [entry])
  }

  return groups
}

// Escolhe a página CDP de UM device (grupo já agrupado por logicalDeviceId).
// Regra: dentre as entradas com `webSocketDebuggerUrl`, prefere as que anunciam
// `capabilities` (página de inspector real); dentre elas, a última — o Metro
// lista as páginas na ordem de conexão, então após um reload a mais recente é a
// viva. Sem nenhuma página com URL, o device não é debugável agora.
function pickDebuggerUrl(entries: MetroListEntry[]): string | undefined {
  const withUrl = entries.filter((entry) => entry.webSocketDebuggerUrl)
  if (withUrl.length === 0) return undefined
  const withCapabilities = withUrl.filter((entry) => entry.hasCapabilities)
  const candidates = withCapabilities.length > 0 ? withCapabilities : withUrl
  return candidates[candidates.length - 1]?.webSocketDebuggerUrl
}

export class DeviceManager {
  private devices: Device[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  // deviceId (logicalDeviceId) → `webSocketDebuggerUrl` da página CDP a usar.
  // Recriado a cada poll; consumido pelo main para abrir a CDPConnection.
  private debuggerUrls = new Map<string, string>()

  start(): void {
    if (this.timer) return
    void this.poll()
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  list(): Device[] {
    return this.devices
  }

  /** URL do WebSocket CDP do device, ou `undefined` se ele não expõe uma página debugável. */
  debuggerUrlFor(deviceId: string): string | undefined {
    return this.debuggerUrls.get(deviceId)
  }

  private async poll(): Promise<void> {
    try {
      const response = await fetch(METRO_JSON_LIST_URL, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok) {
        this.devices = []
        this.debuggerUrls.clear()
        return
      }
      const groups = groupEntriesByLogicalDeviceId(parseEntries(await response.json()))
      this.devices = [...groups].map(([id, entries]) => toDevice(id, entries))
      this.debuggerUrls = new Map(
        [...groups].flatMap(([id, entries]) => {
          const url = pickDebuggerUrl(entries)
          return url ? [[id, url] as const] : []
        })
      )
    } catch {
      // Metro fora do ar / sem servidor Expo rodando: lista vazia, sem crashar o loop.
      this.devices = []
      this.debuggerUrls.clear()
    }
  }
}
