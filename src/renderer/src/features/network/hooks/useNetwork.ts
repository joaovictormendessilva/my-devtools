import { useCallback, useEffect, useState } from 'react'
import type { NetworkRequest } from '../../../../../protocol/network'

export interface UseNetwork {
  requests: NetworkRequest[]
  /** Limpa só a lista exibida (como o Console) — não apaga o buffer do
   *  SessionManager, que segue capturando normalmente. */
  clear: () => void
}

// Funde por `id`, sempre — nunca substitui o array inteiro nem confia em
// índice. O React StrictMode (ligado em dev, ver main.tsx) roda o efeito duas
// vezes de propósito (monta → desmonta → monta), o que pode fazer o invoke
// inicial (`getNetworkRequests`) e o push ao vivo (`onNetworkUpdate`) chegarem
// em ordens diferentes a cada execução; fundir por `id` via Map é imune a essa
// ordem — não importa quantas vezes ou em que ordem cada fonte atualiza o
// mesmo id, o resultado final nunca tem duas linhas pro mesmo request.
function mergeById(prev: NetworkRequest[], incoming: NetworkRequest[]): NetworkRequest[] {
  const byId = new Map(prev.map((request): [string, NetworkRequest] => [request.id, request]))
  for (const request of incoming) byId.set(request.id, request)
  return [...byId.values()]
}

export function useNetwork(deviceId: string | undefined): UseNetwork {
  const [requests, setRequests] = useState<NetworkRequest[]>([])

  useEffect(() => {
    if (!deviceId) return

    let active = true

    void window.api.getNetworkRequests(deviceId).then((initial) => {
      if (active) setRequests((prev) => mergeById(prev, initial))
    })

    const unsubscribe = window.api.onNetworkUpdate((entryDeviceId, request) => {
      if (entryDeviceId !== deviceId) return
      setRequests((prev) => mergeById(prev, [request]))
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [deviceId])

  const clear = useCallback(() => setRequests([]), [])

  return { requests, clear }
}
