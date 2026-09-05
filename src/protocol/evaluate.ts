// Contrato do canal IPC `devices:evaluate` (renderer → main → CDPConnection).
// Temporário do M1: existe só para provar o transporte CDP ponta-a-ponta
// (rodar `2 + 2` num device e ver `4` na UI). Será substituído pelo painel
// Console / REPL no M2.

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
