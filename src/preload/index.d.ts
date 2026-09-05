import { ElectronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      listDevices: () => Promise<Device[]>
    }
  }
}
