// Seção colapsável reutilizável entre painéis (Debugger, Network). Controlado
// (`open`/`onToggle`, não só `defaultOpen`) porque os painéis que a usam
// re-renderizam a cada evento ao vivo (debugger:update/network:update); com
// um `open` não-controlado o React reaplicaria o valor inicial a cada render
// e desfaria qualquer collapse manual do usuário.
export function Section({
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
