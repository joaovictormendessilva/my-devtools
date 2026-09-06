// Contrato do canal `debugger:update` (SessionManager → main → preload → hook
// useDebugger). Ao contrário do console (histórico que cresce), isto é estado
// AO VIVO da execução: pausado ou não, pilha de chamadas no momento da pausa,
// variáveis do escopo, breakpoints ativos.

export type DebuggerStatus = 'idle' | 'paused'

export interface DebuggerFrame {
  callFrameId: string
  functionName: string
  file: string
  lineNumber: number
  columnNumber: number
}

export interface ScopeVariable {
  name: string
  value: string
}

export interface DebuggerScope {
  /** Tipo do CDP: 'local' | 'closure' | 'global' | 'block' | etc. */
  type: string
  variables: ScopeVariable[]
}

export interface Breakpoint {
  id: string
  file: string
  lineNumber: number
}

export interface DebuggerState {
  status: DebuggerStatus
  /** Pilha de chamadas no momento da pausa; vazia quando `status` é 'idle'. */
  frames: DebuggerFrame[]
  /** Variáveis do escopo do frame onde parou (frames[0]); vazio quando 'idle'. */
  scopes: DebuggerScope[]
  breakpoints: Breakpoint[]
}

export type DebuggerCommandResult = { ok: true } | { ok: false; message: string }
