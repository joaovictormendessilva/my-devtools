import { useState } from 'react'
import { useDevices } from './shared/useDevices'
import { ConsolePanel } from './features/console/components/ConsolePanel'

function App(): React.JSX.Element {
  const devices = useDevices()
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        {devices.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">Nenhum dispositivo conectado</p>
        ) : (
          <ul className="flex flex-col">
            {devices.map((device) => {
              const isSelected = device.id === selectedDeviceId
              return (
                <li key={device.id} className="border-b border-border">
                  <button
                    type="button"
                    onClick={() => setSelectedDeviceId(device.id)}
                    className={`w-full border-l-2 px-4 py-3 text-left transition-colors hover:bg-surface-elevated ${
                      isSelected ? 'border-accent bg-surface-elevated' : 'border-transparent'
                    }`}
                  >
                    <p className="truncate text-sm text-foreground">{device.name}</p>
                    <p className="truncate font-mono text-xs text-foreground-muted">{device.id}</p>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </aside>
      <main className="flex-1 overflow-hidden">
        <ConsolePanel key={selectedDeviceId} deviceId={selectedDeviceId} />
      </main>
    </div>
  )
}

export default App
