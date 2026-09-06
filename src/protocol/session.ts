import type { Connection } from './connection'
import type { ConsoleEntry } from './console'
import type { DebuggerState } from './debugger'

// Contrato central do sistema (ver ARCHITECTURE.md §5). Uma `DeviceSession`
// isola os recursos de UM device. O shape completo do ARCHITECTURE.md também
// prevê `status`, `capabilities` e os demais `stores` por painel (network,
// navigation, storage, performance) — esses campos só entram quando o primeiro
// consumidor real deles existir (painéis a partir do M3+), pra não carregar
// campos que nada lê ainda. `stores.console` e `stores.debugger` já entram
// agora: são os painéis Console e Debugger (M2).
export interface DeviceSession {
  id: string
  deviceId: string
  connections: {
    cdp?: Connection
  }
  stores: {
    console: ConsoleEntry[]
    debugger: DebuggerState
  }
}
