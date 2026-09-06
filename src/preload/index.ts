import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'
import type { EvaluateResult } from '../protocol/evaluate'
import type { ConsoleEntry } from '../protocol/console'

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
