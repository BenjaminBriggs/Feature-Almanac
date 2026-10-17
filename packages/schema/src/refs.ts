export const PREFIX_RE = /^[A-Z][A-Z0-9]{0,9}$/
export const PLATFORM_TAG_RE = /^[a-z][a-z0-9-]*$/
export const TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const ABSOLUTE_URL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/

export const CATEGORY_ID_RE = /^[1-9]\d*$/
export const FEATURE_ID_RE = /^[1-9]\d*\.[1-9]\d*$/
export const BEHAVIOUR_ID_RE = /^[1-9]\d*\.[1-9]\d*\.[1-9]\d*$/

/** §3 reference grammar: `[PREFIX-]id[@platform]`. */
export const REF_RE = /^(?:([A-Z][A-Z0-9]{0,9})-)?([1-9]\d*(?:\.[1-9]\d*){0,2})(?:@([a-z][a-z0-9-]*))?$/

export type IdLevel = 'category' | 'feature' | 'behaviour'

export interface ParsedRef {
  prefix?: string
  id: string
  platform?: string
  level: IdLevel
}

/** Parses a reference. A platform suffix is only valid on behaviour IDs (variant refs). */
export function parseRef(input: string): ParsedRef | undefined {
  const match = REF_RE.exec(input.trim())
  if (match === null) return undefined
  const id = match[2] as string
  const level = idLevel(id)
  const platform = match[3]
  if (platform !== undefined && level !== 'behaviour') return undefined
  const ref: ParsedRef = { id, level }
  if (match[1] !== undefined) ref.prefix = match[1]
  if (platform !== undefined) ref.platform = platform
  return ref
}

export function idLevel(id: string): IdLevel {
  const depth = id.split('.').length
  if (depth === 1) return 'category'
  if (depth === 2) return 'feature'
  return 'behaviour'
}

export function isValidId(id: string): boolean {
  return CATEGORY_ID_RE.test(id) || FEATURE_ID_RE.test(id) || BEHAVIOUR_ID_RE.test(id)
}

export function parentId(id: string): string | undefined {
  const dot = id.lastIndexOf('.')
  return dot === -1 ? undefined : id.slice(0, dot)
}

export function localNumber(id: string): number {
  return Number(id.slice(id.lastIndexOf('.') + 1))
}

/** Numeric, segment-wise comparison: `1.2` < `1.10` < `2`. Malformed segments sort last. */
export function compareIds(a: string, b: string): number {
  const left = a.split('.').map(segmentValue)
  const right = b.split('.').map(segmentValue)
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const x = left[i] ?? -1
    const y = right[i] ?? -1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function segmentValue(segment: string): number {
  const value = Number(segment)
  return Number.isInteger(value) ? value : Number.POSITIVE_INFINITY
}
