import { useState } from 'react'
import { useDevices } from './shared/useDevices'
import { useEvaluate, type EvaluateState } from './shared/useEvaluate'
import { ConsolePanel } from './features/console/components/ConsolePanel'

// UI temporária de verificação do M1: cada device ganha um botão "Run 2+2" que
// roda `2 + 2` via CDP naquele device e mostra o retorno. Sai quando o REPL
// (próxima fatia do M2) substituir esse botão por um input de comando de verdade.
function EvaluateOutput({ state }: { state: EvaluateState | undefined }): React.JSX.Element | null {
  if (!state || state.status === 'idle') return null
  if (state.status === 'loading') {
    return <span className="font-mono text-xs text-foreground-muted">…</span>
  }
  if (state.result.ok) {
    return <span className="font-mono text-xs text-success">{String(state.result.value)}</span>
  }
  return (
    <span className="font-mono text-xs text-error" title={state.result.message}>
      {state.result.error}
    </span>
  )
}

function App(): React.JSX.Element {
  const devices = useDevices()
  const { states, run } = useEvaluate()
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>()

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        {devices.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">Nenhum dispositivo conectado</p>
        ) : (
          <ul className="flex flex-col">
            {devices.map((device) => {
              const state = states[device.id]
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
                  <div className="flex items-center gap-2 px-4 pb-3">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void run(device.id, '2 + 2')
                      }}
                      disabled={state?.status === 'loading'}
                      className="rounded-sm bg-surface-elevated px-2 py-1 text-xs text-foreground disabled:opacity-50"
                    >
                      Run 2+2
                    </button>
                    <EvaluateOutput state={state} />
                  </div>
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
