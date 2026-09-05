import { useCallback, useEffect, useState } from 'react'
import type { ConsoleEntry } from '../../../../../protocol/console'

export interface UseConsole {
  entries: ConsoleEntry[]
  /** Limpa só a lista exibida (como o "clear console" do Chrome DevTools) — não
   *  apaga o buffer do SessionManager, que segue capturando normalmente. */
  clear: () => void
}

// Ao trocar de device, o histórico visível é só o que o SessionManager já
// capturou daquele device (CDP não tem replay — `Runtime.consoleAPICalled` só
// dispara pra frente). Eventos novos chegam via `onConsoleMessage`, filtrados
// pelo `deviceId` — cada device mantém sua lista isolada.
//
// O componente que usa este hook precisa remontar ao trocar de device (`key`
// no JSX) — é assim que o estado zera entre devices, sem chamar `setState`
// direto no corpo do effect (anti-padrão: causa um render em cascata extra).
export function useConsole(deviceId: string | undefined): UseConsole {
  const [entries, setEntries] = useState<ConsoleEntry[]>([])

  useEffect(() => {
    if (!deviceId) return

    let active = true

    void window.api.getConsoleEntries(deviceId).then((initial) => {
      if (active) setEntries(initial)
    })

    const unsubscribe = window.api.onConsoleMessage((entryDeviceId, entry) => {
      if (entryDeviceId !== deviceId) return
      setEntries((prev) => [...prev, entry])
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [deviceId])

  const clear = useCallback(() => setEntries([]), [])

  return { entries, clear }
}
