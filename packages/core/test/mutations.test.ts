import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  InvalidStateError,
  UsageError,
  addChangelogEntry,
  commitChanges,
  compile,
  describeEntity,
  loadWorkspace,
  lookup,
  moveEntity,
  nextId,
  parseAssignments,
  parseChange,
  removeEntity,
  renameEntity,
  setValues,
  type Compilation,
  type Mutation,
} from '@feature-almanac/core'
import { BASE, FEATURE, ROOT, SYNC, memoryFs, type Files } from './helpers.js'

const NOW = new Date('2026-10-16T12:00:00Z')

const CLOUD = `id: "2.1"
name: Cloud sync
description: Notes sync between devices signed into one account.
owner: ben
status: shipped
related: ["1.1"]
next_behaviour: 2

behaviours:
  - id: "2.1.1"
    name: Background sync
    description: Edits appear on other devices within seconds.

changelog:
  - date: "2026-01-01"
    summary: Initial release.
    changes:
      - feature: added
      - added: "2.1.1"
`

/** BASE plus a feature in category 2 that relates to 1.1. */
const FILES: Files = {
  ...BASE,
  '02-sync/category.yaml': SYNC.replace('next_feature: 1', 'next_feature: 2'),
  '02-sync/01-cloud-sync.yaml': CLOUD,
}

function open(files: Files = FILES) {
  const fs = memoryFs(files)
  return { fs, compilation: compile(loadWorkspace(ROOT, fs), { now: NOW }) }
}

/** Commits a mutation and checks it introduced no errors; returns the new compilation and file system. */
function apply(files: Files, plan: (compilation: Compilation) => Mutation) {
  const { fs, compilation } = open(files)
  const mutation = plan(compilation)
  const result = commitChanges(compilation, mutation.changes, { compileOptions: { now: NOW } })
  expect(result.introduced).toEqual([])
  expect(result.applied).toBe(true)
  const read = (path: string) => fs.readFile(join(ROOT, path)) ?? ''
  return { fs, mutation, after: result.after, read, codes: result.after.diagnostics.map((d) => d.code) }
}

