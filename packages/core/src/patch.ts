import { PATCH_OP_SCHEMAS, parentId, patchSchema, type Patch, type PatchAddOp, type PatchOp } from '@feature-almanac/schema'
import { applyChanges, type FileChange } from './changes.js'
import { compile, type Compilation, type CompileOptions } from './compile.js'
import { OverlayFileSystem } from './fs.js'
import {
  addBehaviour,
  addCategory,
  addFeature,
  addVariant,
  describeEntity,
  isoDate,
  moveEntity,
  removeEntity,
  renameEntity,
  reviewBehaviour,
  setValues,
  StaleReviewError,
  withChangelogEntry,
  type Mutation,
} from './mutations.js'
import { UsageError } from './query.js'
import { loadWorkspace } from './workspace.js'

export interface PatchCreated {
  op: number
  level: PatchAddOp['level']
  id: string
  as?: string
}

/** An op that changed an existing entity; `from` is the ref it was given when the ID differs (a move). */
export interface PatchEdit {
  op: number
  kind: Exclude<PatchOp['op'], 'add'>
  id: string
  from?: string
}

/** A review op left out because the behaviour changed after the reviewer judged it. */
export interface PatchSkipped {
  op: number
  ref: string
  reason: string
}

export interface PatchPlan {
  changes: FileChange[]
  created: PatchCreated[]
  edits: PatchEdit[]
  skipped: PatchSkipped[]
}

/** Parses and validates a patch document; problems are usage errors naming the op. */
export function parsePatch(input: unknown): Patch {
  const result = patchSchema.safeParse(input)
  if (result.success === false) {
    const issue = result.error.issues[0]
    throw new UsageError(`Invalid patch at ${issue?.path.join('.') || 'top level'}: ${issue?.message ?? 'unknown problem'}`)
  }
  return result.data
}

/**
 * `almanac apply`: runs the ops in order against an in-memory copy of the almanac, so later ops
 * see IDs allocated by earlier ones (`$name` placeholders) and the results of earlier edits, then
 * writes the changelog once per touched feature. Returns the file changes; the caller commits them
 * with `commitChanges`.
 */
