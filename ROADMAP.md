# ROADMAP.md

Este documento define os milestones do **My DevTools**, do zero ao v1.0. Cada
milestone só começa quando o anterior estiver com todos os critérios de "pronto"
atendidos. Nenhuma tarefa de milestone futuro deve ser antecipada sem confirmação
explícita do usuário (ver `CLAUDE.md`, regras de escopo).

## Status atual

**M2 concluído.** Próximo: M3.

| Milestone           | Status          |
| ------------------- | --------------- |
| M0 — Fundação       | ✅ Concluído    |
| M1 — Connectivity   | ✅ Concluído    |
| M2 — Core Debugging | ✅ Concluído    |
| M3 — Network        | 🔜 Próximo      |
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

## M1 — Connectivity ✅

**Objetivo:** o app consegue descobrir dispositivos reais e estabelecer uma
`DeviceSession` isolada para cada um, com conexão de verdade ao runtime.

**Entregáveis:**

- `DeviceManager`: descoberta de dispositivos via polling do endpoint `/json/list`
  do servidor Metro/Expo (funciona igual para físico, emulador e simulador —
  quem se registra é o app, não o SO)
- Modelo `Device` e `DeviceSession` (ver `ARCHITECTURE.md`) — a `DeviceSession`
  implementada é a versão **fina** do shape do `ARCHITECTURE.md`: só
  `{id, deviceId, connections}`, sem `status`/`capabilities`/`stores` ainda.
  Esses campos existem no diagrama de arquitetura, mas nenhum código os lê hoje
  (nenhum painel existe pra consultar `capabilities`, nenhum evento assíncrono
  precisa de `status`) — YAGNI (`CLAUDE.md` regra 3). Entram quando o primeiro
  consumidor real de cada campo existir (painéis a partir do M2).
- `SessionManager` (`src/sessions/sessionManager.ts`): cria/mantém a
  `DeviceSession` por device, mantém a conexão CDP viva entre chamadas e faz o
  retry de reconexão. Substitui o `Map` solto de conexões que existia dentro do
  `main/index.ts` antes disso ser formalizado.
- `Connection` (interface) + `CDPConnection` (Hermes/CDP)
- Sidebar lista dispositivos reais encontrados (não mockados)

**Adiado conscientemente para o M2** (não é esquecimento — é YAGNI, ver
`CLAUDE.md` regra 3): nenhum dos dois itens abaixo tem consumidor real hoje.
Construí-los agora seria abstração vazia (`stores`/rotas para eventos que ainda
não existem):

- Definição do `Protocol` interno genérico (`{version, type, sessionId, payload}`)
  — existe hoje só pra rotear eventos assíncronos não solicitados (ex:
  `console.message` chegando sozinho). `Runtime.evaluate` é request/response
  simples, já resolvido por IPC direto com `deviceId` — não precisa desse
  envelope. Nasce junto com o painel Console (M2), primeiro consumidor real.
- Expo Plugin básico expondo o protocolo do lado do app RN — hoje conectamos
  direto no CDP/Hermes cru exposto pelo Metro; nenhuma funcionalidade atual
  depende de um canal adicional do lado do app. Entra quando um painel
  precisar de algo que o CDP não expõe.

**Critério de pronto:** rodar `Runtime.evaluate` de `2 + 2` no dispositivo conectado
e ver `4` retornar até a UI. Dois dispositivos conectados simultaneamente mostram
sessões distintas na sidebar. ✅

**Limitação conhecida:** a conexão CDP (`CDPConnection`) só funciona validada em
projetos **Expo SDK 55 ou anterior**. Em SDK 56 e 57 (latest, no momento em que isso
foi escrito) o `Runtime.evaluate` não retorna — causa raiz ainda não diagnosticada.
Os apps de teste ficam em `examples/sdk-55` e `examples/sdk-56` para reproduzir. Até
isso ser investigado, tratar SDK 55- como o alvo suportado desta feature; a matriz de
compatibilidade formal por versão de SDK é trabalho do M7, não deste milestone.

---

## M2 — Core Debugging ✅

**Objetivo:** primeiro painel real e útil no dia a dia.

**Entregáveis:**

- Painel Console: logs, warnings, errors, exceptions, stack trace, filtros, busca
- JavaScript REPL (`>` com histórico de comandos), intercalado com o console
  (mesmo scrollback, ordenado por timestamp — igual ao Chrome DevTools)
- Debugger básico sobre CDP: breakpoints, step over/into/out, call stack, scopes
  — vive num painel próprio (aba "Debugger"), com `stores.debugger` na
  `DeviceSession` (estado ao vivo, não um histórico — ver `ARCHITECTURE.md` §1)

**Simplificação deliberada:** não existe visualizador de código-fonte nesta
fatia (não está no roadmap de nenhum milestone) — o breakpoint é setado
indicando arquivo + linha manualmente (`Debugger.setBreakpointByUrl`), olhando
o código no editor. Inspeção de escopo cobre só o frame onde parou (topo da
pilha), não cada frame — sem consumidor real pra isso ainda (YAGNI).

**Critério de pronto:** `console.log("hello")` do app aparece no painel; é possível
pausar em um breakpoint e inspecionar variáveis. ✅

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