describe('set', () => {
  it('spreads a plain status over the platforms to set one, and collapses it back', () => {
    const first = apply(FILES, (c) => setValues(c, { ref: '1.1', values: parseAssignments(['status.android=planned']), now: NOW }))
    expect(first.read(FEATURE)).toContain('status:\n  ios: shipped\n  android: planned\n  macos: shipped\n')
    expect(first.read(FEATURE)).toContain(`changelog:
  - date: "2026-10-16"
    summary: Set status.android → planned on Editor.
    changes:
      - feature: modified
`)
    expect(first.after.features.get('1.1')?.model.status).toEqual({ ios: 'shipped', android: 'planned', macos: 'shipped' })

    const back = apply(
      { ...FILES, [FEATURE]: first.read(FEATURE) },
      (c) => setValues(c, { ref: '1.1', values: { 'status.android': 'shipped' }, summary: 'Android ships.', now: NOW }),
    )
    expect(back.read(FEATURE)).toContain('status: shipped\n')
    expect(back.read(FEATURE)).toContain('summary: Android ships.')
  })

  it('types values by key: lists split on commas, empty unsets, fields follow their definition', () => {
    const config = BASE['almanac.yaml'] + 'fields:\n  behaviour:\n    risk: { type: number }\n'
    const files = { ...FILES, 'almanac.yaml': config, [FEATURE]: (BASE[FEATURE] ?? '').replace('    name: Autosave\n', '    name: Autosave\n    flag: autosave_v2\n') }
    const { read, after } = apply(files, (c) =>
      setValues(c, { ref: '1.1.2', values: parseAssignments(['tags=core, saving', 'source=Sources/Autosave.swift', 'flag=', 'fields.risk=3', 'since.ios=1.2']), now: NOW }),
    )
    const autosave = after.behaviours.get('1.1.2')?.data
    expect(autosave).toMatchObject({ tags: ['core', 'saving'], source: ['Sources/Autosave.swift'], fields: { risk: 3 }, since: { ios: '1.2' } })
    expect(autosave?.flag).toBeUndefined()
    expect(read(FEATURE)).toContain('    since:\n      ios: "1.2"\n    source: [Sources/Autosave.swift]\n    tags: [core, saving]\n    fields:\n      risk: 3\n')
  })

  it('edits a variant and records its ref', () => {
    const { read } = apply(FILES, (c) => setValues(c, { ref: 'TP-1.1.1@android', values: { status: 'in-progress' }, now: NOW }))
    expect(read(FEATURE)).toContain('      - platforms: [android]\n        description: Triggered from the formatting bar above the keyboard.\n        status: in-progress\n')
    expect(read(FEATURE)).toContain('      - modified: "1.1.1@android"')
  })

  it('refuses keys it does not own, and edits that change nothing', () => {
    const { compilation } = open()
    const set = (ref: string, values: Record<string, unknown>) => () => setValues(compilation, { ref, values, now: NOW })
    expect(set('1.1', { id: '1.9' })).toThrow('IDs never change')
    expect(set('1.1', { name: 'X' })).toThrow('use almanac rename')
    expect(set('1.1.1', { description: 'X' })).toThrow('use almanac describe')
    expect(set('1.1.1', { next_behaviour: 9 })).toThrow('ID counters are managed')
    expect(set('1.1.1', { owner: 'ben' })).toThrow('owner is not settable on a behaviour')
    expect(set('1.1.1', { 'tags.x': 'a' })).toThrow('only status.<platform>')
    expect(set('1.1.1', { 'status.web': 'shipped' })).toThrow('Unknown platform "web"')
    expect(set('1.1', { status: 'removed' })).toThrow('use almanac remove 1.1 --reason')
    expect(set('1.1', { tags: 7 })).toThrow('tags must be a list of strings')
    expect(set('1.1', { status: 'shipped' })).toThrow(InvalidStateError)
    expect(() => parseAssignments(['status'])).toThrow('"status" is not key=value')
    expect(() => parseAssignments([])).toThrow(UsageError)
  })

  it('points at the variant when a variant’s own status would override the behaviour’s', () => {
    const files = { ...FILES, [FEATURE]: (BASE[FEATURE] ?? '').replace('above the keyboard.\n', 'above the keyboard.\n        status: in-progress\n') }
    const { compilation } = open(files)
    expect(() => setValues(compilation, { ref: '1.1.1', values: { 'status.android': 'shipped' }, now: NOW })).toThrow(
      'Variant 1.1.1@android sets its own status on android',
    )
    expect(setValues(compilation, { ref: '1.1.1', values: { 'status.ios': 'in-progress' }, now: NOW }).id).toBe('1.1.1')
  })

  it('is rejected by commitChanges when the result would not lint', () => {
    const { compilation } = open()
    const mutation = setValues(compilation, { ref: '1.1.1', values: { platforms: 'ios' }, now: NOW })
    expect(commitChanges(compilation, mutation.changes).introduced.map((d) => d.code)).toEqual(['ALM-E031'])
  })
})

