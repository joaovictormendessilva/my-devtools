import { useCallback, useState } from 'react'
import type { EvaluateResult } from '../../../protocol/evaluate'

// Temporário do M1: dispara `window.api.evaluate` e guarda o resultado POR device.
// Nada de estado global compartilhado entre devices — `states` é um mapa keyed
// por deviceId, cada device com seu próprio ciclo idle → loading → done.
// Será removido junto com o botão "Run 2+2" quando o painel Console chegar (M2).

export type EvaluateState =
  { status: 'idle' } | { status: 'loading' } | { status: 'done'; result: EvaluateResult }

export interface UseEvaluate {
  states: Record<string, EvaluateState>
  run: (deviceId: string, expression: string) => Promise<void>
}

export function useEvaluate(): UseEvaluate {
  const [states, setStates] = useState<Record<string, EvaluateState>>({})

  const run = useCallback(async (deviceId: string, expression: string): Promise<void> => {
    setStates((prev) => ({ ...prev, [deviceId]: { status: 'loading' } }))
    try {
      const result = await window.api.evaluate(deviceId, expression)
      setStates((prev) => ({ ...prev, [deviceId]: { status: 'done', result } }))
    } catch (error) {
      // O handler do main nunca lança (sempre devolve EvaluateResult); isto cobre
      // só uma falha do próprio canal IPC. A linha nunca fica presa em "loading".
      setStates((prev) => ({
        ...prev,
        [deviceId]: {
          status: 'done',
          result: {
            ok: false,
            error: 'evaluate-failed',
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }))
    }
  }, [])

  return { states, run }
}
