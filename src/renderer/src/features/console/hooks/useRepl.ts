import { useCallback, useState } from 'react'
import type { EvaluateResult } from '../../../../../protocol/evaluate'

export interface ReplEntry {
  id: string
  timestamp: number
  expression: string
  status: 'loading' | 'done'
  result?: EvaluateResult
}

export interface UseRepl {
  entries: ReplEntry[]
  /** Expressões já submetidas, mais antiga primeiro — usado pelo recall com as setas. */
  history: string[]
  run: (expression: string) => void
  clear: () => void
}

// O resultado de `Runtime.evaluate` já chega pronto na resposta do IPC (não é
// um evento assíncrono do device como `console.message`), então o REPL guarda
// seu próprio histórico aqui no renderer — não precisa passar pelo
// SessionManager/CDP event buffer, só reusa o mesmo `window.api.evaluate` do M1.
export function useRepl(deviceId: string | undefined): UseRepl {
  const [entries, setEntries] = useState<ReplEntry[]>([])
  const [history, setHistory] = useState<string[]>([])

  const run = useCallback(
    (expression: string) => {
      if (!deviceId) return
      const id = crypto.randomUUID()
      setEntries((prev) => [...prev, { id, timestamp: Date.now(), expression, status: 'loading' }])
      setHistory((prev) => [...prev, expression])

      void window.api.evaluate(deviceId, expression).then((result) => {
        setEntries((prev) =>
          prev.map((entry) => (entry.id === id ? { ...entry, status: 'done', result } : entry))
        )
      })
    },
    [deviceId]
  )

  const clear = useCallback(() => setEntries([]), [])

  return { entries, history, run, clear }
}
