import { isRecord } from './remoteObject'

// Escopo de uma call frame do CDP (`Debugger.CallFrame.scopeChain`). Só guarda
// o que é preciso pra buscar as variáveis depois via `Runtime.getProperties`
// (ver `sessionManager.ts`) — o resto do RemoteObject não interessa aqui.
export interface CdpScope {
  type: string
  objectId?: string
}

export interface ParsedPausedFrame {
  callFrameId: string
  functionName: string
  scriptId: string
  lineNumber: number
  columnNumber: number
  scopeChain: CdpScope[]
}

export interface ParsedPaused {
  frames: ParsedPausedFrame[]
}

// `Debugger.scriptParsed` chega uma vez por script carregado no runtime — é a
// única forma de traduzir o `scriptId` (usado em `Debugger.paused`) de volta
// pra uma URL de arquivo (ver `scriptUrls` em `sessionManager.ts`).
export function parseScriptParsed(message: unknown): { scriptId: string; url: string } | undefined {
  if (!isRecord(message) || message.method !== 'Debugger.scriptParsed') return undefined
  const params = isRecord(message.params) ? message.params : {}
  if (typeof params.scriptId !== 'string' || typeof params.url !== 'string') return undefined
  return { scriptId: params.scriptId, url: params.url }
}

export function isDebuggerResumed(message: unknown): boolean {
  return isRecord(message) && message.method === 'Debugger.resumed'
}

export function parseDebuggerPaused(message: unknown): ParsedPaused | undefined {
  if (!isRecord(message) || message.method !== 'Debugger.paused') return undefined
  const params = isRecord(message.params) ? message.params : {}
  const callFrames = Array.isArray(params.callFrames) ? params.callFrames : []

  const frames = callFrames.filter(isRecord).map((frame) => {
    const location = isRecord(frame.location) ? frame.location : {}
    const scopeChain = Array.isArray(frame.scopeChain) ? frame.scopeChain : []

    return {
      callFrameId: typeof frame.callFrameId === 'string' ? frame.callFrameId : '',
      functionName:
        typeof frame.functionName === 'string' && frame.functionName
          ? frame.functionName
          : '<anonymous>',
      scriptId: typeof location.scriptId === 'string' ? location.scriptId : '',
      lineNumber: typeof location.lineNumber === 'number' ? location.lineNumber : 0,
      columnNumber: typeof location.columnNumber === 'number' ? location.columnNumber : 0,
      scopeChain: scopeChain.filter(isRecord).map((scope) => ({
        type: typeof scope.type === 'string' ? scope.type : 'unknown',
        objectId:
          isRecord(scope.object) && typeof scope.object.objectId === 'string'
            ? scope.object.objectId
            : undefined
      }))
    }
  })

  return { frames }
}
