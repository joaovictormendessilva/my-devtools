import { isRecord } from './remoteObject'
import { NETWORK_EVENT_MARKER } from './networkInterceptorScript'
import type { NetworkRequestKind } from '../protocol/network'

// O interceptor injetado (`networkInterceptorScript.ts`) reporta cada evento
// via `console.debug(MARKER + JSON.stringify(evento))` — chega aqui como um
// `Runtime.consoleAPICalled` normal. Detecta o marcador ANTES de tratar como
// entrada de console (`consoleEvents.ts`), pra esses eventos nunca aparecerem
// no painel Console.

export interface NetworkRequestWireEvent {
  kind: 'request'
  id: string
  type: NetworkRequestKind
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  startTime: number
}

export interface NetworkResponseWireEvent {
  kind: 'response'
  id: string
  status: number
  headers: Record<string, string>
  body?: string
  endTime: number
}

export interface NetworkErrorWireEvent {
  kind: 'error'
  id: string
  message: string
  endTime: number
}

export type NetworkWireEvent =
  NetworkRequestWireEvent | NetworkResponseWireEvent | NetworkErrorWireEvent

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === 'string')
}

export function parseNetworkWireEvent(message: unknown): NetworkWireEvent | undefined {
  if (!isRecord(message) || message.method !== 'Runtime.consoleAPICalled') return undefined
  const params = isRecord(message.params) ? message.params : {}
  const args = Array.isArray(params.args) ? params.args : []
  const first = args[0]
  if (!isRecord(first) || typeof first.value !== 'string') return undefined
  if (!first.value.startsWith(NETWORK_EVENT_MARKER)) return undefined

  let payload: unknown
  try {
    payload = JSON.parse(first.value.slice(NETWORK_EVENT_MARKER.length))
  } catch {
    return undefined
  }
  if (!isRecord(payload) || typeof payload.id !== 'string') return undefined

  if (payload.kind === 'request') {
    if (
      typeof payload.method !== 'string' ||
      typeof payload.url !== 'string' ||
      typeof payload.startTime !== 'number' ||
      !isStringRecord(payload.headers) ||
      (payload.type !== 'fetch' && payload.type !== 'xhr')
    ) {
      return undefined
    }
    return {
      kind: 'request',
      id: payload.id,
      type: payload.type,
      method: payload.method,
      url: payload.url,
      headers: payload.headers,
      body: typeof payload.body === 'string' ? payload.body : undefined,
      startTime: payload.startTime
    }
  }

  if (payload.kind === 'response') {
    if (
      typeof payload.status !== 'number' ||
      typeof payload.endTime !== 'number' ||
      !isStringRecord(payload.headers)
    ) {
      return undefined
    }
    return {
      kind: 'response',
      id: payload.id,
      status: payload.status,
      headers: payload.headers,
      body: typeof payload.body === 'string' ? payload.body : undefined,
      endTime: payload.endTime
    }
  }

  if (payload.kind === 'error') {
    if (typeof payload.message !== 'string' || typeof payload.endTime !== 'number') return undefined
    return { kind: 'error', id: payload.id, message: payload.message, endTime: payload.endTime }
  }

  return undefined
}
