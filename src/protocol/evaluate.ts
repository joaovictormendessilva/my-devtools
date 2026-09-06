// Contrato do canal IPC `devices:evaluate` (renderer → main → CDPConnection).
// Usado pelo REPL do painel Console (M2): roda uma expressão JavaScript no
// device selecionado via `Runtime.evaluate` e devolve o resultado.

export type EvaluateError =
  | 'no-device'
  | 'no-debugger-url'
  | 'connect-failed'
  | 'connect-timeout'
  | 'request-timeout'
  | 'connection-closed'
  | 'evaluate-failed'

export type EvaluateResult =
  /** `value` é o resultado serializado por valor pelo CDP (`returnByValue`). */
  { ok: true; value: unknown } | { ok: false; error: EvaluateError; message: string }
