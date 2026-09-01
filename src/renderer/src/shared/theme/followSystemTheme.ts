// M0 não tem toggle de tema: o app apenas segue o tema do sistema operacional.
// O DESIGN.md define os tokens em :root (escuro, padrão) e [data-theme="light"]
// (claro), então aqui só refletimos a preferência do SO no atributo data-theme
// da <html> e reagimos quando ela muda. Toggle manual + persistência é fora do
// escopo do M0.
export function followSystemTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: light)')

  const apply = (isLight: boolean): void => {
    if (isLight) {
      document.documentElement.dataset.theme = 'light'
    } else {
      delete document.documentElement.dataset.theme
    }
  }

  apply(query.matches)
  query.addEventListener('change', (event) => apply(event.matches))
}
