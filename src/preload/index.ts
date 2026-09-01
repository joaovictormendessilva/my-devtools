import { contextBridge } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// O preload é a ÚNICA ponte entre o processo main e o renderer. O renderer roda
// sem acesso a Node (contextIsolation ligado, nodeIntegration desligado — ver
// src/main/index.ts), então tudo que ele pode chamar no main passa por aqui via
// contextBridge. No M0 só expomos a ponte genérica do @electron-toolkit
// (ipcRenderer com allowlist de canais); APIs específicas de Device/Session
// entram a partir do M1.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
  } catch (error) {
    console.error(error)
  }
}
