import { useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, Play, X } from 'lucide-react'
import { useDebugger } from '../hooks/useDebugger'

const STEP_BUTTON_CLASS =
  'text-foreground-muted hover:text-foreground disabled:opacity-40 disabled:hover:text-foreground-muted'

const KNOWN_SOURCE_FILES_DATALIST_ID = 'debugger-known-source-files'

// Seção colapsável — controlado (não só `defaultOpen`) porque o painel
// re-renderiza a cada `debugger:update` (todo step/pause/resume); com um
// `open` não-controlado o React reaplicaria o valor inicial a cada render e
// desfaria qualquer collapse manual do usuário.
function Section({
  title,
  open,
  onToggle,
  children
}: {
  title: string
  open: boolean
  onToggle: (open: boolean) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <details
      className="border-b border-border px-4 py-2"
      open={open}
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-medium text-foreground-secondary">
        {title}
      </summary>
      <div className="mt-1">{children}</div>
    </details>
  )
}

// Sem visualizador de código-fonte ainda (não está no roadmap desta fatia) —
// o breakpoint é setado indicando arquivo + linha manualmente, olhando o
// código no editor. O `<datalist>` sugere os arquivos-fonte do source map do
// bundle (ver `knownSourceFiles` no hook) — é a única forma de saber o que
// digitar sem um visualizador; a posição é traduzida pro bundle nos
// bastidores (ver `sourcePosition.ts`), então nem sempre vai existir pra uma
// linha sem código executável.
function BreakpointForm({
  knownSourceFiles,
  onSubmit
}: {
  knownSourceFiles: string[]
  onSubmit: (file: string, lineNumber: number) => void
}): React.JSX.Element {
  const [file, setFile] = useState('')
  const [line, setLine] = useState('')

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    const lineNumber = Number(line)
    if (!file.trim() || !Number.isInteger(lineNumber) || lineNumber < 1) return
    onSubmit(file.trim(), lineNumber)
    setFile('')
    setLine('')
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2"
    >
      <input
        type="text"
        list={KNOWN_SOURCE_FILES_DATALIST_ID}
        value={file}
        onChange={(event) => setFile(event.target.value)}
        placeholder="arquivo (ex: App.js)"
        className="min-w-0 flex-1 rounded-sm bg-surface-elevated px-2 py-1 font-mono text-xs text-foreground outline-none placeholder:text-foreground-muted"
      />
      <datalist id={KNOWN_SOURCE_FILES_DATALIST_ID}>
        {knownSourceFiles.map((file) => (
          <option key={file} value={file} />
        ))}
      </datalist>
      <input
        type="number"
        value={line}
        onChange={(event) => setLine(event.target.value)}
        placeholder="linha"
        className="w-20 rounded-sm bg-surface-elevated px-2 py-1 font-mono text-xs text-foreground outline-none placeholder:text-foreground-muted"
      />
      <button type="submit" className="rounded-sm bg-accent px-3 py-1 text-xs text-foreground">
        Adicionar breakpoint
      </button>
    </form>
  )
}

export function DebuggerPanel({ deviceId }: { deviceId: string | undefined }): React.JSX.Element {
  const {
    state,
    notice,
    knownSourceFiles,
    setBreakpoint,
    removeBreakpoint,
    resume,
    stepOver,
    stepInto,
    stepOut
  } = useDebugger(deviceId)
  const [openSections, setOpenSections] = useState({
    breakpoints: true,
    callStack: true,
    knownFiles: false,
    scopes: true
  })

  if (!deviceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-foreground-muted">
          Selecione um dispositivo para ver o debugger
        </p>
      </div>
    )
  }

  const isPaused = state.status === 'paused'
  const toggleSection = (key: keyof typeof openSections, open: boolean): void =>
    setOpenSections((prev) => ({ ...prev, [key]: open }))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Debugger</h2>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${isPaused ? 'text-warning' : 'text-foreground-muted'}`}>
            {isPaused ? 'Pausado' : 'Rodando'}
          </span>
          <button
            type="button"
            title="Continuar"
            onClick={resume}
            disabled={!isPaused}
            className={STEP_BUTTON_CLASS}
          >
            <Play size={14} />
          </button>
          <button
            type="button"
            title="Step over"
            onClick={stepOver}
            disabled={!isPaused}
            className={STEP_BUTTON_CLASS}
          >
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            title="Step into"
            onClick={stepInto}
            disabled={!isPaused}
            className={STEP_BUTTON_CLASS}
          >
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            title="Step out"
            onClick={stepOut}
            disabled={!isPaused}
            className={STEP_BUTTON_CLASS}
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>

      <BreakpointForm knownSourceFiles={knownSourceFiles} onSubmit={setBreakpoint} />

      {notice && (
        <p className="shrink-0 border-b border-border px-4 py-2 text-xs text-warning">{notice}</p>
      )}

      <div className="flex-1 overflow-y-auto">
        <Section
          title={`Breakpoints (${state.breakpoints.length})`}
          open={openSections.breakpoints}
          onToggle={(open) => toggleSection('breakpoints', open)}
        >
          {state.breakpoints.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nenhum breakpoint</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {state.breakpoints.map((breakpoint) => (
                <li
                  key={breakpoint.id}
                  className="flex items-center justify-between font-mono text-xs text-foreground"
                >
                  <span>
                    {breakpoint.file}:{breakpoint.lineNumber}
                  </span>
                  <button
                    type="button"
                    title="Remover"
                    onClick={() => void removeBreakpoint(breakpoint.id)}
                    className="text-foreground-muted hover:text-error"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Call stack"
          open={openSections.callStack}
          onToggle={(open) => toggleSection('callStack', open)}
        >
          {!isPaused ? (
            <p className="text-xs text-foreground-muted">Não pausado</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {state.frames.map((frame, index) => (
                <li
                  key={frame.callFrameId}
                  className={`font-mono text-xs ${index === 0 ? 'text-foreground' : 'text-foreground-muted'}`}
                >
                  {frame.functionName} ({frame.file}:{frame.lineNumber}:{frame.columnNumber})
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={`Arquivos conhecidos (${knownSourceFiles.length})`}
          open={openSections.knownFiles}
          onToggle={(open) => toggleSection('knownFiles', open)}
        >
          {knownSourceFiles.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nenhum ainda</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {knownSourceFiles.map((file) => (
                <li key={file} className="truncate font-mono text-xs text-foreground-muted">
                  {file}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Scopes (frame atual)"
          open={openSections.scopes}
          onToggle={(open) => toggleSection('scopes', open)}
        >
          {!isPaused || state.scopes.length === 0 ? (
            <p className="text-xs text-foreground-muted">Nenhuma variável</p>
          ) : (
            state.scopes.map((scope) => (
              <div key={scope.type} className="mb-2">
                <p className="text-xs text-foreground-muted">{scope.type}</p>
                <ul className="flex flex-col gap-0.5 pl-2">
                  {scope.variables.map((variable) => (
                    <li key={variable.name} className="font-mono text-xs text-foreground">
                      {variable.name} = {variable.value}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Section>
      </div>
    </div>
  )
}
