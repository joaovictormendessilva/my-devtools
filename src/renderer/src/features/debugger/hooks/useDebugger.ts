import { useCallback, useEffect, useState } from 'react'
import type { DebuggerCommandResult, DebuggerState } from '../../../../../protocol/debugger'

const IDLE_STATE: DebuggerState = { status: 'idle', frames: [], scopes: [], breakpoints: [] }

export interface UseDebugger {
  state: DebuggerState
  /** Erro de um comando, ou aviso de sucesso "estranho" (ex: breakpoint sem
   *  script correspondente carregado ainda) — ver `DebuggerCommandResult`. */
  notice: string | undefined
  setBreakpoint: (file: string, lineNumber: number) => Promise<void>
  removeBreakpoint: (breakpointId: string) => Promise<void>
  resume: () => Promise<void>
  stepOver: () => Promise<void>
  stepInto: () => Promise<void>
  stepOut: () => Promise<void>
}

export function useDebugger(deviceId: string | undefined): UseDebugger {
  const [state, setState] = useState<DebuggerState>(IDLE_STATE)
  const [notice, setNotice] = useState<string | undefined>()

  useEffect(() => {
    if (!deviceId) return

    let active = true

    void window.api.getDebuggerState(deviceId).then((initial) => {
      if (active) setState(initial)
    })

    const unsubscribe = window.api.onDebuggerUpdate((entryDeviceId, update) => {
      if (entryDeviceId !== deviceId) return
      setState(update)
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [deviceId])

  const run = useCallback(
    async (command: (id: string) => Promise<DebuggerCommandResult>): Promise<void> => {
      if (!deviceId) return
      const result = await command(deviceId)
      setNotice(result.ok ? result.warning : result.message)
    },
    [deviceId]
  )

  return {
    state,
    notice,
    setBreakpoint: (file, lineNumber) =>
      run((id) => window.api.setBreakpoint(id, file, lineNumber)),
    removeBreakpoint: (breakpointId) => run((id) => window.api.removeBreakpoint(id, breakpointId)),
    resume: () => run(window.api.debuggerResume),
    stepOver: () => run(window.api.debuggerStepOver),
    stepInto: () => run(window.api.debuggerStepInto),
    stepOut: () => run(window.api.debuggerStepOut)
  }
}
