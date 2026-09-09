import { useState } from 'react'

// Visualizador de JSON com collapse por nó — pra objeto grande ou array de
// objetos não virar uma parede de texto (pedido explícito: cada objeto tem
// que poder ser colapsado/expandido individualmente, não só a seção inteira).

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function primitiveText(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

function JsonEntries({
  label,
  entries,
  defaultOpen
}: {
  label: string
  entries: [string, unknown][]
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="font-mono text-xs text-foreground-muted hover:text-foreground"
      >
        {open ? '▾' : '▸'} {label}
      </button>
      {open && (
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-1 font-mono text-xs">
              <span className="shrink-0 text-foreground-secondary">{key}:</span>
              <JsonNode value={value} defaultOpen={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function JsonNode({
  value,
  defaultOpen
}: {
  value: unknown
  defaultOpen: boolean
}): React.JSX.Element {
  if (Array.isArray(value)) {
    return (
      <JsonEntries
        label={`Array(${value.length})`}
        entries={value.map((item, index) => [String(index), item])}
        defaultOpen={defaultOpen}
      />
    )
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    return (
      <JsonEntries
        label={`{ } ${entries.length} propriedades`}
        entries={entries}
        defaultOpen={defaultOpen}
      />
    )
  }
  return <span className="font-mono text-xs text-foreground">{primitiveText(value)}</span>
}

export function JsonViewer({ value }: { value: unknown }): React.JSX.Element {
  return <JsonNode value={value} defaultOpen />
}
