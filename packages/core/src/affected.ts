import type { Almanac, SourceRef } from '@feature-almanac/schema'
import { allRemoved, entryOf, globRegExp, isGlob } from './entries.js'

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** One file a code change touched, with paths relative to the code root (`code.path`). */
export interface ChangedFile {
  path: string
  status: FileStatus
  /** The old path of a renamed file. */
  from?: string
}

/** A `source` or `code` entry that names a changed file. */
export interface Citation {
  /** The entry as written, e.g. `Sources/Editor/Autosave.swift#save` or `Sources/Sync/`. */
  entry: string
  file: ChangedFile
  /** The entry names a renamed file by its old path: `almanac relink` repoints it. */
  stale?: true
}

export interface AffectedBehaviour {
  id: string
  ref: string
  name: string
  /** The behaviour's own `source` entries and its variants' (marked with the variant's ref, `PD-1.2.3@android`). */
  citations: (Citation & { variant?: string })[]
}

export interface AffectedFeature {
  id: string
  ref: string
  name: string
  categoryId: string
  behaviours: AffectedBehaviour[]
  /** The feature's `code` entries that cover a changed file. */
  code: Citation[]
}

export interface Affected {
  features: AffectedFeature[]
  /** Changed files that no live behaviour's `source` and no feature's `code` names. */
  uncited: ChangedFile[]
}

/**
 * Which features and behaviours a code change touches: those whose `source` (or, for features, `code`)
 * names a changed file, a renamed file's old path, or a folder or glob that covers one. Removed
 * entities are left out; they describe nothing the change can alter.
 */
export function affectedBy(model: Almanac, files: readonly ChangedFile[]): Affected {
  const cited = new Set<ChangedFile>()
  const features: AffectedFeature[] = []
  const match = (entry: string): Citation[] => {
    const pattern = entryPattern(entry)
    const hits = files.filter((file) => pattern(file.path) || (file.from !== undefined && pattern(file.from)))
    for (const file of hits) cited.add(file)
    return hits.map((file) => (file.from !== undefined && pattern(file.from) && pattern(file.path) === false ? { entry, file, stale: true as const } : { entry, file }))
  }
  const citations = (sources: readonly SourceRef[]) => sources.flatMap((source) => match(entryOf(source)))

  for (const category of model.categories) {
    if (category.status === 'removed') continue
    for (const feature of category.features) {
      if (allRemoved(feature.status)) continue
      const behaviours: AffectedBehaviour[] = []
      for (const behaviour of feature.behaviours) {
        if (allRemoved(behaviour.status)) continue
        const own = citations(behaviour.source)
        const variants = behaviour.variants
          .filter((variant) => variant.status === undefined || allRemoved(variant.status) === false)
          .flatMap((variant) => citations(variant.source).map((citation) => ({ ...citation, variant: `${behaviour.ref}@${variant.ref.split('@')[1] ?? ''}` })))
        if (own.length + variants.length > 0) behaviours.push({ id: behaviour.id, ref: behaviour.ref, name: behaviour.name, citations: [...own, ...variants] })
      }
      const code = feature.code.flatMap(match)
      if (behaviours.length + code.length > 0) {
        features.push({ id: feature.id, ref: feature.ref, name: feature.name, categoryId: category.id, behaviours, code })
      }
    }
  }
  return { features, uncited: files.filter((file) => cited.has(file) === false) }
}

/**
 * Reads `git diff --name-status` output (`M\tpath`, `R087\told\tnew`, …) or a plain list of paths,
 * one per line, as `gh pr diff --name-only` prints. Copies count as added files.
 */
export function parseChangedFiles(text: string): ChangedFile[] {
  const files: ChangedFile[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') continue
    const fields = line.split('\t')
    const code = fields.length > 1 ? (fields[0] as string).trim() : ''
    if (/^R\d*$/.test(code) && fields.length >= 3) {
      files.push({ path: fields[2] as string, status: 'renamed', from: fields[1] as string })
    } else if (/^C\d*$/.test(code) && fields.length >= 3) {
      files.push({ path: fields[2] as string, status: 'added' })
    } else if (/^[AMDTU]$/.test(code) && fields.length >= 2) {
      files.push({ path: fields[1] as string, status: code === 'A' ? 'added' : code === 'D' ? 'deleted' : 'modified' })
    } else {
      files.push({ path: line.trim(), status: 'modified' })
    }
  }
  return files
}

/**
 * A path test for one `source` or `code` entry: the symbol after `#` is dropped; a glob (`*`, `**`, `?`)
 * matches as a glob; anything else matches that file, or everything under it when it is a folder.
 */
function entryPattern(entry: string): (path: string) => boolean {
  const target = (entry.split('#')[0] as string).replace(/^\.\//, '')
  if (isGlob(target)) {
    const regex = globRegExp(target)
    return (path) => regex.test(path)
  }
  const folder = target.endsWith('/') ? target : `${target}/`
  return (path) => path === target || path.startsWith(folder)
}
