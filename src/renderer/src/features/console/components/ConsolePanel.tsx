import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsDown, ChevronsUp, Copy, Trash2 } from 'lucide-react'
import type { ConsoleEntry, ConsoleLevel } from '../../../../../protocol/console'
import { useConsole } from '../hooks/useConsole'

const COPIED_FEEDBACK_MS = 1500

function entryToText(entry: ConsoleEntry): string {
  return `${formatTime(entry.timestamp)}  ${entry.text}`
}

// Ícone de copiar com feedback visual (vira um check por um instante) — usado
// tanto na linha individual quanto no "copiar tudo" da toolbar.
function CopyButton({
  title,
  getText
}: {
  title: string
  getText: () => string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleClick = (): void => {
    void navigator.clipboard.writeText(getText())
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  return (
    <button
      type="button"
      title={title}
      onClick={handleClick}
      className="text-foreground-muted hover:text-foreground"
    >
      {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
    </button>
  )
}

const LEVEL_CLASS: Record<ConsoleLevel, string> = {
  log: 'text-foreground',
  info: 'text-foreground',
  debug: 'text-foreground-muted',
  warn: 'text-warning',
  error: 'text-error'
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

// `console.warn`/`console.error` do React Native anexam a stack trace da
// chamada na própria mensagem. O Metro symbolica (ver `symbolicate.ts`), mas o
// stack ainda pode ter várias linhas — escondido atrás de "mais detalhes" por
// padrão, com o estado de aberto/fechado controlado pelo painel (pros botões
// de expandir/recolher tudo funcionarem).
function ConsoleRow({
  entry,
  expanded,
  onToggle
}: {
  entry: ConsoleEntry
  expanded: boolean
  onToggle: (open: boolean) => void
}): React.JSX.Element {
  const [firstLine, ...rest] = entry.text.split('\n')
  const extra = rest.join('\n')

  return (
    <div className="border-b border-border px-3 py-1.5 font-mono text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="shrink-0 text-foreground-muted">{formatTime(entry.timestamp)}</span>
          <span className={`min-w-0 whitespace-pre-wrap break-all ${LEVEL_CLASS[entry.level]}`}>
            {firstLine}
          </span>
        </div>
        <div className="shrink-0">
          <CopyButton title="Copiar mensagem" getText={() => entryToText(entry)} />
        </div>
      </div>
      {extra && (
        <details
          className="mt-1 ml-4"
          open={expanded}
          onToggle={(event) => onToggle(event.currentTarget.open)}
        >
          <summary className="cursor-pointer text-foreground-muted">mais detalhes</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all text-foreground-muted">{extra}</pre>
        </details>
      )}
    </div>
  )
}

export function ConsolePanel({ deviceId }: { deviceId: string | undefined }): React.JSX.Element {
  const { entries, clear } = useConsole(deviceId)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [entries.length])

  if (!deviceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-foreground-muted">Selecione um dispositivo para ver o console</p>
      </div>
    )
  }

  const toggleEntry = (id: string, open: boolean): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Console</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-foreground-muted">{entries.length} mensagens</span>
          <button
            type="button"
            title="Expandir tudo"
            onClick={() => setExpandedIds(new Set(entries.map((entry) => entry.id)))}
            className="text-foreground-muted hover:text-foreground"
          >
            <ChevronsDown size={14} />
          </button>
          <button
            type="button"
            title="Recolher tudo"
            onClick={() => setExpandedIds(new Set())}
            className="text-foreground-muted hover:text-foreground"
          >
            <ChevronsUp size={14} />
          </button>
          <CopyButton title="Copiar tudo" getText={() => entries.map(entryToText).join('\n')} />
          <button
            type="button"
            title="Limpar console"
            onClick={clear}
            className="text-foreground-muted hover:text-foreground"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">Nenhuma mensagem ainda</p>
        ) : (
          <>
            {entries.map((entry) => (
              <ConsoleRow
                key={entry.id}
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                onToggle={(open) => toggleEntry(entry.id, open)}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>
    </div>
  )
}