describe('describe', () => {
  it('replaces a description, writing multi-line text as a block', () => {
    const { read, codes } = apply(FILES, (c) => describeEntity(c, { ref: '1.1.2', description: 'Saves the note after one second.\nNever interrupts typing.\n', now: NOW }))
    expect(read(FEATURE)).toContain('    description: |\n      Saves the note after one second.\n      Never interrupts typing.\n')
    expect(read(FEATURE)).toContain('summary: Updated the description of Autosave.\n    changes:\n      - modified: "1.1.2"')
    expect(codes).toEqual([])
  })

  it('sets a feature overview, and only a feature’s', () => {
    const { read } = apply(FILES, (c) => describeEntity(c, { ref: '1.1', overview: 'CommonMark with task lists.', now: NOW }))
    expect(read(FEATURE)).toContain('overview: CommonMark with task lists.\n')
    expect(read(FEATURE)).toContain('      - feature: modified')
    const { compilation } = open()
    expect(() => describeEntity(compilation, { ref: '1.1.1', overview: 'x', now: NOW })).toThrow('Only features have an overview')
    expect(() => describeEntity(compilation, { ref: '1.1.2', description: 'Saves the note after one second of idle input.\n', now: NOW })).toThrow('Nothing to change')
    expect(() => describeEntity(compilation, { ref: '1.1.2', now: NOW })).toThrow('exactly one')
  })

  it('describes categories without a changelog', () => {
    const { read } = apply(FILES, (c) => describeEntity(c, { ref: '2', description: 'Keeping every device up to date.', now: NOW }))
    expect(read('02-sync/category.yaml')).toContain('description: Keeping every device up to date.\n')
  })
})

describe('rename', () => {
  it('renames a feature and its file', () => {
    const { fs, read, mutation, codes } = apply(FILES, (c) => renameEntity(c, { ref: '1.1', name: 'Note editor', now: NOW }))
    expect(mutation.changes.map((change) => change.kind)).toEqual(['rename', 'write'])
    expect(fs.readFile(join(ROOT, FEATURE))).toBeUndefined()
    expect(read('01-editing/01-note-editor.yaml')).toContain('name: Note editor\n')
    expect(read('01-editing/01-note-editor.yaml')).toContain('summary: Renamed Editor to Note editor.')
    expect(codes).toEqual([])
  })

  it('renames a category and its folder, and a behaviour in place', () => {
    const category = apply(FILES, (c) => renameEntity(c, { ref: '1', name: 'Writing', now: NOW }))
    expect(category.read('01-writing/category.yaml')).toContain('name: Writing\n')
    expect(category.read('01-writing/01-editor.yaml')).toBe(BASE[FEATURE])
    expect(category.fs.isDirectory(join(ROOT, '01-editing'))).toBe(false)
    expect(category.codes).toEqual([])

    const behaviour = apply(FILES, (c) => renameEntity(c, { ref: '1.1.1', name: 'Bold text', now: NOW }))
    expect(behaviour.read(FEATURE)).toContain('    name: Bold text\n')
    expect(behaviour.read(FEATURE)).toContain('summary: Renamed Bold to Bold text.\n    changes:\n      - modified: "1.1.1"')
  })

  it('refuses variants and unchanged names', () => {
    const { compilation } = open()
    expect(() => renameEntity(compilation, { ref: '1.1.1@android', name: 'X', now: NOW })).toThrow('Variants have no name')
    expect(() => renameEntity(compilation, { ref: '1.1', name: 'Editor', now: NOW })).toThrow(InvalidStateError)
  })
})

