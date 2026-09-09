// Contrato do canal `network:update` (SessionManager → main → preload → hook
// useNetwork). Um `NetworkRequest` nasce no `fetch`/`XMLHttpRequest` request e
// é atualizado quando a resposta (ou erro) chega — mesmo objeto, mesmo `id`.

export type NetworkRequestKind = 'fetch' | 'xhr'

export interface NetworkRequest {
  id: string
  kind: NetworkRequestKind
  method: string
  url: string
  requestHeaders: Record<string, string>
  requestBody?: string
  startTime: number
  status?: number
  responseHeaders?: Record<string, string>
  responseBody?: string
  endTime?: number
  error?: string
}
