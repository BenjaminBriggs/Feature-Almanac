import type { z } from 'zod'
import type { FileKind } from '@feature-almanac/schema'
import { valueAt, type Path } from './yaml.js'

export interface SchemaProblem {
  code: 'ALM-E002' | 'ALM-E003' | 'ALM-E006' | 'ALM-E009'
  path: Path
  message: string
}

const ID_LIST_KEYS = new Set(['depends_on', 'related', 'formerly'])

/** Validates `raw` and maps zod issues onto the §10 codes. */
export function validate<T>(schema: z.ZodType<T>, raw: unknown, kind: FileKind): { data?: T; problems: SchemaProblem[] } {
  const result = schema.safeParse(raw)
  if (result.success) return { data: result.data, problems: [] }
  const problems: SchemaProblem[] = []
  for (const issue of result.error.issues) {
    const path = issue.path.map((segment) => (typeof segment === 'number' ? segment : String(segment)))
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) problems.push({ code: 'ALM-E002', path: [...path, key], message: `Unknown key "${key}"` })
      continue
    }
    const value = valueAt(raw, path)
    const last = path[path.length - 1]
    if (value === undefined && typeof last === 'string') {
      problems.push({ code: 'ALM-E006', path, message: `Missing required field "${last}"` })
      continue
    }
    if (issue.code === 'invalid_type' && issue.expected === 'string' && typeof value === 'number') {
      const idLike = kind === 'feature' && (last === 'id' || ID_LIST_KEYS.has(String(path[path.length - 2])))
      problems.push({
        code: idLike ? 'ALM-E003' : 'ALM-E009',
        path,
        message: `${describe(path)} must be a quoted string, got the number ${value}`,
      })
      continue
    }
    problems.push({ code: 'ALM-E009', path, message: `${describe(path)}: ${issue.message}` })
  }
  return { problems }
}

function describe(path: Path): string {
  if (path.length === 0) return 'File'
  return path.map((segment) => (typeof segment === 'number' ? `[${segment}]` : segment)).join('.').replace(/\.\[/g, '[')
}