describe('remove', () => {
  it('tombstones a behaviour with its reason', () => {
    const { read, after, codes } = apply(FILES, (c) => removeEntity(c, { ref: '1.1.2', reason: 'Replaced by explicit save.', now: NOW }))
    expect(read(FEATURE)).toContain('    name: Autosave\n    description: Saves the note after one second of idle input.\n    status: removed\n    removed_reason: Replaced by explicit save.\n')
    expect(read(FEATURE)).toContain('      - removed: "1.1.2"\n        detail: Replaced by explicit save.')
    expect(after.behaviours.get('1.1.2')?.model.status).toEqual({ ios: 'removed', android: 'removed', macos: 'removed' })
    expect(codes).toEqual([])
  })

  it('tombstones a variant', () => {
    const { read, after } = apply(FILES, (c) => removeEntity(c, { ref: '1.1.1@android', reason: 'The formatting bar is gone.', now: NOW }))
    expect(read(FEATURE)).toContain('        status: removed\n        removed_reason: The formatting bar is gone.\n')
    expect(read(FEATURE)).toContain('      - removed: "1.1.1@android"')
    expect(after.behaviours.get('1.1.1')?.model.status.android).toBe('removed')
  })

  it('tombstones a feature, then its category once nothing in it is live', () => {
    const feature = apply(FILES, (c) => removeEntity(c, { ref: '2.1', reason: 'Sync moved to a separate app.', now: NOW }))
    expect(feature.read('02-sync/01-cloud-sync.yaml')).toContain('status: removed\n')
    expect(feature.read('02-sync/01-cloud-sync.yaml')).toContain('      - feature: removed\n        detail: Sync moved to a separate app.')

    const { compilation } = open()
    expect(() => removeEntity(compilation, { ref: '2', reason: 'Gone.', now: NOW })).toThrow('still has live features (2.1)')
    const files = { ...FILES, '02-sync/01-cloud-sync.yaml': feature.read('02-sync/01-cloud-sync.yaml') }
    const category = apply(files, (c) => removeEntity(c, { ref: '2', reason: 'Sync moved to a separate app.', now: NOW }))
    expect(category.read('02-sync/category.yaml')).toContain('status: removed\nremoved_reason: Sync moved to a separate app.\n')
    expect(category.codes).toEqual([])
  })

  it('needs a reason and a live entity', () => {
    const { compilation } = open()
    expect(() => removeEntity(compilation, { ref: '1.1.2', reason: ' ', now: NOW })).toThrow('A reason is required')
    const removed = apply(FILES, (c) => removeEntity(c, { ref: '1.1.2', reason: 'Gone.', now: NOW }))
    expect(() => removeEntity(removed.after, { ref: '1.1.2', reason: 'Again.', now: NOW })).toThrow('1.1.2 is already removed')
  })
})

describe('mv', () => {
  it('re-IDs a behaviour under another feature and records the move in both changelogs', () => {
    const { read, after, mutation, codes } = apply(FILES, (c) => moveEntity(c, { ref: '1.1.2', to: '2.1', now: NOW }))
    expect(mutation.id).toBe('2.1.2')
    const cloud = read('02-sync/01-cloud-sync.yaml')
    expect(cloud).toContain('next_behaviour: 3\n')
    expect(cloud).toContain('  - id: "2.1.2"\n    name: Autosave\n    description: Saves the note after one second of idle input.\n    formerly: ["1.1.2"]\n')
    expect(cloud).toContain('    summary: Moved Autosave from Editor.\n    changes:\n      - moved:\n          from: "1.1.2"\n          to: "2.1.2"\n')
    const editor = read(FEATURE)
    expect(editor).not.toContain('name: Autosave')
    expect(editor).toContain('next_behaviour: 3\n')
    expect(editor).toContain('    summary: Moved Autosave to Cloud sync.\n')
    expect(lookup(after, '1.1.2')).toMatchObject({ target: { kind: 'behaviour' }, redirects: [{ from: '1.1.2', to: '2.1.2' }] })
    expect(codes).toEqual([])
  })

  it('re-IDs a feature, its behaviours and references to it elsewhere', () => {
    const { fs, read, after, mutation, codes } = apply(FILES, (c) => moveEntity(c, { ref: '1.1', to: '2', now: NOW }))
    expect(mutation.id).toBe('2.2')
    expect(fs.readFile(join(ROOT, FEATURE))).toBeUndefined()
    const moved = read('02-sync/02-editor.yaml')
    expect(moved).toContain('id: "2.2"\n')
    expect(moved).toContain('formerly: ["1.1"]\nnext_behaviour: 3\n')
    expect(moved).toContain('  - id: "2.2.1"\n    name: Bold\n')
    expect(moved).toContain('    formerly: ["1.1.1"]\n')
    expect(moved).toContain('    formerly: ["1.1.2"]\n')
    expect(moved).toContain('    summary: Moved Editor from Editing to Sync.\n    changes:\n      - moved:\n          from: "1.1"\n          to: "2.2"\n')
    // History keeps its old IDs; they resolve through formerly.
    expect(moved).toContain('      - added: "1.1.1"')
    expect(read('02-sync/category.yaml')).toContain('next_feature: 3\n')
    expect(read('02-sync/01-cloud-sync.yaml')).toContain('related: ["2.2"]\n')
    expect(after.features.get('2.2')?.model.behaviours.map((b) => b.id)).toEqual(['2.2.1', '2.2.2'])
    expect(codes).toEqual([])
    expect(nextId(after, '1').id).toBe('1.2')
  })

  it('never moves categories or variants, and refuses no-op or removed targets', () => {
    const { compilation } = open()
    const mv = (ref: string, to: string) => () => moveEntity(compilation, { ref, to, now: NOW })
    expect(mv('1', '2')).toThrow('Categories never move')
    expect(mv('1.1.1@android', '2.1')).toThrow('Variants move with their behaviour; move 1.1.1')
    expect(mv('1.1.1', '1.1')).toThrow('already in feature 1.1')
    expect(mv('1.1', '1')).toThrow('already in category 1')
    expect(mv('1.1', '1.1')).toThrow('"1.1" is not a category ID')
    expect(mv('1.1.1', '9.9')).toThrow('Feature 9.9 not found')
    const removed = apply(FILES, (c) => removeEntity(c, { ref: '2.1', reason: 'Gone.', now: NOW }))
    expect(() => moveEntity(removed.after, { ref: '1.1.1', to: '2.1', now: NOW })).toThrow('Feature 2.1 is removed')
  })
})

