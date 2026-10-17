import { LineCounter, isMap, isScalar, isSeq, parseDocument, type Document, type ToStringOptions } from 'yaml'
import type { FileKind } from '@feature-almanac/schema'

export type Path = readonly (string | number)[]

export interface YamlProblem {
  message: string
  line: number
}

export interface ParsedYaml {
  doc: Document.Parsed
  lineCounter: LineCounter
  /** Parse errors and warnings (unresolved tags, duplicate keys). Any problem means the data is not trustworthy. */
  problems: YamlProblem[]
}

export const STRINGIFY_OPTIONS: ToStringOptions = {
  lineWidth: 0,
  flowCollectionPadding: false,
}

export function parseYaml(text: string): ParsedYaml {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, {
    version: '1.2',
    schema: 'core',
    keepSourceTokens: true,
    uniqueKeys: true,
    prettyErrors: false,
    lineCounter,
  })
  const problems = [...doc.errors, ...doc.warnings].map((problem) => ({
    message: problem.message,
    line: lineCounter.linePos(problem.pos[0]).line,
  }))
  return { doc, lineCounter, problems }
}

/** Plain JS value with null-valued map entries dropped, so `key:` reads as absent. */
export function plainValue(doc: Document): unknown {
  return stripNulls(doc.toJS({ maxAliasCount: 100 }))
}

export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null) continue
      out[key] = stripNulls(entry)
    }
    return out
  }
  return value
}

/** Line of the deepest node along `path` that exists. */
export function lineAt(parsed: ParsedYaml, path: Path): number | undefined {
  let node: unknown = parsed.doc.contents
  let line = nodeLine(parsed, node)
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find((item) => isScalar(item.key) && String(item.key.value) === String(segment))
      if (pair === undefined) break
      node = pair.value ?? pair.key
    } else if (isSeq(node) && typeof segment === 'number') {
      const item = node.items[segment]
      if (item === undefined) break
      node = item
    } else {
      break
    }
    line = nodeLine(parsed, node) ?? line
  }
  return line
}

function nodeLine(parsed: ParsedYaml, node: unknown): number | undefined {
  if (typeof node !== 'object' || node === null || 'range' in node === false) return undefined
  const range = node.range
  if (Array.isArray(range) === false || typeof range[0] !== 'number') return undefined
  return parsed.lineCounter.linePos(range[0]).line
}

/** `behaviours[3].platforms[1]` */
export function formatPath(path: Path): string {
  let out = ''
  for (const segment of path) {
    if (typeof segment === 'number') out += `[${segment}]`
    else out += out === '' ? segment : `.${segment}`
  }
  return out
}

export function valueAt(value: unknown, path: Path): unknown {
  let current = value
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

export const SCHEMA_BASE_URL = 'https://feature-almanac.dev/schema/v1'

export function schemaHeader(kind: FileKind): string {
  return ` yaml-language-server: $schema=${SCHEMA_BASE_URL}/${kind}.json`
}

/**
 * Files are read as YAML 1.2, but written so YAML 1.1 readers (PyYAML, many agents' tooling) get
 * the same values: strings such as `yes`, `no`, `on` or `1:30` stay quoted.
 */
export function serialize(doc: Document): string {
  doc.setSchema('1.2', { compat: 'yaml-1.1' })
  return doc.toString(STRINGIFY_OPTIONS)
}
