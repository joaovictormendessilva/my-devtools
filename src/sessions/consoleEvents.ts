import { randomUUID } from 'node:crypto'
import type { ConsoleEntry, ConsoleLevel } from '../protocol/console'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// CDP usa "warning"; nosso ConsoleLevel usa "warn" (nome mais comum do console.* da web).
function levelFromCdpType(type: unknown): ConsoleLevel {
  if (type === 'error') return 'error'
  if (type === 'warning') return 'warn'
  if (type === 'info') return 'info'
  if (type === 'debug') return 'debug'
  return 'log'
}

// RemoteObject do CDP: primitivos vêm em `.value`, objetos/funções em `.description`.
// Pra um Error, `.description` traz a mensagem seguida da stack como texto — só
// a primeira linha (nome + mensagem) interessa aqui; a stack de verdade vem
// estruturada em `stackTrace.callFrames` (ver `extractCallFrames`), não daqui.
function formatRemoteObject(value: unknown): string {
  if (!isRecord(value)) return String(value)
  if ('value' in value) return String(value.value)
  if (typeof value.description === 'string') return value.description.split('\n')[0]
  return typeof value.type === 'string' ? value.type : 'object'
}

export interface StackFrame {
  functionName: string
  url: string
  lineNumber: number
  columnNumber: number
}

// O call stack de verdade do CDP: `Runtime.StackTrace.callFrames`, separado dos
// `args`/da `description` textual. `lineNumber`/`columnNumber` do CDP são
// 0-based. Frames sem `url` (ex: código nativo) não têm o que symbolicar.
function extractCallFrames(stackTrace: unknown): StackFrame[] {
  if (!isRecord(stackTrace) || !Array.isArray(stackTrace.callFrames)) return []

  return stackTrace.callFrames
    .filter(isRecord)
    .map((frame) => ({
      functionName:
        typeof frame.functionName === 'string' && frame.functionName
          ? frame.functionName
          : '<anonymous>',
      url: typeof frame.url === 'string' ? frame.url : '',
      lineNumber: typeof frame.lineNumber === 'number' ? frame.lineNumber : 0,
      columnNumber: typeof frame.columnNumber === 'number' ? frame.columnNumber : 0
    }))
    .filter((frame) => frame.url !== '')
}

export interface ParsedConsoleEvent {
  entry: ConsoleEntry
  /** Call stack estruturado do CDP pra symbolicar (`symbolicate.ts`). Vazio se
   *  o runtime não mandou um (nem todo console.* gera stack). */
  frames: StackFrame[]
}

// Só dois eventos CDP viram `ConsoleEntry` nesta fatia: console.* do app
// (`Runtime.consoleAPICalled`) e exceções não capturadas (`Runtime.exceptionThrown`).
// Qualquer outro evento (execution context criado, etc.) é ignorado — não é
// papel desta camada interpretar todo evento do CDP, só os de console.
export function parseConsoleEntry(message: unknown): ParsedConsoleEvent | undefined {
  if (!isRecord(message) || typeof message.method !== 'string') return undefined
  const params = isRecord(message.params) ? message.params : {}

  if (message.method === 'Runtime.consoleAPICalled') {
    const args = Array.isArray(params.args) ? params.args : []
    return {
      entry: {
        id: randomUUID(),
        level: levelFromCdpType(params.type),
        text: args.map(formatRemoteObject).join(' '),
        timestamp: typeof params.timestamp === 'number' ? params.timestamp : Date.now()
      },
      frames: extractCallFrames(params.stackTrace)
    }
  }

  if (message.method === 'Runtime.exceptionThrown') {
    const details = isRecord(params.exceptionDetails) ? params.exceptionDetails : {}
    const exception = isRecord(details.exception) ? details.exception : undefined
    const text = exception
      ? formatRemoteObject(exception)
      : typeof details.text === 'string'
        ? details.text
        : 'exceção não tratada'
    return {
      entry: {
        id: randomUUID(),
        level: 'error',
        text,
        timestamp: typeof params.timestamp === 'number' ? params.timestamp : Date.now()
      },
      frames: extractCallFrames(details.stackTrace)
    }
  }

  return undefined
}
