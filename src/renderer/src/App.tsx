import { useDevices } from './shared/useDevices'
import { useEvaluate, type EvaluateState } from './shared/useEvaluate'

// UI temporária de verificação do M1: cada device ganha um botão "Run 2+2" que
// roda `2 + 2` via CDP naquele device e mostra o retorno. Prova o transporte
// ponta-a-ponta e o isolamento por device. Sai quando o painel Console (M2) entrar.
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

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
        {devices.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">Nenhum dispositivo conectado</p>
        ) : (
          <ul className="flex flex-col">
            {devices.map((device) => {
              const state = states[device.id]
              return (
                <li key={device.id} className="border-b border-border px-4 py-3">
                  <p className="truncate text-sm text-foreground">{device.name}</p>
                  <p className="truncate font-mono text-xs text-foreground-muted">{device.id}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void run(device.id, '2 + 2')}
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
      <main className="flex-1" />
    </div>
  )
}

export default App
