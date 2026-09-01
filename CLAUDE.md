# CLAUDE.md

Este arquivo é a fonte de verdade de comportamento para qualquer trabalho feito neste
repositório (via Claude Code ou qualquer outro colaborador). Leia antes de escrever
qualquer código.

## Objetivo do projeto

**My DevTools** é uma ferramenta desktop (Electron) para debugar aplicações Expo /
React Native com suporte nativo a **múltiplos dispositivos simultâneos**, cada um com
sua própria sessão isolada de console, network, estado e performance. O problema que
resolve: hoje, ao debugar dois dispositivos ao mesmo tempo, os dados se misturam ou
não há visão comparativa entre eles.

## Princípio arquitetural inegociável

```
Device
  ↓
DeviceSession
  ↓
Connections
  ↓
Capabilities
  ↓
Panels
```

**Nunca**: `App → DevTools global`.

Todo dado (log, request, evento de estado) pertence a uma `DeviceSession` específica.
Nenhum painel (Console, Network, React, Storage...) deve ler ou escrever estado global
compartilhado entre dispositivos. Isso garante isolamento desde o primeiro commit.
Veja `ARCHITECTURE.md` para o detalhamento de cada camada.

## Regras de escopo — leia antes de aceitar qualquer tarefa

1. O desenvolvimento segue o `ROADMAP.md`, dividido em milestones (M0 a M8).
2. **Nunca implemente uma feature de um milestone futuro** só porque parece
   "conveniente" ou "rápido de fazer agora". Se uma tarefa parecer exigir isso,
   pare e pergunte antes de codar.
3. Não crie abstrações para casos de uso que ainda não existem (YAGNI). Exemplo:
   não construa um sistema de plugins genérico enquanto não tivermos nem um painel
   funcionando (isso é M6, não M0).
4. Se uma instrução do usuário conflitar com o `ARCHITECTURE.md`, pare e avise —
   não silenciosamente ignore a arquitetura nem o pedido.
5. Ao terminar uma etapa, não avance sozinho para a próxima sem confirmação.

## Proibições explícitas (MVP)

- ❌ Ferramentas de monorepo (Turborepo, Nx, pnpm workspaces) — só migramos para
  isso quando a estrutura `packages/` + `apps/` se justificar (M8+).
- ❌ Banco de dados / persistência em disco — sessões vivem em memória até que
  isso seja explicitamente decidido (Fase 39 do plano original).
- ❌ Lógica de conexão (WebSocket, CDP, Expo Protocol) dentro do React Renderer.
  Toda conexão vive em `src/core` / `src/connections`, o Renderer só consome
  via IPC/hooks.
- ❌ Sistema de plugins de terceiros antes de termos uma base de usuários (M8).
- ❌ Envio de dados para servidores externos. A ferramenta é 100% local no MVP.
- ❌ Persistir secrets (tokens, cookies, Authorization) por padrão em replay/export.

## Convenções de código

- **TypeScript estrito**, `strict: true`, proibido `any` sem justificativa comentada.
- Organização por **feature/camada**, inspirada em estrutura feature-based:
  - `domain/` — lógica de negócio pura, sem I/O, 100% testável (ex: `canStartProduction.ts`)
  - `services/` — I/O: chamadas a conexões, protocolo, disco
  - `hooks/` — orquestração de estado no Renderer (React)
  - `components/` — apresentação, sem lógica de negócio
  - `stores/` — estado compartilhado dentro de uma feature/painel, quando necessário
  - `types/` — tipos e interfaces da feature
- Cada arquivo de `domain/` que tiver lógica não-trivial deve ter um `.test.ts` ao lado.
- Nomenclatura de arquivos: `PascalCase.tsx` para componentes, `camelCase.ts` para
  o resto.
- Interfaces centrais (`Device`, `DeviceSession`, `Connection`, `Capability`) vivem em
  `src/protocol` ou `src/core`, nunca duplicadas dentro de uma feature.

## Stack fixa (não trocar sem discussão explícita)

- Electron
- React
- TypeScript
- **electron-vite** (tooling oficial que gerencia os 3 processos: main/preload/renderer)
- pnpm
- Vitest (unit/integration)
- Playwright (E2E — só entra mais adiante, não no MVP)

O projeto foi inicializado via `pnpm create @quick-start/electron@latest`
(template `react-ts`). Não recrie configs de build manualmente — o
`electron.vite.config.ts` gerado pelo scaffold já resolve os três processos
corretamente. Ajustes de estrutura de pastas devem ser feitos por cima do
scaffold existente, nunca substituindo-o do zero.

## Antes de codar, sempre confirme quando:

- A tarefa exigir uma nova interface/tipo central (`Device`, `Connection`, etc.)
- A tarefa tocar em mais de uma camada ao mesmo tempo (ex: Renderer + Connection)
- Não estiver claro em qual milestone a tarefa se encaixa
- A tarefa parecer "adiantar" trabalho de fases futuras

## Documentos relacionados

- `ARCHITECTURE.md` — detalhamento técnico de cada camada e estrutura de pastas
- `ROADMAP.md` — milestones M0–M8, o que é MVP e o que é pós-1.0
