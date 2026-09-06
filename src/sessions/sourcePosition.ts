import { SourceMapConsumer } from 'source-map-js'

// Metro serve o app inteiro como UM script (o bundle) — "App.js" nunca existe
// como URL própria, só dentro do source map. Pra setar um breakpoint numa
// linha do arquivo original, é preciso traduzir arquivo+linha (posição
// ORIGINAL) pra linha+coluna do bundle (posição GERADA) antes de mandar pro
// CDP — o caminho contrário do que `symbolicate.ts` faz.
//
// Convenção do Metro: o source map de uma URL de bundle `.../index.bundle?...`
// fica em `.../index.map?...` (mesma query string, só troca a extensão).
function sourceMapUrlFor(bundleUrl: string): string {
  return bundleUrl.replace('.bundle', '.map')
}

const consumerCache = new Map<string, Promise<SourceMapConsumer | undefined>>()

async function loadConsumer(bundleUrl: string): Promise<SourceMapConsumer | undefined> {
  let cached = consumerCache.get(bundleUrl)
  if (!cached) {
    cached = fetchConsumer(bundleUrl)
    consumerCache.set(bundleUrl, cached)
  }
  return cached
}

async function fetchConsumer(bundleUrl: string): Promise<SourceMapConsumer | undefined> {
  try {
    const response = await fetch(sourceMapUrlFor(bundleUrl))
    if (!response.ok) return undefined
    const rawMap = (await response.json()) as ConstructorParameters<typeof SourceMapConsumer>[0]
    return new SourceMapConsumer(rawMap)
  } catch {
    return undefined
  }
}

export interface GeneratedPosition {
  /** 1-based, como o campo `line` do source map. */
  line: number
  /** 0-based. */
  column: number
}

export type FindGeneratedPositionResult =
  { ok: true; position: GeneratedPosition } | { ok: false; message: string }

/**
 * Acha, no source map do bundle, o único arquivo original cuja URL termina
 * com `file`, e traduz `lineNumber` (posição nesse arquivo) pra posição no
 * bundle. Ambíguo ou não encontrado vira erro — igual ao `resolveScriptUrl`
 * de `sessionManager.ts`, mas contra a lista de arquivos-fonte, não de scripts.
 */
export async function findGeneratedPosition(
  bundleUrl: string,
  file: string,
  lineNumber: number
): Promise<FindGeneratedPositionResult> {
  const consumer = await loadConsumer(bundleUrl)
  if (!consumer) {
    return {
      ok: false,
      message: 'não consegui carregar o source map do bundle (Metro fora do ar?)'
    }
  }

  const matches = [...new Set(consumer.sources.filter((source) => source.endsWith(file)))]
  if (matches.length === 0) {
    return { ok: false, message: `nenhum arquivo no source map termina com "${file}"` }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      message: `mais de um arquivo no source map termina com "${file}" (${matches.join(', ')}) — use um caminho mais específico`
    }
  }

  const generated = consumer.generatedPositionFor({
    source: matches[0],
    line: lineNumber,
    column: 0
  })
  if (generated.line === null) {
    return {
      ok: false,
      message: `a linha ${lineNumber} não corresponde a nenhuma posição no bundle`
    }
  }
  return { ok: true, position: { line: generated.line, column: generated.column ?? 0 } }
}

/** Lista os arquivos-fonte originais do bundle — é o que faz sentido sugerir
 *  no formulário de breakpoint (não a URL do bundle em si). */
export async function listSourceFiles(bundleUrl: string): Promise<string[]> {
  const consumer = await loadConsumer(bundleUrl)
  return consumer ? [...consumer.sources] : []
}
