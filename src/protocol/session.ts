import type { Connection } from './connection'

// Contrato central do sistema (ver ARCHITECTURE.md §5). Uma `DeviceSession`
// isola os recursos de UM device. O shape completo do ARCHITECTURE.md também
// prevê `status`, `capabilities` e `stores` por painel (console, network,
// navigation, storage, performance) — esses campos só entram quando o primeiro
// consumidor real deles existir (painéis a partir do M2), pra não carregar
// campos que nada lê ainda.
export interface DeviceSession {
  id: string
  deviceId: string
  connections: {
    cdp?: Connection
  }
}
