# DESIGN.md

Este documento define o sistema de design do **My DevTools**. Nenhum painel ou
componente deve usar cor, espaçamento, fonte ou raio de borda fora do que está
definido aqui. Se um valor novo for necessário, ele é adicionado **aqui primeiro**,
depois usado no código — nunca o contrário.

## Abordagem técnica

- **Tailwind CSS v4**, instalado via `@tailwindcss/vite` (plugin oficial para
  projetos Vite — não usar PostCSS manual nem `tailwind.config.js`, a v4 é
  CSS-first).
- Cores não ficam hardcoded em nenhum config. Os valores reais (hex) vivem como
  **CSS variables cruas** em `src/renderer/src/shared/theme/tokens.css`, dentro
  de `:root` (tema escuro, padrão) e `[data-theme="light"]` (tema claro).
- Essas variáveis cruas são então referenciadas dentro de um bloco `@theme inline`
  (recurso do Tailwind v4 pra tema dinâmico), que é o que gera as classes
  utilitárias (`bg-background`, `text-foreground`, etc). Isso permite trocar o
  tema em runtime (mudando o atributo `data-theme` na `<html>`) sem duplicar
  nenhuma classe Tailwind.

> **Cuidado com colisão de nome:** o Tailwind já usa o prefixo `text-` para
> indicar "aplique isso como cor de texto" (`text-accent`, `text-error`). Por
> isso os tokens de texto abaixo se chamam `foreground`, `foreground-secondary`,
> `foreground-muted` — nunca `text-primary`/`text-muted` — senão a classe gerada
> fica redundante e confusa (`text-text-muted`).

Exemplo de `tokens.css`:

```css
@import 'tailwindcss';

:root {
  --background: #0d0d0f;
  --surface: #161618;
  --foreground: #e4e4e7;
  /* ...demais tokens do tema escuro */
}

[data-theme='light'] {
  --background: #ffffff;
  --surface: #f4f4f5;
  --foreground: #18181b;
  /* ...demais tokens do tema claro */
}

@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-foreground: var(--foreground);
  /* ...um --color-* para cada token acima */
}
```

- Nenhum componente escreve `style={{ color: '#...' }}` ou `bg-[#1a1a1a]` (cor
  arbitrária do Tailwind). Sempre usar a classe do token (ex: `bg-surface`,
  `text-foreground-muted`).

## Tema padrão: escuro

O tema escuro é o padrão e a referência visual principal (estilo Chrome DevTools /
VSCode). O tema claro é definido com os mesmos nomes de token, com valores
próprios — não é um sistema paralelo, é o mesmo token com outro valor. Ambos
precisam existir desde o M0, já que a ferramenta segue o tema do sistema
operacional automaticamente (sem toggle manual ainda).

## Paleta de cores (tokens)

| Token                  | Uso                               | Valor (dark) | Valor (light) |
| ---------------------- | --------------------------------- | ------------ | ------------- |
| `background`           | fundo da janela, camada mais base | `#0d0d0f`    | `#ffffff`     |
| `surface`              | painéis, sidebar, cards           | `#161618`    | `#f4f4f5`     |
| `surface-elevated`     | modais, dropdowns, tooltips       | `#1f1f22`    | `#ffffff`     |
| `border`               | divisórias, bordas de card        | `#2a2a2e`    | `#e4e4e7`     |
| `foreground`           | texto principal                   | `#e4e4e7`    | `#18181b`     |
| `foreground-secondary` | texto de apoio, labels            | `#a1a1aa`    | `#52525b`     |
| `foreground-muted`     | texto desabilitado, placeholders  | `#6b6b70`    | `#a1a1aa`     |
| `accent`               | ações primárias, links, foco      | `#3b82f6`    | `#2563eb`     |
| `success`              | status conectado, 2xx             | `#22c55e`    | `#16a34a`     |
| `warning`              | avisos, 4xx                       | `#eab308`    | `#ca8a04`     |
| `error`                | erros, exceptions, 5xx            | `#ef4444`    | `#dc2626`     |

## Espaçamento

Escala baseada em 4px, seguindo o padrão do Tailwind (não redefinir uma escala
customizada): `1` (4px), `2` (8px), `3` (12px), `4` (16px), `6` (24px), `8` (32px),
`12` (48px). Evitar valores fora dessa escala.

## Tipografia

- **UI (texto geral):** fonte do sistema (`font-sans` padrão do Tailwind — sistema
  operacional já resolve isso bem, sem precisar carregar fonte externa no MVP).
- **Código, logs, JSON, stack traces:** fonte monoespaçada (`font-mono` padrão do
  Tailwind). Todo conteúdo que vem de dados reais do dispositivo (console, network
  body, valores de state) usa `font-mono` — nunca a fonte de UI.
- Tamanhos: usar a escala padrão do Tailwind (`text-xs` a `text-lg`). Não criar
  tamanhos customizados no MVP.

## Raio de borda e sombra

- Cards e painéis: `rounded-md` (padrão do Tailwind)
- Elementos pequenos (badges, botões): `rounded-sm`
- Sombra: evitar sombras pesadas no tema escuro (não combinam). Usar `border`
  (o token acima) para separar elementos, não `box-shadow`, exceto em elementos
  flutuantes reais (dropdown, modal), onde uma sombra sutil é aceitável.

## Regra de componentes

- Todo elemento de UI reutilizável (botão, badge, card, input) vive em
  `src/renderer/src/shared/components/ui/` e é usado por todos os painéis.
  Nenhum painel cria seu próprio botão ou badge "só um pouco diferente".
- Um painel específico (Console, Network, etc.) só cria componente próprio para
  UI que é _conceitualmente única daquele painel_ (ex: `RequestRow` do Network).

## Fora de escopo no MVP

- ✗ Toggle manual de tema com persistência (M0 só segue o tema do sistema —
  os valores de ambos os temas já existem, só não há botão pra escolher manual)
- ✗ Temas customizáveis pelo usuário