export function planPatch(baseline: Compilation, patch: Patch, now: Date, options: CompileOptions = {}): PatchPlan {
  const workspace = baseline.workspace
  const overlay = new OverlayFileSystem(workspace.fs)
  const names = new Map<string, string>()
  const touched = new Map<string, Touched>()
  const created: PatchCreated[] = []
  const edits: PatchEdit[] = []
  const skipped: PatchSkipped[] = []
  const auto = patch.changelog === undefined || patch.changelog === 'auto'
  const ownChangelog = patch.changelog === 'none' || Array.isArray(patch.changelog)
  let current = baseline

  const placeholder = (value: string, index: number): string => {
    if (value.startsWith('$') === false) return value
    const id = names.get(value)
    if (id === undefined) throw new UsageError(`ops[${index}]: ${value} is not defined by an earlier op`)
    return id
  }
  const resolve = (value: string | undefined, index: number, what: string): string => {
    if (value === undefined) throw new UsageError(`ops[${index}]: "parent" (the ${what}) is required`)
    return placeholder(value, index)
  }
  const touch = (featureId: string) => {
    let entry = touched.get(featureId)
    if (entry === undefined) {
      entry = { featureAdded: false, added: [], names: [], changes: [], summaries: [] }
      touched.set(featureId, entry)
    }
    return entry
  }
  const required = (op: PatchAddOp, index: number, key: 'name' | 'description' | 'owner'): string => {
    const value = op[key]
    if (value === undefined) throw new UsageError(`ops[${index}]: "${key}" is required to add a ${op.level}`)
    return value
  }

  patch.ops.forEach((raw, index) => {
    const schema = PATCH_OP_SCHEMAS[raw.op as keyof typeof PATCH_OP_SCHEMAS]
    if (schema === undefined) {
      throw new UsageError(`ops[${index}]: unknown op "${raw.op}"; expected one of ${Object.keys(PATCH_OP_SCHEMAS).join(', ')}`)
    }
    const parsed = schema.safeParse(raw)
    if (parsed.success === false) {
      const issue = parsed.error.issues[0]
      const path = issue?.path.join('.') ?? ''
      throw new UsageError(`ops[${index}]${path === '' ? '' : `.${path}`}: ${issue?.message ?? 'invalid'}`)
    }
    const op = parsed.data as PatchOp
    if (op.op === 'review') {
      // A verdict on text that has since changed is stale: leave it out, apply the rest.
      const ref = placeholder(op.ref, index)
      let reviewed: Mutation
      try {
        reviewed = reviewBehaviour(current, { ref, state: op.state, by: op.by, hash: op.hash, ...(op.date !== undefined ? { date: op.date } : {}), ...(op.note !== undefined ? { note: op.note } : {}), now })
      } catch (error) {
        if (error instanceof StaleReviewError === false) throw error
        skipped.push({ op: index, ref, reason: error.message })
        return
      }
      edits.push({ op: index, kind: op.op, id: reviewed.id, ...(reviewed.id !== ref ? { from: ref } : {}) })
      applyChanges(overlay, reviewed.changes)
      current = compile(loadWorkspace(workspace.root, overlay), options)
      return
    }
    let mutation: Mutation
    if (op.op === 'add') {
      mutation = applyAdd(op, index)
    } else {
      const edit = { changelog: false, now }
      const ref = placeholder(op.ref, index)
      switch (op.op) {
        case 'set':
          mutation = setValues(current, { ...edit, ref, values: op.values })
          break
        case 'describe':
          mutation = describeEntity(current, { ...edit, ref, ...(op.description !== undefined ? { description: op.description } : {}), ...(op.overview !== undefined ? { overview: op.overview } : {}) })
          break
        case 'rename':
          mutation = renameEntity(current, { ...edit, ref, name: op.name })
          break
        case 'remove':
          mutation = removeEntity(current, { ...edit, ref, reason: op.reason })
          break
        case 'move':
          mutation = moveEntity(current, { ...edit, ref, to: placeholder(op.to, index) })
          break
      }
      for (const note of mutation.changelog ?? []) {
        const entry = touch(note.feature)
        entry.changes.push(...note.changes)
        entry.summaries.push(note.summary)
      }
      edits.push({ op: index, kind: op.op, id: mutation.id, ...(mutation.id !== ref ? { from: ref } : {}) })
    }
    applyChanges(overlay, mutation.changes)
    current = compile(loadWorkspace(workspace.root, overlay), options)
  })

  function applyAdd(op: PatchAddOp, index: number): Mutation {
    const optional = <K extends keyof PatchAddOp>(...keys: K[]) => {
      const out: Partial<Pick<PatchAddOp, K>> = {}
      for (const key of keys) if (op[key] !== undefined) out[key] = op[key]
      return out
    }
    let mutation: Mutation
    switch (op.level) {
      case 'category':
        mutation = addCategory(current, { name: required(op, index, 'name'), description: required(op, index, 'description'), ...optional('owner') })
        break
      case 'feature': {
        mutation = addFeature(current, {
          category: resolve(op.parent, index, 'category'),
          name: required(op, index, 'name'),
          description: required(op, index, 'description'),
          owner: required(op, index, 'owner'),
          ...optional('platforms', 'status', 'since', 'tags'),
          changelog: false,
          now,
        })
        touch(mutation.id).featureAdded = true
        break
      }
      case 'behaviour': {
        mutation = addBehaviour(current, {
          feature: resolve(op.parent, index, 'feature'),
          name: required(op, index, 'name'),
          description: required(op, index, 'description'),
          ...optional('platforms', 'format', 'source', 'status', 'since', 'tags', 'flag'),
          changelog: false,
          now,
        })
        const entry = touch(parentId(mutation.id) as string)
        entry.added.push(mutation.id)
        entry.names.push(op.name as string)
        entry.changes.push({ added: mutation.id })
        break
      }
      case 'variant': {
        mutation = addVariant(current, {
          behaviour: resolve(op.parent, index, 'behaviour'),
          platforms: op.platforms ?? [],
          description: required(op, index, 'description'),
          ...optional('mode', 'status', 'since', 'source'),
          changelog: false,
          now,
        })
        const behaviourId = mutation.id.split('@')[0] as string
        const entry = touch(parentId(behaviourId) as string)
        entry.added.push(mutation.id)
        entry.names.push(`${current.behaviours.get(behaviourId)?.model.name ?? behaviourId} (${mutation.id.split('@')[1]})`)
        entry.changes.push({ added: mutation.id })
        break
      }
    }
    if (op.as !== undefined) {
      if (names.has(op.as)) throw new UsageError(`ops[${index}]: ${op.as} is already defined`)
      names.set(op.as, mutation.id)
    }
    created.push({ op: index, level: op.level, id: mutation.id, ...(op.as !== undefined ? { as: op.as } : {}) })
    return mutation
  }

  const meta: Record<string, unknown> = {}
  if (patch.version !== undefined) meta.version = patch.version
  if (patch.ticket !== undefined) meta.ticket = patch.ticket
  if (patch.author !== undefined) meta.author = patch.author
  /** A feature touched before it moved is written under its new ID. */
  const final = (featureId: string) => current.formerly.get(featureId) ?? featureId
  const prepend = (featureId: string, entry: Record<string, unknown>) => {
    const handle = current.features.get(final(featureId))
    if (handle === undefined) throw new UsageError(`Changelog entry names feature ${featureId}, which does not exist`)
    overlay.writeFile(handle.file.absPath, withChangelogEntry(overlay.readFile(handle.file.absPath) ?? handle.file.text, entry))
  }

  if (auto) {
    const merged = new Map<string, Touched>()
    for (const [featureId, entry] of touched) {
      const id = final(featureId)
      const into = merged.get(id)
      if (into === undefined) merged.set(id, entry)
      else {
        into.featureAdded ||= entry.featureAdded
        into.added.push(...entry.added)
        into.names.push(...entry.names)
        into.changes.push(...entry.changes)
        into.summaries.push(...entry.summaries)
      }
    }
    for (const [featureId, entry] of merged) {
      const feature = current.features.get(featureId)
      const all = entry.featureAdded ? [{ feature: 'added' }, ...entry.changes] : entry.changes
      // Two edits of one feature both record `feature: modified`; list each change once.
      const changes = all.filter((change, index) => all.findIndex((other) => JSON.stringify(other) === JSON.stringify(change)) === index)
      prepend(featureId, {
        date: isoDate(now),
        summary: patch.summary ?? autoSummary(entry, feature?.model.name ?? featureId),
        changes,
        ...meta,
      })
    }
  } else if (ownChangelog && Array.isArray(patch.changelog)) {
    for (const entry of patch.changelog) {
      const featureId = entry.feature.startsWith('$') ? names.get(entry.feature) : entry.feature
      if (featureId === undefined) throw new UsageError(`Changelog entry names ${entry.feature}, which no op defines`)
      const { feature: _feature, ...rest } = entry
      prepend(featureId, { date: entry.date ?? isoDate(now), ...meta, ...rest })
    }
  }

  return { changes: overlay.changes(), created, edits, skipped }
}

interface Touched {
  featureAdded: boolean
  /** Refs and names of added behaviours and variants, for the generated summary. */
  added: string[]
  names: string[]
  changes: Record<string, unknown>[]
  /** Summaries the edits would have written on their own. */
  summaries: string[]
}

/** Additions in one sentence, then the summary of each edit in op order. */
function autoSummary(entry: Touched, featureName: string): string {
  const sentences: string[] = []
  if (entry.featureAdded) {
    const count = entry.names.length
    sentences.push(count === 0 ? `Added ${featureName}.` : `Added ${featureName} with ${count} behaviour${count === 1 ? '' : 's'}.`)
  } else if (entry.names.length > 0) {
    const shown = entry.names.slice(0, 3)
    const rest = entry.names.length - shown.length
    const list = rest > 0 ? `${shown.join(', ')} and ${rest} more` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0]
    sentences.push(`Added ${list}.`)
  }
  return [...sentences, ...entry.summaries].join(' ')
}
