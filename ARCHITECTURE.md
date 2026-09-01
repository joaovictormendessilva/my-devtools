# ARCHITECTURE.md

Este documento descreve a arquitetura técnica do **My DevTools**. Ele existe para que
qualquer decisão de código possa ser verificada contra um modelo único, evitando
deriva de arquitetura ao longo do desenvolvimento.

## 1. Modelo conceitual

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

- **Device** — representa um dispositivo físico ou emulado (iPhone, Pixel, simulador
  iOS, emulador Android) descoberto pelo `DeviceManager`.
- **DeviceSession** — uma sessão isolada por dispositivo. Contém suas próprias
  `stores` (console, network, navigation, storage, performance) e suas próprias
  `connections`. Duas sessões nunca compartilham estado.
- **Connections** — abstração de transporte (CDP/Hermes, Expo DevTools Protocol,
  WebSocket genérico). Cada `DeviceSession` tem 0 ou mais conexões ativas.
- **Capabilities** — o que uma sessão suporta, derivado da versão do Expo SDK / RN /
  runtime conectado (ex: `["console", "network", "storage"]`). Painéis usam
  `capabilities` para saber o que renderizar/habilitar.
- **Panels** — a UI (Console, Network, React, Storage, Navigation, State,
  Performance, Timeline, Actions). Painéis são **consumidores** da infraestrutura
  acima — nunca implementam lógica de conexão ou protocolo diretamente.

**Regra de ouro:** um painel nunca fala diretamente com uma `Connection`. Ele lê da
`DeviceSession` (via IPC/hooks), que por sua vez é alimentada pelas `Connections`
através do `Protocol`.

## 2. Estrutura de pastas alvo

Base gerada pelo scaffold oficial `electron-vite` (`pnpm create @quick-start/electron`,
template `react-ts`), estendida com as camadas do nosso domínio:

```
my-devtools/
├── src/
│   ├── main/              # Processo principal do Electron — janelas, lifecycle, tema
│   │                      # (gerado pelo scaffold; é AQUI que core/devices/sessions/
│   │                      #  connections se conectam ao IPC)
│   ├── preload/           # Bridge de IPC seguro (contextBridge) — gerado pelo scaffold.
│   │                      # Único lugar autorizado a expor APIs do main pro renderer.
│   ├── renderer/           # UI React — painéis, componentes, hooks
│   │   └── src/
│   │       └── features/   # um diretório por painel (console, network, react, ...)
│   ├── core/               # Orquestração: DeviceManager, SessionManager
│   ├── protocol/           # Definição do protocolo interno + tipos centrais
│   ├── devices/            # Descoberta e modelagem de Device
│   ├── sessions/           # DeviceSession, stores por sessão
│   └── connections/        # Connection (interface) + implementações (CDP, Expo, WS)
│
├── expo-plugin/
│   └── src/                # Plugin Expo que expõe o protocolo do lado do app RN
│
├── examples/                # Apps de teste (SDK 57, redux, zustand, network, etc.)
├── tests/                   # Testes de integração/E2E que cruzam camadas
├── electron.vite.config.ts  # Gerado pelo scaffold — não recriar manualmente
├── package.json
├── tsconfig.json
└── README.md
```

`core/`, `protocol/`, `devices/`, `sessions/` e `connections/` **não fazem parte
do scaffold padrão** — são as pastas que criamos por cima dele para acomodar a
arquitetura Device → DeviceSession → Connections → Capabilities → Panels. Elas
vivem dentro de `src/`, ao lado de `main/`, `preload/` e `renderer/`, e são
importadas pelo `main/` (nunca diretamente pelo `renderer/` — a ponte é sempre
via `preload/` + IPC).

Dentro de `renderer/src/features/`, cada painel segue o padrão feature-based
(adaptado do projeto React Native de referência):

```
renderer/
└── features/
    └── console/
        ├── components/    # UI do painel (apresentação)
        ├── hooks/         # useConsole(), consoleKeys.ts — orquestração de estado
        ├── domain/         # regras puras (ex: agrupamento de erros), com .test.ts
        └── types/          # tipos específicos do painel
```

O mesmo padrão se repete para `network/`, `react/`, `storage/`, `navigation/`,
`state/`, `performance/`.

## 3. Responsabilidade de cada camada

