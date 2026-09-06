import { useState } from 'react'
import { useDevices } from './shared/useDevices'
import { ConsolePanel } from './features/console/components/ConsolePanel'
import { DebuggerPanel } from './features/debugger/components/DebuggerPanel'

type PanelId = 'console' | 'debugger'

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'debugger', label: 'Debugger' }
]

function App(): React.JSX.Element {
  const devices = useDevices()
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>()
  const [activePanel, setActivePanel] = useState<PanelId>('console')

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
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 border-b border-border">
          {PANELS.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => setActivePanel(panel.id)}
              className={`border-b-2 px-4 py-2 text-sm transition-colors ${
                activePanel === panel.id
                  ? 'border-accent text-foreground'
                  : 'border-transparent text-foreground-muted hover:text-foreground'
              }`}
            >
              {panel.label}
            </button>
          ))}
        </div>
        {/* Os dois painéis ficam sempre montados (só escondidos) — trocar de
            aba não pode zerar o histórico do REPL ou o estado do debugger.
            Trocar de device, sim (key={selectedDeviceId}), isso é isolamento
            de verdade entre sessões. */}
        <div className="flex-1 overflow-hidden">
          <div className={activePanel === 'console' ? 'h-full' : 'hidden'}>
            <ConsolePanel key={selectedDeviceId} deviceId={selectedDeviceId} />
          </div>
          <div className={activePanel === 'debugger' ? 'h-full' : 'hidden'}>
            <DebuggerPanel key={selectedDeviceId} deviceId={selectedDeviceId} />
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
