import { ElectronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'
import type { EvaluateResult } from '../protocol/evaluate'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      listDevices: () => Promise<Device[]>
      evaluate: (deviceId: string, expression: string) => Promise<EvaluateResult>
    }
  }
}
