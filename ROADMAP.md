# ROADMAP.md

Este documento define os milestones do **My DevTools**, do zero ao v1.0. Cada
milestone só começa quando o anterior estiver com todos os critérios de "pronto"
atendidos. Nenhuma tarefa de milestone futuro deve ser antecipada sem confirmação
explícita do usuário (ver `CLAUDE.md`, regras de escopo).

## Status atual

**Estamos em M1.** M0 concluído.

| Milestone           | Status          |
| ------------------- | --------------- |
| M0 — Fundação       | ✅ Concluído    |
| M1 — Connectivity   | 🔜 Próximo      |
| M2 — Core Debugging | ⬜ Não iniciado |
| M3 — Network        | ⬜ Não iniciado |
| M4 — App Inspection | ⬜ Não iniciado |
| M5 — Performance    | ⬜ Não iniciado |
| M6 — Extensibility  | ⬜ Não iniciado |
| M7 — Productization | ⬜ Não iniciado |
| M8 — Ecosystem      | ⬜ Não iniciado |

---

## M0 — Fundação ✅

**Objetivo:** casca do Electron rodando, com arquitetura e design system documentados
e aplicados desde o primeiro commit.

**Entregáveis:**

- Scaffold electron-vite (React + TypeScript) limpo, sem boilerplate de exemplo
- Janela principal configurada (tamanho, título, lifecycle, IPC seguro)
- Tailwind CSS v4 configurado com tokens de design (tema claro + escuro)
- App segue o tema do sistema operacional automaticamente
- Layout mínimo (sidebar vazia + área principal vazia)

**Critério de pronto:** `pnpm dev` abre a janela, layout renderiza com os tokens
corretos, tema muda com o SO, `pnpm typecheck` / `pnpm lint` / `pnpm build` sem erro.

---

## M1 — Connectivity 🔜

**Objetivo:** o app consegue descobrir dispositivos reais e estabelecer uma
`DeviceSession` isolada para cada um, com conexão de verdade ao runtime.

**Entregáveis:**

- `DeviceManager`: descoberta de dispositivos via polling do endpoint `/json/list`
  do servidor Metro/Expo (funciona igual para físico, emulador e simulador —
  quem se registra é o app, não o SO)
- Modelo `Device` e `DeviceSession` (ver `ARCHITECTURE.md`)
- `Connection` (interface) + `CDPConnection` (Hermes/CDP)
- Definição do `Protocol` interno (shape de mensagens, `sessionId`)
- Expo Plugin básico expondo o protocolo do lado do app RN
- Sidebar lista dispositivos reais encontrados (não mockados)

**Critério de pronto:** rodar `Runtime.evaluate` de `2 + 2` no dispositivo conectado
e ver `4` retornar até a UI. Dois dispositivos conectados simultaneamente mostram
sessões distintas na sidebar.

---

## M2 — Core Debugging ⬜

**Objetivo:** primeiro painel real e útil no dia a dia.

**Entregáveis:**

- Painel Console: logs, warnings, errors, exceptions, stack trace, filtros, busca
- JavaScript REPL (`>` com histórico de comandos)
- Debugger básico sobre CDP: breakpoints, step over/into/out, call stack, scopes

**Critério de pronto:** `console.log("hello")` do app aparece no painel; é possível
pausar em um breakpoint e inspecionar variáveis.

---

## M3 — Network ⬜

**Objetivo:** visibilidade completa de tráfego de rede do app.

**Entregáveis:**

- Captura de fetch/XHR/Native/Image
- Lista de requests com status, tempo, waterfall
- Detalhes: headers, request/response body, timing, query params, cookies
- Replay de request (editar e reenviar) + "Copy as cURL"
- Mascaramento de dados sensíveis (Authorization, cookies, tokens) antes de
  qualquer replay/export (ver regras de segurança no `CLAUDE.md`)

**Critério de pronto:** uma requisição `POST /checkout` pode ser inspecionada,
editada e reenviada; nenhum secret aparece em texto puro por padrão.

---

## M4 — App Inspection ⬜

**Objetivo:** enxergar o estado interno do app, não só a rede.

**Entregáveis:**

- React Inspector: árvore de componentes, props, state, hooks
- Storage: AsyncStorage, SecureStore, MMKV, SQLite, FileSystem
- Navigation: ações de navegação, estado da stack
- State: integração com Redux/Zustand/TanStack Query

**Critério de pronto:** selecionar um componente na árvore mostra suas props e
state reais; mudanças de storage/state aparecem em tempo real no painel.

---

## M5 — Performance ⬜

**Objetivo:** diagnosticar problemas de performance e erros de forma agregada.

**Entregáveis:**

- React Profiler ("why did this render?")
- Timeline reproduzível (navigation + network + state + console + performance)
- Error Inspector (agrupamento de erros iguais, dispositivos afetados)
- `devtools doctor` — diagnóstico de compatibilidade (SDK, Hermes, source maps)

**Critério de pronto:** um erro que ocorre 7 vezes aparece agrupado, com os
dispositivos afetados e a timeline de eventos antes do erro.

---

## M6 — Extensibility ⬜

**Objetivo:** permitir que a ferramenta seja estendida sem mexer no core.

**Entregáveis:**

- Painel Actions (histórico de ações do usuário/sistema)
- Plugin SDK com sistema de permissões declarado (`permissions: [...]`)
- Sandbox de plugin: sem acesso arbitrário a filesystem/rede

**Critério de pronto:** um plugin de exemplo consegue ler dados de `console`
declarando permissão, e é bloqueado de acessar o que não declarou.

---

## M7 — Productization ⬜

**Objetivo:** transformar a ferramenta em um produto instalável e distribuível.

**Entregáveis:**

- Multi-device de verdade (visão agregada "All Devices" + comparação entre dispositivos)
- Sessions: salvar, exportar (`.devtools`), importar
- CLI (`devtools start`, `devtools doctor`, `devtools devices`)
- Build para macOS/Windows/Linux com code signing, notarization, auto-update
- Matriz de compatibilidade por versão de Expo SDK

**Critério de pronto:** build assinado roda nos 3 sistemas operacionais; uma
sessão exportada por uma pessoa pode ser importada e analisada por outra.

---

## M8 — Ecosystem ⬜ (pós-1.0, fora do MVP)

**Objetivo:** funcionalidades que dependem de uma base de usuários existente.

**Entregáveis:**

- Cloud, login, sessões compartilhadas
- Colaboração em equipe / team debugging
- Plugin Marketplace (Official + Community)
- CI integration, dashboards customizados

**Critério de pronto:** não se aplica ainda — este milestone só é planejado em
detalhe quando M0–M7 estiverem completos e houver decisão explícita de expandir
o produto nessa direção.
