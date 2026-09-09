import { useState } from 'react'
import { Check, Copy, Search, Trash2 } from 'lucide-react'
import type { NetworkRequest } from '../../../../../protocol/network'
import type { EvaluateResult } from '../../../../../protocol/evaluate'
import { Section } from '../../../shared/components/ui/Section'
import { useNetwork } from '../hooks/useNetwork'
import { JsonViewer } from './JsonViewer'

const COPIED_FEEDBACK_MS = 1500
const SENSITIVE_HEADER_NAMES = new Set(['authorization', 'cookie', 'set-cookie'])
const MASK = '••••••••'

function formatDuration(request: NetworkRequest): string {
  if (!request.endTime) return '…'
  return `${request.endTime - request.startTime}ms`
}

function statusClass(request: NetworkRequest): string {
  if (request.error) return 'text-error'
  if (request.status === undefined) return 'text-foreground-muted'
  return request.status >= 400 ? 'text-error' : 'text-success'
}

function statusLabel(request: NetworkRequest): string {
  if (request.error) return 'erro'
  if (request.status === undefined) return '…'
  return String(request.status)
}

// Autorization/Cookie escondidos por padrão — critério de pronto do M3
// (ROADMAP.md): "nenhum secret aparece em texto puro por padrão". O Replay
// usa os valores reais (sem isso a requisição reenviada falharia), só a
// exibição e o "copiar como cURL" mascaram.
function maskHeaders(
  headers: Record<string, string> | undefined,
  reveal: boolean
): Record<string, string> {
  if (!headers) return {}
  if (reveal) return headers
  const masked: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    masked[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase()) ? MASK : value
  }
  return masked
}

