import { ElectronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'
import type { EvaluateResult } from '../protocol/evaluate'
import type { ConsoleEntry } from '../protocol/console'
import type { DebuggerCommandResult, DebuggerState } from '../protocol/debugger'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      listDevices: () => Promise<Device[]>
      evaluate: (deviceId: string, expression: string) => Promise<EvaluateResult>
      getConsoleEntries: (deviceId: string) => Promise<ConsoleEntry[]>
      onConsoleMessage: (callback: (deviceId: string, entry: ConsoleEntry) => void) => () => void
      getDebuggerState: (deviceId: string) => Promise<DebuggerState>
      getKnownScripts: (deviceId: string) => Promise<string[]>
      setBreakpoint: (
        deviceId: string,
        file: string,
        lineNumber: number
      ) => Promise<DebuggerCommandResult>
      removeBreakpoint: (deviceId: string, breakpointId: string) => Promise<DebuggerCommandResult>
      debuggerResume: (deviceId: string) => Promise<DebuggerCommandResult>
      debuggerStepOver: (deviceId: string) => Promise<DebuggerCommandResult>
      debuggerStepInto: (deviceId: string) => Promise<DebuggerCommandResult>
      debuggerStepOut: (deviceId: string) => Promise<DebuggerCommandResult>
      onDebuggerUpdate: (callback: (deviceId: string, state: DebuggerState) => void) => () => void
    }
  }
}
