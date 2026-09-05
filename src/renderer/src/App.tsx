import { useDevices } from './shared/useDevices'

function App(): React.JSX.Element {
  const devices = useDevices()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        {devices.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">Nenhum dispositivo conectado</p>
        ) : (
          <ul className="flex flex-col">
            {devices.map((device) => (
              <li key={device.id} className="border-b border-border px-4 py-3">
                <p className="truncate text-sm text-foreground">{device.name}</p>
                <p className="truncate font-mono text-xs text-foreground-muted">{device.id}</p>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <main className="flex-1" />
    </div>
  )
}

export default App
