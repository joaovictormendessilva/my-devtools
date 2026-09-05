// Contrato central do sistema (ver ARCHITECTURE.md §5). Uma `Connection` é uma
// abstração de transporte até o runtime de um device (CDP/Hermes, Expo DevTools
// Protocol, WebSocket genérico). Cada `DeviceSession` terá 0+ conexões.
//
// Esta camada NÃO interpreta semântica de domínio ("isso é um erro React",
// "isso é uma request"). Ela só move mensagens: abre, envia, recebe, fecha.

/** Cancela um registro feito por `onMessage` / `onClose`. Idempotente. */
export type Unsubscribe = () => void

/** Recebe mensagens NÃO solicitadas do transporte (ex: eventos CDP sem `id`). */
export type MessageHandler = (message: unknown) => void

/** Chamado quando o transporte fecha (pelo runtime ou por `disconnect`). */
export type CloseHandler = (info: { code: number; reason: string }) => void

export interface Connection {
  /**
   * Abre o transporte. Resolve quando estiver pronto para `send`. Rejeita se
   * não abrir dentro do timeout ou se o transporte reportar erro. Idempotente
   * se já estiver conectado.
   */
  connect(): Promise<void>

  /** Fecha o transporte e libera os recursos. Idempotente. */
  disconnect(): Promise<void>

  /**
   * Envia uma mensagem e resolve com a RESPOSTA correlacionada a ela (no CDP, o
   * match é por `id`). Rejeita se o transporte responder com erro, se a resposta
   * não chegar dentro do timeout, ou se o transporte fechar antes da resposta.
   * Não dispara os handlers de `onMessage`.
   */
  send(message: unknown): Promise<unknown>

  /** Registra um handler para mensagens não solicitadas. */
  onMessage(handler: MessageHandler): Unsubscribe

  /** Registra um handler para o fechamento do transporte. */
  onClose(handler: CloseHandler): Unsubscribe
}
