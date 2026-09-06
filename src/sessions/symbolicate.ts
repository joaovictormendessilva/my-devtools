import type { StackFrame } from './consoleEvents'
import { isRecord } from './remoteObject'

// Metro expõe `POST /symbolicate`: manda um stack cru (posição no bundle) e
// devolve o mesmo stack traduzido pro arquivo/linha reais do código-fonte, via
// source map. É o que o cliente oficial (React Native DevTools) usa pra
// mostrar stack trace legível — a gente, como "cliente não suportado" (ver
// aviso do próprio Metro), não pede isso automaticamente.
//
// Mesma limitação de host único do `deviceManager.ts`: assume um Metro rodando
// em localhost:8081.
const METRO_SYMBOLICATE_URL = 'http://localhost:8081/symbolicate'
const REQUEST_TIMEOUT_MS = 3000

export interface SymbolicatedFrame {
  functionName: string
  file: string
  lineNumber: number
  columnNumber: number
}

function toRawFrame(frame: StackFrame): SymbolicatedFrame {
  return {
    functionName: frame.functionName,
    file: frame.url,
    lineNumber: frame.lineNumber,
    columnNumber: frame.columnNumber
  }
}

function formatFrame(frame: SymbolicatedFrame): string {
  return `    at ${frame.functionName} (${frame.file}:${frame.lineNumber}:${frame.columnNumber})`
}

/**
 * Traduz um call stack estruturado do CDP pra arquivo/linha reais via Metro,
 * preservando ordem e quantidade — uma saída pra cada frame de entrada, na
 * mesma posição. `collapse` do Metro marca frame "menos relevante" (ex: glue
 * interno de evento) — mostramos mesmo assim; só cai pro frame cru (posição no
 * bundle, não symbolicado) na posição em que o Metro não conseguiu mapear
 * nenhum arquivo, em vez de descartar a entrada e desalinhar o restante.
 * Falha silenciosa: qualquer problema (Metro fora do ar, formato inesperado)
 * devolve tudo cru — symbolication é só uma melhoria de leitura, nunca deve
 * impedir a entrada de aparecer no painel.
 */
export async function symbolicateStructured(frames: StackFrame[]): Promise<SymbolicatedFrame[]> {
  if (frames.length === 0) return []
  const raw = frames.map(toRawFrame)

  try {
    const response = await fetch(METRO_SYMBOLICATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stack: frames.map((frame) => ({
          methodName: frame.functionName,
          file: frame.url,
          lineNumber: frame.lineNumber,
          column: frame.columnNumber
        }))
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) return raw

    const body: unknown = await response.json()
    const symbolicated = isRecord(body) && Array.isArray(body.stack) ? body.stack : undefined
    if (!symbolicated) return raw

    return raw.map((fallback, index) => {
      const frame: unknown = symbolicated[index]
      if (!isRecord(frame) || typeof frame.file !== 'string') return fallback
      return {
        functionName:
          typeof frame.methodName === 'string' ? frame.methodName : fallback.functionName,
        file: frame.file,
        lineNumber: typeof frame.lineNumber === 'number' ? frame.lineNumber : fallback.lineNumber,
        columnNumber: typeof frame.column === 'number' ? frame.column : fallback.columnNumber
      }
    })
  } catch {
    return raw
  }
}

export async function symbolicateFrames(frames: StackFrame[]): Promise<string> {
  const structured = await symbolicateStructured(frames)
  return structured.map(formatFrame).join('\n')
}
