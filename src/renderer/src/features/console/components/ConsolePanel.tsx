import { useEffect, useRef, useState } from 'react'
import { Check, ChevronsDown, ChevronsUp, Copy, Search, Trash2 } from 'lucide-react'
import type { ConsoleEntry, ConsoleLevel } from '../../../../../protocol/console'
import { useConsole } from '../hooks/useConsole'
import { useRepl, type ReplEntry } from '../hooks/useRepl'

const COPIED_FEEDBACK_MS = 1500

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatReplValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function entryToText(entry: ConsoleEntry): string {
  return `${formatTime(entry.timestamp)}  ${entry.text}`
}

function replResultText(repl: ReplEntry): string {
  if (repl.status === 'loading') return '…'
  if (!repl.result) return ''
  return repl.result.ok ? formatReplValue(repl.result.value) : repl.result.error
}

function replToText(repl: ReplEntry): string {
  return `${formatTime(repl.timestamp)}  > ${repl.expression}\n${replResultText(repl)}`
}

// Intercala mensagens de console e comandos do REPL num único scrollback, na
// ordem em que aconteceram — igual ao console do Chrome DevTools, onde o que
// você digitou aparece junto com os logs do app, não numa área separada.
type ScrollbackRow =
  | { kind: 'console'; key: string; timestamp: number; entry: ConsoleEntry }
  | { kind: 'repl'; key: string; timestamp: number; repl: ReplEntry }

function buildScrollback(entries: ConsoleEntry[], replEntries: ReplEntry[]): ScrollbackRow[] {
  const rows: ScrollbackRow[] = [
    ...entries.map((entry) => ({
      kind: 'console' as const,
      key: `c-${entry.id}`,
      timestamp: entry.timestamp,
      entry
    })),
    ...replEntries.map((repl) => ({
      kind: 'repl' as const,
      key: `r-${repl.id}`,
      timestamp: repl.timestamp,
      repl
    }))
  ]
  return rows.sort((a, b) => a.timestamp - b.timestamp)
}

function rowToText(row: ScrollbackRow): string {
  return row.kind === 'console' ? entryToText(row.entry) : replToText(row.repl)
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

const ALL_LEVELS: ConsoleLevel[] = ['log', 'info', 'debug', 'warn', 'error']

// Filtro por nível só afeta linhas de console — comandos do REPL não têm
// `level` (não vêm do CDP), então ficam sempre visíveis quanto a esse filtro.
function matchesFilters(
  row: ScrollbackRow,
  query: string,
  activeLevels: Set<ConsoleLevel>
): boolean {
  if (row.kind === 'console' && !activeLevels.has(row.entry.level)) return false
  if (!query) return true
  return rowToText(row).toLowerCase().includes(query)
}

function LevelToggle({
  level,
  active,
  onToggle
}: {
  level: ConsoleLevel
  active: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-sm px-2 py-0.5 font-mono text-xs ${LEVEL_CLASS[level]} ${
        active ? 'bg-surface-elevated' : 'opacity-40'
      }`}
    >
      {level}
    </button>
  )
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

function ReplRow({ repl }: { repl: ReplEntry }): React.JSX.Element {
  return (
    <div className="border-b border-border px-3 py-1.5 font-mono text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <span className="shrink-0 text-foreground-muted">{formatTime(repl.timestamp)}</span>
          <span className="min-w-0 whitespace-pre-wrap break-all text-accent">
            {'> '}
            {repl.expression}
          </span>
        </div>
        <div className="shrink-0">
          <CopyButton title="Copiar comando" getText={() => replToText(repl)} />
        </div>
      </div>
      <div className="ml-4 mt-1">
        {repl.status === 'loading' ? (
          <span className="text-foreground-muted">…</span>
        ) : repl.result?.ok ? (
          <span className="whitespace-pre-wrap break-all text-success">
            {formatReplValue(repl.result.value)}
          </span>
        ) : (
          <span className="whitespace-pre-wrap break-all text-error" title={repl.result?.message}>
            {repl.result?.error}
          </span>
        )}
      </div>
    </div>
  )
}

// Recall de comandos com as setas ↑/↓, igual ao console do Chrome DevTools.
function ReplInput({
  history,
  onSubmit
}: {
  history: string[]
  onSubmit: (expression: string) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      const expression = value.trim()
      if (!expression) return
      onSubmit(expression)
      setValue('')
      setHistoryIndex(null)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (history.length === 0) return
      const nextIndex = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(nextIndex)
      setValue(history[nextIndex])
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (historyIndex === null) return
      const nextIndex = historyIndex + 1
      if (nextIndex >= history.length) {
        setHistoryIndex(null)
        setValue('')
      } else {
        setHistoryIndex(nextIndex)
        setValue(history[nextIndex])
      }
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
      <span className="font-mono text-xs text-accent">{'>'}</span>
      <input
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Avaliar expressão JavaScript…"
        spellCheck={false}
        className="flex-1 bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-foreground-muted"
      />
    </div>
  )
}

export function ConsolePanel({ deviceId }: { deviceId: string | undefined }): React.JSX.Element {
  const { entries, clear } = useConsole(deviceId)
  const { entries: replEntries, history, run, clear: clearRepl } = useRepl(deviceId)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [activeLevels, setActiveLevels] = useState<Set<ConsoleLevel>>(new Set(ALL_LEVELS))
  const bottomRef = useRef<HTMLDivElement>(null)

  const rows = buildScrollback(entries, replEntries)
  const query = searchQuery.trim().toLowerCase()
  const visibleRows = rows.filter((row) => matchesFilters(row, query, activeLevels))

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [visibleRows.length])

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

  const toggleLevel = (level: ConsoleLevel): void => {
    setActiveLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const clearAll = (): void => {
    clear()
    clearRepl()
  }

  const visibleConsoleEntryIds = visibleRows
    .filter((row) => row.kind === 'console')
    .map((row) => row.entry.id)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Console</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-foreground-muted">{entries.length} mensagens</span>
          <button
            type="button"
            title="Expandir tudo"
            onClick={() => setExpandedIds(new Set(visibleConsoleEntryIds))}
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
          <CopyButton title="Copiar tudo" getText={() => visibleRows.map(rowToText).join('\n')} />
          <button
            type="button"
            title="Limpar console"
            onClick={clearAll}
            className="text-foreground-muted hover:text-foreground"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-surface-elevated px-2 py-1">
          <Search size={14} className="shrink-0 text-foreground-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Buscar no console…"
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground-muted"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {ALL_LEVELS.map((level) => (
            <LevelToggle
              key={level}
              level={level}
              active={activeLevels.has(level)}
              onToggle={() => toggleLevel(level)}
            />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visibleRows.length === 0 ? (
          <p className="p-4 text-sm text-foreground-muted">
            {rows.length === 0
              ? 'Nenhuma mensagem ainda'
              : 'Nenhuma mensagem corresponde ao filtro'}
          </p>
        ) : (
          <>
            {visibleRows.map((row) =>
              row.kind === 'console' ? (
                <ConsoleRow
                  key={row.key}
                  entry={row.entry}
                  expanded={expandedIds.has(row.entry.id)}
                  onToggle={(open) => toggleEntry(row.entry.id, open)}
                />
              ) : (
                <ReplRow key={row.key} repl={row.repl} />
              )
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>
      <ReplInput history={history} onSubmit={run} />
    </div>
  )
}
