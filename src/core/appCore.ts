import { DeviceManager } from '../devices/deviceManager'
import { SessionManager } from '../sessions/sessionManager'

export interface AppCore {
  deviceManager: DeviceManager
  sessionManager: SessionManager
}

// Orquestra DeviceManager + SessionManager (ver ARCHITECTURE.md §3). `main/`
// consome só isto — nunca instancia `devices/`/`sessions/` diretamente.
export function createAppCore(): AppCore {
  const deviceManager = new DeviceManager()
  const sessionManager = new SessionManager(deviceManager)
  return { deviceManager, sessionManager }
}
