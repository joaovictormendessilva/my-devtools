import { useCallback, useEffect, useState } from 'react'
import type { DebuggerCommandResult, DebuggerState } from '../../../../../protocol/debugger'

const IDLE_STATE: DebuggerState = { status: 'idle', frames: [], scopes: [], breakpoints: [] }

export interface UseDebugger {
  state: DebuggerState
  /** Erro de um comando, ou aviso de sucesso "estranho" (ex: breakpoint sem
   *  posição resolvida ainda) — ver `DebuggerCommandResult`. */
  notice: string | undefined
  /** Arquivos-fonte do source map do bundle — sem visualizador de código, é a
   *  referência de que arquivo/caminho digitar num breakpoint. */
  knownSourceFiles: string[]
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
  const [knownSourceFiles, setKnownSourceFiles] = useState<string[]>([])

  useEffect(() => {
    if (!deviceId) return

    let active = true

    void window.api.getDebuggerState(deviceId).then((initial) => {
      if (active) setState(initial)
    })
    void window.api.getKnownSourceFiles(deviceId).then((files) => {
      if (active) setKnownSourceFiles(files)
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
      // Um arquivo novo pode ter aparecido no bundle desde o mount (ex:
      // navegou pra outra tela) — atualiza a lista de sugestões depois de
      // qualquer comando.
      void window.api.getKnownSourceFiles(deviceId).then(setKnownSourceFiles)
    },
    [deviceId]
  )

  return {
    state,
    notice,
    knownSourceFiles,
    setBreakpoint: (file, lineNumber) =>
      run((id) => window.api.setBreakpoint(id, file, lineNumber)),
    removeBreakpoint: (breakpointId) => run((id) => window.api.removeBreakpoint(id, breakpointId)),
    resume: () => run(window.api.debuggerResume),
    stepOver: () => run(window.api.debuggerStepOver),
    stepInto: () => run(window.api.debuggerStepInto),
    stepOut: () => run(window.api.debuggerStepOut)
  }
}
