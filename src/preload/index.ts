import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'

// O preload é a ÚNICA ponte entre o processo main e o renderer. O renderer roda
// sem acesso a Node (contextIsolation ligado, nodeIntegration desligado — ver
// src/main/index.ts), então tudo que ele pode chamar no main passa por aqui via
// contextBridge. Além da ponte genérica do @electron-toolkit (window.electron),
// expomos funções nomeadas e tipadas em window.api — nunca um canal de IPC solto
// no renderer. M1: só a lista de dispositivos descobertos pelo Metro.
const api = {
  listDevices: (): Promise<Device[]> => ipcRenderer.invoke('devices:list')
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
