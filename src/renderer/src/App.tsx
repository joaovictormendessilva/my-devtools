function App(): React.JSX.Element {
  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="flex w-64 shrink-0 items-center justify-center border-r border-border bg-surface p-4">
        <p className="text-sm text-foreground-muted">Nenhum dispositivo conectado</p>
      </aside>
      <main className="flex-1" />
    </div>
  )
}

export default App