| Camada | Responsabilidade | NÃO faz |
|---|---|---|
| `main/` | Janela, lifecycle, tema, importa `core/` para orquestrar sessões | Lógica de negócio, parsing de protocolo |
| `preload/` | Expõe via `contextBridge` só o necessário do `main/` para o `renderer/` | Qualquer lógica — é só uma ponte |
| `core/` | Orquestra `DeviceManager` + `SessionManager` | UI, transporte bruto |
| `devices/` | Descobre e modela `Device` (iOS Sim, Android Emu, físicos) | Conexão real ao runtime |
| `sessions/` | Cria/mantém `DeviceSession`, isola stores por dispositivo | Renderização |
| `connections/` | Implementa `Connection` (connect/send/onMessage) por transporte | Interpretar semântica do domínio (ex: "isso é um erro React") |
| `protocol/` | Define shape das mensagens (`{version, type, sessionId, payload}`) e tipos centrais | Lógica de UI ou de conexão |
| `renderer/features/*` | UI + hooks de orquestração de cada painel | Lógica de conexão, parsing de protocolo bruto |

## 4. Fluxo de um evento (exemplo: `console.message`)

```
Hermes/CDP runtime
   → Connection (CDPConnection)                         [src/connections]
   → Protocol (parse para {type: "console.message", sessionId, payload})  [src/protocol]
   → SessionManager (roteia para a DeviceSession correta via sessionId)   [src/core]
   → DeviceSession.stores.console (armazena o evento)                    [src/sessions]
   → main/ emite evento via IPC (ipcMain.emit / webContents.send)
   → preload/ repassa via contextBridge (nunca lógica aqui, só passagem)
   → hook useConsole() da feature console no renderer/
   → Componente <ConsolePanel /> renderiza
```

O `sessionId` está presente na camada de eventos mesmo com isolamento por
`DeviceSession`, para facilitar debugging, logs e futuras funcionalidades (ex:
visão agregada "All Devices").

## 5. Convenção de nomenclatura de interfaces principais

Definidas em `src/protocol/`:

```ts
interface Device {
  id: string;
  name: string;
  platform: 'ios' | 'android';
  model?: string;
  osVersion?: string;
  expoSdk?: string;
  reactNativeVersion?: string;
  runtime?: string;
  status: 'connected' | 'available' | 'offline';
}

interface DeviceSession {
  id: string;
  deviceId: string;
  status: SessionStatus;
  capabilities: Capability[];
  connections: {
    cdp?: Connection;
    expo?: Connection;
  };
  stores: {
    console: ConsoleStore;
    network: NetworkStore;
    navigation: NavigationStore;
    storage: StorageStore;
    performance: PerformanceStore;
  };
}

interface Connection {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: unknown): Promise<unknown>;
  onMessage(handler: MessageHandler): Unsubscribe;
  onClose(handler: CloseHandler): Unsubscribe;
}
```

Essas três interfaces são o contrato central do sistema. Qualquer mudança nelas
afeta todas as camadas acima — por isso, mudanças aqui exigem confirmação
explícita (ver `CLAUDE.md`).

## 6. Fora de escopo no MVP

Estas decisões são deliberadas — não é esquecimento, é sequenciamento:

- ✗ Monorepo (`packages/` + `apps/` + Turborepo/pnpm workspaces) — só quando a
  estrutura `src/` única não aguentar mais o crescimento.
- ✗ Persistência em banco (SQLite) — sessões vivem em memória.
- ✗ Plugin Marketplace / plugins de terceiros.
- ✗ Cloud, login, colaboração em equipe, session replay em vídeo.
- ✗ Autocomplete no REPL de JavaScript.

## 7. Referência de inspiração

A separação `domain/ (puro) → services/ (I/O) → hooks/ (orquestração) →
components/ (apresentação)` usada aqui é inspirada diretamente na estrutura de um
app React Native de produção já usado pelo autor (ver histórico do projeto), que
organiza cada feature de negócio (`orders`, `production`, `users`) da mesma forma.
A adaptação para este projeto substitui "features de negócio" por "painéis de
DevTools", e adiciona a camada de infraestrutura compartilhada
(`DeviceSession` + `Connection` + `Protocol`) que não existe no app de referência,
pois aqui múltiplos dispositivos precisam de isolamento simultâneo.
