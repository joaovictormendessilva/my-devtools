import type { StackFrame } from './consoleEvents'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatRawFrame(frame: StackFrame): string {
  return `    at ${frame.functionName} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`
}

// Formata um frame já symbolicado de volta pro mesmo estilo "at nome (arquivo:linha:coluna)".
// `collapse` do Metro marca frame "menos relevante" (ex: glue interno de
// evento) — mostramos mesmo assim, só descartando o que o Metro não conseguiu
// mapear pra arquivo nenhum (nesse caso não sobra nada útil pra exibir).
function formatSymbolicatedFrame(frame: unknown): string | undefined {
  if (!isRecord(frame)) return undefined
  const file = typeof frame.file === 'string' ? frame.file : undefined
  if (!file) return undefined
  const methodName = typeof frame.methodName === 'string' ? frame.methodName : '<anonymous>'
  const line = typeof frame.lineNumber === 'number' ? frame.lineNumber : '?'
  const column = typeof frame.column === 'number' ? frame.column : '?'
  return `    at ${methodName} (${file}:${line}:${column})`
}

/**
 * Traduz um call stack estruturado do CDP pra arquivo/linha reais via Metro.
 * Falha silenciosa: qualquer problema (Metro fora do ar, formato inesperado)
 * devolve o stack cru formatado (posição no bundle, não no código-fonte) em
 * vez de nada — symbolication é só uma melhoria de leitura, nunca deve
 * impedir a entrada de aparecer no painel.
 */
export async function symbolicateFrames(frames: StackFrame[]): Promise<string> {
  if (frames.length === 0) return ''
  const rawFormatted = frames.map(formatRawFrame).join('\n')

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
    if (!response.ok) return rawFormatted

    const body: unknown = await response.json()
    const symbolicated = isRecord(body) && Array.isArray(body.stack) ? body.stack : undefined
    if (!symbolicated) return rawFormatted

    const formatted = symbolicated.map(formatSymbolicatedFrame).filter((line) => line !== undefined)
    return formatted.length > 0 ? formatted.join('\n') : rawFormatted
  } catch {
    return rawFormatted
  }
}
