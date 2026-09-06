import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'
import type { EvaluateResult } from '../protocol/evaluate'
import type { ConsoleEntry } from '../protocol/console'
import type { DebuggerCommandResult, DebuggerState } from '../protocol/debugger'

// O preload é a ÚNICA ponte entre o processo main e o renderer. O renderer roda
// sem acesso a Node (contextIsolation ligado, nodeIntegration desligado — ver
// src/main/index.ts), então tudo que ele pode chamar no main passa por aqui via
// contextBridge. Além da ponte genérica do @electron-toolkit (window.electron),
// expomos funções nomeadas e tipadas em window.api — nunca um canal de IPC solto
// no renderer.
const api = {
  listDevices: (): Promise<Device[]> => ipcRenderer.invoke('devices:list'),
  // Roda uma expressão JavaScript via CDP no device (REPL do painel Console).
  evaluate: (deviceId: string, expression: string): Promise<EvaluateResult> =>
    ipcRenderer.invoke('devices:evaluate', deviceId, expression),
  getConsoleEntries: (deviceId: string): Promise<ConsoleEntry[]> =>
    ipcRenderer.invoke('devices:consoleEntries', deviceId),
  onConsoleMessage: (callback: (deviceId: string, entry: ConsoleEntry) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      deviceId: string,
      entry: ConsoleEntry
    ): void => callback(deviceId, entry)
    ipcRenderer.on('console:message', listener)
    return () => ipcRenderer.removeListener('console:message', listener)
  },
  getDebuggerState: (deviceId: string): Promise<DebuggerState> =>
    ipcRenderer.invoke('devices:debuggerState', deviceId),
  setBreakpoint: (
    deviceId: string,
    file: string,
    lineNumber: number
  ): Promise<DebuggerCommandResult> =>
    ipcRenderer.invoke('devices:setBreakpoint', deviceId, file, lineNumber),
  removeBreakpoint: (deviceId: string, breakpointId: string): Promise<DebuggerCommandResult> =>
    ipcRenderer.invoke('devices:removeBreakpoint', deviceId, breakpointId),
  debuggerResume: (deviceId: string): Promise<DebuggerCommandResult> =>
    ipcRenderer.invoke('devices:debuggerResume', deviceId),
  debuggerStepOver: (deviceId: string): Promise<DebuggerCommandResult> =>
    ipcRenderer.invoke('devices:debuggerStepOver', deviceId),
  debuggerStepInto: (deviceId: string): Promise<DebuggerCommandResult> =>
    ipcRenderer.invoke('devices:debuggerStepInto', deviceId),
  debuggerStepOut: (deviceId: string): Promise<DebuggerCommandResult> =>
    ipcRenderer.invoke('devices:debuggerStepOut', deviceId),
  onDebuggerUpdate: (callback: (deviceId: string, state: DebuggerState) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      deviceId: string,
      state: DebuggerState
    ): void => callback(deviceId, state)
    ipcRenderer.on('debugger:update', listener)
    return () => ipcRenderer.removeListener('debugger:update', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
