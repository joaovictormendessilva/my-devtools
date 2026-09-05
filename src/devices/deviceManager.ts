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
function groupByLogicalDeviceId(entries: MetroListEntry[]): Device[] {
  const groups = new Map<string, MetroListEntry[]>()

  for (const entry of entries) {
    const id = entry.reactNative?.logicalDeviceId
    if (!id) continue // entradas sem logicalDeviceId não são devices RN
    const group = groups.get(id)
    if (group) group.push(entry)
    else groups.set(id, [entry])
  }

  return [...groups].map(([id, groupEntries]) => toDevice(id, groupEntries))
}

export class DeviceManager {
  private devices: Device[] = []
  private timer: ReturnType<typeof setInterval> | undefined

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

  private async poll(): Promise<void> {
    try {
      const response = await fetch(METRO_JSON_LIST_URL, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
      if (!response.ok) {
        this.devices = []
        return
      }
      this.devices = groupByLogicalDeviceId(parseEntries(await response.json()))
    } catch {
      // Metro fora do ar / sem servidor Expo rodando: lista vazia, sem crashar o loop.
      this.devices = []
    }
  }
}
