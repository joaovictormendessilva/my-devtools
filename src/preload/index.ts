import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'
import type { EvaluateResult } from '../protocol/evaluate'

// O preload é a ÚNICA ponte entre o processo main e o renderer. O renderer roda
// sem acesso a Node (contextIsolation ligado, nodeIntegration desligado — ver
// src/main/index.ts), então tudo que ele pode chamar no main passa por aqui via
// contextBridge. Além da ponte genérica do @electron-toolkit (window.electron),
// expomos funções nomeadas e tipadas em window.api — nunca um canal de IPC solto
// no renderer.
const api = {
  listDevices: (): Promise<Device[]> => ipcRenderer.invoke('devices:list'),
  // Temporário do M1: roda uma expressão via CDP no device e devolve o resultado.
  evaluate: (deviceId: string, expression: string): Promise<EvaluateResult> =>
    ipcRenderer.invoke('devices:evaluate', deviceId, expression)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
