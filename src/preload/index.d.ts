import { ElectronAPI } from '@electron-toolkit/preload'
import type { Device } from '../protocol/device'
import type { EvaluateResult } from '../protocol/evaluate'
import type { ConsoleEntry } from '../protocol/console'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      listDevices: () => Promise<Device[]>
      evaluate: (deviceId: string, expression: string) => Promise<EvaluateResult>
      getConsoleEntries: (deviceId: string) => Promise<ConsoleEntry[]>
      onConsoleMessage: (callback: (deviceId: string, entry: ConsoleEntry) => void) => () => void
    }
  }
}