describe('changelog add', () => {
  it('parses --change values and prepends the entry', () => {
    const { compilation } = open()
    expect(parseChange(compilation, 'modified:TP-1.1.1@android')).toEqual({ modified: '1.1.1@android' })
    expect(parseChange(compilation, 'moved:1.1.2:2.1.2')).toEqual({ moved: { from: '1.1.2', to: '2.1.2' } })
    expect(parseChange(compilation, 'feature:modified')).toEqual({ feature: 'modified' })
    expect(() => parseChange(compilation, 'changed:1.1.1')).toThrow('is not kind:ref')
    expect(() => parseChange(compilation, 'feature:renamed')).toThrow('is not kind:ref')
    expect(() => parseChange(compilation, 'added:QQ-1.1.1')).toThrow('belongs to another product')

    const { read, codes } = apply(FILES, (c) =>
      addChangelogEntry(c, { feature: '1.1', summary: 'Bold on Android.', changes: [{ modified: '1.1.1@android' }], version: '2.1', platforms: ['android'], ticket: 'TP-9', now: NOW }),
    )
    expect(read(FEATURE)).toContain(`changelog:
  - date: "2026-10-16"
    summary: Bold on Android.
    changes:
      - modified: "1.1.1@android"
    version: "2.1"
    platforms: [android]
    ticket: TP-9
  - date: "2026-02-01"`)
    expect(codes).toEqual([])
    expect(() => addChangelogEntry(compilation, { feature: '1.1', summary: 'x', changes: [], now: NOW })).toThrow('At least one change')
  })
})

describe('next-id', () => {
  it('reports the ID add would allocate', () => {
    const { compilation } = open()
    expect(nextId(compilation).id).toBe('3')
    expect(nextId(compilation, '1').id).toBe('1.2')
    expect(nextId(compilation, 'TP-1.1').id).toBe('1.1.3')
    expect(() => nextId(compilation, '1.1.1')).toThrow('only categories and features have child IDs')
  })

  it('treats the ancestors of any recorded ID as used', () => {
    const files = { ...FILES, [FEATURE]: (BASE[FEATURE] ?? '').replace('    name: Autosave\n', '    name: Autosave\n    formerly: ["1.5.2"]\n') }
    const { compilation } = open(files)
    expect(nextId(compilation, '1').id).toBe('1.6')
  })
})