function buildCurl(request: NetworkRequest, reveal: boolean): string {
  const headers = maskHeaders(request.requestHeaders, reveal)
  const parts = [`curl -X ${request.method} '${request.url}'`]
  for (const [key, value] of Object.entries(headers)) {
    parts.push(`-H '${key}: ${value}'`)
  }
  if (request.requestBody) {
    parts.push(`--data '${request.requestBody.replace(/'/g, `'\\''`)}'`)
  }
  return parts.join(' \\\n  ')
}

function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
}

function textToHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    headers[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return headers
}

function formatEvaluateValue(value: unknown): string {
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

// Termos soltos são um OU entre si (qualquer um bate já mostra a requisição —
// "todos post" mostra tanto quem tem "todos" quanto quem tem "post", pra dar
// pra combinar critérios diferentes numa busca só). Termos com "-" na frente
// são exclusão obrigatória (E lógico): "get -post" mostra quem tem "get" e
// garante que NENHUM deles tenha "post", não importa o resto. É reversível só
// editando o texto — não precisa de um botão de "ocultar" com estado próprio.
function matchesQuery(request: NetworkRequest, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  if (tokens.length === 0) return true

  const haystack = `${request.method} ${request.url}`.toLowerCase()
  const excluded = tokens.filter((token) => token.startsWith('-') && token.length > 1)
  const included = tokens.filter((token) => !(token.startsWith('-') && token.length > 1))

  if (excluded.some((token) => haystack.includes(token.slice(1)))) return false
  return included.length === 0 || included.some((token) => haystack.includes(token))
}

function CopyButton({
  getText,
  label
}: {
  getText: () => string
  label?: string
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
      title="Copiar"
      onClick={handleClick}
      className="flex items-center gap-1 rounded-sm bg-surface-elevated px-2 py-1 text-xs text-foreground-muted hover:text-foreground"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
      {label}
    </button>
  )
}

function HeaderList({
  title,
  headers
}: {
  title: string
  headers: Record<string, string>
}): React.JSX.Element {
  const entries = Object.entries(headers)
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-foreground-secondary">{title}</p>
        {entries.length > 0 && <CopyButton getText={() => headersToText(headers)} />}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-foreground-muted">(nenhum)</p>
      ) : (
        <div className="flex flex-col gap-0.5 rounded-sm bg-surface-elevated p-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 font-mono text-xs">
              <span className="shrink-0 text-foreground-secondary">{key}:</span>
              <span className="min-w-0 break-all text-foreground">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BodyView({ title, body }: { title: string; body: string | undefined }): React.JSX.Element {
  const parsed = ((): unknown | undefined => {
    if (!body) return undefined
    try {
      const value: unknown = JSON.parse(body)
      return typeof value === 'object' && value !== null ? value : undefined
    } catch {
      return undefined
    }
  })()

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs text-foreground-secondary">{title}</p>
        {body && <CopyButton getText={() => body} />}
      </div>
      {!body ? (
        <p className="text-xs text-foreground-muted">(vazio)</p>
      ) : parsed !== undefined ? (
        <div className="rounded-sm bg-surface-elevated p-2">
          <JsonViewer value={parsed} />
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-all rounded-sm bg-surface-elevated p-2 font-mono text-xs text-foreground-muted">
          {body}
        </pre>
      )}
    </div>
  )
}

function ReplayForm({
  request,
  onReplay,
  onClose
}: {
  request: NetworkRequest
  onReplay: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string
  ) => Promise<EvaluateResult>
  onClose: () => void
}): React.JSX.Element {
  const [method, setMethod] = useState(request.method)
  const [url, setUrl] = useState(request.url)
  const [headersText, setHeadersText] = useState(headersToText(request.requestHeaders))
  const [body, setBody] = useState(request.requestBody ?? '')
  const [result, setResult] = useState<EvaluateResult | undefined>()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setLoading(true)
    setResult(undefined)
    const outcome = await onReplay(method, url, textToHeaders(headersText), body)
    setResult(outcome)
    setLoading(false)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-sm bg-surface-elevated p-3"
    >
      <div className="flex gap-2">
        <input
          value={method}
          onChange={(event) => setMethod(event.target.value)}
          className="w-20 rounded-sm bg-surface px-2 py-1 font-mono text-xs text-foreground outline-none"
        />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          className="min-w-0 flex-1 rounded-sm bg-surface px-2 py-1 font-mono text-xs text-foreground outline-none"
        />
      </div>
      <textarea
        value={headersText}
        onChange={(event) => setHeadersText(event.target.value)}
        rows={4}
        placeholder="Header: valor"
        className="rounded-sm bg-surface px-2 py-1 font-mono text-xs text-foreground outline-none"
      />
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder="body"
        className="rounded-sm bg-surface px-2 py-1 font-mono text-xs text-foreground outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={loading}
          className="rounded-sm bg-accent px-3 py-1 text-xs text-foreground disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Reenviar'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm px-3 py-1 text-xs text-foreground-muted hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
      {result &&
        (result.ok ? (
          <p className="font-mono text-xs text-success">OK — {formatEvaluateValue(result.value)}</p>
        ) : (
          <p className="font-mono text-xs text-error">
            {result.error}: {result.message}
          </p>
        ))}
    </form>
  )
}

function RequestDetail({
  request,
  onReplay
}: {
  request: NetworkRequest
  onReplay: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string
  ) => Promise<EvaluateResult>
}): React.JSX.Element {
  const [reveal, setReveal] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [sections, setSections] = useState({ headers: false, body: false })

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="min-w-0 break-all font-mono text-xs text-foreground">
          {request.method} {request.url}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setReveal((prev) => !prev)}
            className="rounded-sm bg-surface-elevated px-2 py-1 text-xs text-foreground-muted hover:text-foreground"
          >
            {reveal ? 'Ocultar segredos' : 'Mostrar segredos'}
          </button>
          <CopyButton getText={() => buildCurl(request, reveal)} label="cURL" />
          <button
            type="button"
            onClick={() => setReplaying((prev) => !prev)}
            className="rounded-sm bg-accent px-2 py-1 text-xs text-foreground"
          >
            Reenviar
          </button>
        </div>
      </div>

      {replaying && (
        <div className="shrink-0 border-b border-border p-3">
          <ReplayForm request={request} onReplay={onReplay} onClose={() => setReplaying(false)} />
        </div>
      )}

      <Section
        title="Headers"
        open={sections.headers}
        onToggle={(open) => setSections((prev) => ({ ...prev, headers: open }))}
      >
        <HeaderList title="Requisição" headers={maskHeaders(request.requestHeaders, reveal)} />
        <HeaderList title="Resposta" headers={maskHeaders(request.responseHeaders, reveal)} />
      </Section>

      <Section
        title="Body"
        open={sections.body}
        onToggle={(open) => setSections((prev) => ({ ...prev, body: open }))}
      >
        <BodyView title="Requisição" body={request.requestBody} />
        <BodyView title="Resposta" body={request.error ?? request.responseBody} />
      </Section>
    </div>
  )
}

export function NetworkPanel({ deviceId }: { deviceId: string | undefined }): React.JSX.Element {
  const { requests, clear } = useNetwork(deviceId)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [searchQuery, setSearchQuery] = useState('')

  if (!deviceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-foreground-muted">Selecione um dispositivo para ver a rede</p>
      </div>
    )
  }

  const visibleRequests = requests.filter((request) => matchesQuery(request, searchQuery))
  const selected = visibleRequests.find((request) => request.id === selectedId)

  // Requests ainda em voo (sem `endTime`) não entram no cálculo do fim do
  // range — usar `Date.now()` aqui seria uma função impura dentro do render
  // (React 19/eslint-plugin-react-hooks/purity). A barra delas só some do
  // "presente" quando a resposta chegar e a lista re-renderizar de qualquer
  // forma (evento ao vivo), então não precisa de um relógio próprio.
  const starts = visibleRequests.map((request) => request.startTime)
  const finishedEnds = visibleRequests
    .map((request) => request.endTime)
    .filter((endTime): endTime is number => endTime !== undefined)
  const rangeStart = starts.length > 0 ? Math.min(...starts) : 0
  const rangeEnd = Math.max(rangeStart, ...starts, ...finishedEnds, rangeStart + 1)
  const rangeSpan = Math.max(rangeEnd - rangeStart, 1)

  const clearAll = (): void => {
    clear()
    setSelectedId(undefined)
  }

  const replay = (
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<EvaluateResult> => {
    const init: Record<string, unknown> = { method, headers }
    if (body.trim()) init.body = body
    const expression = `fetch(${JSON.stringify(url)}, ${JSON.stringify(init)})`
    return window.api.evaluate(deviceId, expression)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-medium text-foreground">Network</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-foreground-muted">
            {visibleRequests.length} requisições
          </span>
          <button
            type="button"
            title="Limpar"
            onClick={clearAll}
            className="text-foreground-muted hover:text-foreground"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Search size={14} className="shrink-0 text-foreground-muted" />
        <input
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="filtrar (ex: get -post)"
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-foreground-muted"
        />
      </div>
      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-1/2 flex-col overflow-y-auto border-r border-border">
          {visibleRequests.length === 0 ? (
            <p className="p-4 text-sm text-foreground-muted">
              {requests.length === 0
                ? 'Nenhuma requisição ainda'
                : 'Nenhuma requisição corresponde ao filtro'}
            </p>
          ) : (
            visibleRequests.map((request) => {
              const left = ((request.startTime - rangeStart) / rangeSpan) * 100
              const width = Math.max(
                (((request.endTime ?? rangeEnd) - request.startTime) / rangeSpan) * 100,
                1
              )
              return (
                <div
                  key={request.id}
                  onClick={() => setSelectedId(request.id)}
                  className={`flex cursor-pointer flex-col gap-1 border-b border-border px-3 py-1.5 font-mono text-xs hover:bg-surface-elevated ${
                    selectedId === request.id ? 'bg-surface-elevated' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {request.method} {request.url}
                    </span>
                    <span className={`shrink-0 ${statusClass(request)}`}>
                      {statusLabel(request)}
                    </span>
                    <span className="shrink-0 text-foreground-muted">
                      {formatDuration(request)}
                    </span>
                  </div>
                  <div className="relative h-1 w-full rounded-sm bg-surface">
                    <div
                      className={`absolute h-1 rounded-sm ${request.error ? 'bg-error' : 'bg-accent'}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className="flex-1 overflow-hidden">
          {selected ? (
            <RequestDetail request={selected} onReplay={replay} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-foreground-muted">Selecione uma requisição</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
