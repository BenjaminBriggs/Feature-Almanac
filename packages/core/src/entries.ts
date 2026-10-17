import type { SourceRef } from '@feature-almanac/schema'
import { REMOVED } from './config.js'

/** Shared by `affected` and `relink`: how `source` and `code` entries are read. Internal to core. */

/** `path#symbol` back from a compiled source reference. */
export function entryOf(source: SourceRef): string {
  return source.symbol === undefined ? source.path : `${source.path}#${source.symbol}`
}

export function isGlob(path: string): boolean {
  return /[*?[\]{}]/.test(path)
}

/** `**` crosses folders, `*` and `?` stay within one. */
export function globRegExp(glob: string): RegExp {
  const source = glob
    .split(/(\*\*\/?|\*|\?)/)
    .map((part) => (part === '**/' || part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')
  return new RegExp(`^${source}$`)
}

/** Removed on every platform it has: a tombstone. */
export function allRemoved(status: Readonly<Record<string, string>>): boolean {
  return Object.values(status).every((value) => value === REMOVED)
}
