import { useCallback, useEffect, useState } from 'react'
import type { DebuggerCommandResult, DebuggerState } from '../../../../../protocol/debugger'

const IDLE_STATE: DebuggerState = { status: 'idle', frames: [], scopes: [], breakpoints: [] }

export interface UseDebugger {
  state: DebuggerState
  error: string | undefined
  setBreakpoint: (file: string, lineNumber: number) => Promise<void>
  removeBreakpoint: (breakpointId: string) => Promise<void>
  resume: () => Promise<void>
  stepOver: () => Promise<void>
  stepInto: () => Promise<void>
  stepOut: () => Promise<void>
}

export function useDebugger(deviceId: string | undefined): UseDebugger {
  const [state, setState] = useState<DebuggerState>(IDLE_STATE)
  const [error, setError] = useState<string | undefined>()

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
      setError(result.ok ? undefined : result.message)
    },
    [deviceId]
  )

  return {
    state,
    error,
    setBreakpoint: (file, lineNumber) =>
      run((id) => window.api.setBreakpoint(id, file, lineNumber)),
    removeBreakpoint: (breakpointId) => run((id) => window.api.removeBreakpoint(id, breakpointId)),
    resume: () => run(window.api.debuggerResume),
    stepOver: () => run(window.api.debuggerStepOver),
    stepInto: () => run(window.api.debuggerStepInto),
    stepOut: () => run(window.api.debuggerStepOut)
  }
}
