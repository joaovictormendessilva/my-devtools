import type { Connection } from './connection'
import type { ConsoleEntry } from './console'
import type { DebuggerState } from './debugger'
import type { NetworkRequest } from './network'

// Contrato central do sistema (ver ARCHITECTURE.md §5). Uma `DeviceSession`
// isola os recursos de UM device. O shape completo do ARCHITECTURE.md também
// prevê `status`, `capabilities` e os demais `stores` por painel (navigation,
// storage, performance) — esses campos só entram quando o primeiro consumidor
// real deles existir (painéis a partir do M4+), pra não carregar campos que
// nada lê ainda. `stores.console`, `stores.debugger` e `stores.network` já
// entram: são os painéis Console e Debugger (M2) e Network (M3).
export interface DeviceSession {
  id: string
  deviceId: string
  connections: {
    cdp?: Connection
  }
  stores: {
    console: ConsoleEntry[]
    debugger: DebuggerState
    network: NetworkRequest[]
  }
}
