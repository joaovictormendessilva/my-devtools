// RemoteObject do CDP: primitivos vêm em `.value`, objetos/funções em
// `.description`. Compartilhado entre `consoleEvents.ts` (args de console.*) e
// `debuggerEvents.ts` (variáveis de escopo) — mesmo shape nos dois casos.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Pra um Error, `.description` traz a mensagem seguida da stack como texto —
// só a primeira linha (nome + mensagem) interessa aqui; quando existe uma
// stack de verdade, ela vem estruturada à parte (ver `StackFrame`), não daqui.
export function formatRemoteObject(value: unknown): string {
  if (!isRecord(value)) return String(value)
  if ('value' in value) return String(value.value)
  if (typeof value.description === 'string') return value.description.split('\n')[0]
  return typeof value.type === 'string' ? value.type : 'object'
}
