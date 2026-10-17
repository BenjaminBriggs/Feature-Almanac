import type { Almanac, PatchSetOp } from '@feature-almanac/schema'
import type { ChangedFile } from './affected.js'
import { allRemoved, entryOf, globRegExp, isGlob } from './entries.js'

/** One `source` or `code` entry pointed somewhere new. */
export interface Repoint {
  /** The entity's reference for people: `PD-1.2.3`, `PD-1.2.3@android`, `PD-1.2`. */
  ref: string
  field: 'source' | 'code'
  from: string
  to: string
}

/** An entry a rename touches that can't be repointed mechanically. */
export interface Unresolved {
  ref: string
  field: 'source' | 'code'
  entry: string
  reason: string
}

export interface RelinkPlan {
  /** `set` ops that write each changed entity's whole `source` or `code` list. */
  ops: PatchSetOp[]
  repoints: Repoint[]
  unresolved: Unresolved[]
}

/**
 * Repoints `source` and `code` entries at files a change renamed or moved. A file entry follows its
 * file and keeps its `#symbol`. A folder entry follows only when every renamed file under it moved
 * to one new folder and nothing is left behind (`stillHasFiles`). Globs, split folders and deleted
 * files are reported, not guessed. Removed entities are left as they are: they record the past.
 */
export function planRelink(model: Almanac, files: readonly ChangedFile[], stillHasFiles: (folder: string) => boolean): RelinkPlan {
  const renames = files.filter((file): file is ChangedFile & { from: string } => file.status === 'renamed' && file.from !== undefined)
  const deleted = new Set(files.filter((file) => file.status === 'deleted').map((file) => file.path))
  const plan: RelinkPlan = { ops: [], repoints: [], unresolved: [] }

  const relinkList = (ref: string, field: 'source' | 'code', entries: readonly string[]): string[] | undefined => {
    let changed = false
    const out: string[] = []
    for (const entry of entries) {
      const result = relinkEntry(entry, renames, deleted, stillHasFiles)
      if ('reason' in result) plan.unresolved.push({ ref, field, entry, reason: result.reason })
      const next = 'to' in result ? result.to : entry
      if (next !== entry) {
        changed = true
        plan.repoints.push({ ref, field, from: entry, to: next })
      }
      if (out.includes(next) === false) out.push(next)
    }
    return changed ? out : undefined
  }

  for (const category of model.categories) {
    if (category.status === 'removed') continue
    for (const feature of category.features) {
      if (allRemoved(feature.status)) continue
      const code = relinkList(feature.ref, 'code', feature.code)
      if (code !== undefined) plan.ops.push({ op: 'set', ref: feature.id, values: { code } })
      for (const behaviour of feature.behaviours) {
        if (allRemoved(behaviour.status)) continue
        const source = relinkList(behaviour.ref, 'source', behaviour.source.map(entryOf))
        if (source !== undefined) plan.ops.push({ op: 'set', ref: behaviour.id, values: { source } })
        for (const variant of behaviour.variants) {
          if (variant.status !== undefined && allRemoved(variant.status)) continue
          const platform = variant.ref.split('@')[1] ?? ''
          const variantSource = relinkList(`${behaviour.ref}@${platform}`, 'source', variant.source.map(entryOf))
          if (variantSource !== undefined) plan.ops.push({ op: 'set', ref: variant.ref, values: { source: variantSource } })
        }
      }
    }
  }
  return plan
}

type EntryResult = { to: string } | { reason: string } | { same: true }

function relinkEntry(entry: string, renames: readonly (ChangedFile & { from: string })[], deleted: ReadonlySet<string>, stillHasFiles: (folder: string) => boolean): EntryResult {
  const hash = entry.indexOf('#')
  const path = hash === -1 ? entry : entry.slice(0, hash)
  const symbol = hash === -1 ? '' : entry.slice(hash)

  if (isGlob(path)) {
    const pattern = globRegExp(path)
    return renames.some((file) => pattern.test(file.from)) ? { reason: 'a glob over renamed files; check it by hand' } : { same: true }
  }
  const file = renames.find((rename) => rename.from === path)
  if (file !== undefined) return { to: `${file.path}${symbol}` }
  if (deleted.has(path)) return { reason: 'the file was deleted' }

  const folder = path.endsWith('/') ? path : `${path}/`
  const inside = renames.filter((rename) => rename.from.startsWith(folder))
  if (inside.length === 0) return { same: true }
  const targets = new Set(
    inside.map((rename) => {
      const rest = rename.from.slice(folder.length)
      return rename.path.endsWith(`/${rest}`) ? rename.path.slice(0, rename.path.length - rest.length) : undefined
    }),
  )
  const [target] = targets
  if (targets.size !== 1 || target === undefined) return { reason: 'its files moved to different places' }
  if (stillHasFiles(folder)) return { reason: 'only some of its files moved' }
  return { to: `${path.endsWith('/') ? target : target.slice(0, -1)}${symbol}` }
}
