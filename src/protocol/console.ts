// Contrato do canal `console:message` (SessionManager → main → preload → hook
// useConsole). Um evento por chamada de console/exceção no runtime do device.

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ConsoleEntry {
  id: string
  level: ConsoleLevel
  text: string
  timestamp: number
}
