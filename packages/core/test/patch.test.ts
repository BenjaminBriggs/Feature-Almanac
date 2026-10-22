import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commitChanges, compile, loadWorkspace, parsePatch, planPatch } from '@feature-almanac/core'
import { BASE, FEATURE, ROOT, SYNC, memoryFs } from './helpers.js'

const NOW = new Date('2026-10-16T12:00:00Z')

function open(files = BASE) {
  const fs = memoryFs(files)
  return { fs, compilation: compile(loadWorkspace(ROOT, fs), { now: NOW }) }
}

const PATCH = {
  almanac: 1,
  version: '1.0',
  summary: 'Initial almanac.',
  ops: [
    { op: 'add', level: 'category', as: '$search', name: 'Search', description: 'Finding notes by text and tag.' },
    { op: 'add', level: 'feature', parent: '$search', as: '$find', name: 'Find in notes', description: 'Search every note as you type.', owner: 'ben', status: 'shipped' },
    { op: 'add', level: 'behaviour', parent: '$find', as: '$live', name: 'Live results', description: 'Results update with every keystroke.', source: ['Sources/Search.swift'] },
    { op: 'add', level: 'variant', parent: '$live', platforms: ['android'], status: 'in-progress', description: 'Results appear after a short pause.' },
    { op: 'add', level: 'behaviour', parent: '1.1', name: 'Italic formatting', description: 'Toggles italic on the selection or on new text.' },
  ],
}

describe('apply', () => {
  it('allocates IDs in order, resolves placeholders and writes one changelog entry per feature', () => {
    const { fs, compilation } = open()
    const plan = planPatch(compilation, parsePatch(PATCH), NOW)
    expect(plan.created.map((item) => [item.level, item.id, item.as])).toEqual([
      ['category', '3', '$search'],
      ['feature', '3.1', '$find'],
      ['behaviour', '3.1.1', '$live'],
      ['variant', '3.1.1@android', undefined],
      ['behaviour', '1.1.3', undefined],
    ])
    const result = commitChanges(compilation, plan.changes)
    expect(result.introduced).toEqual([])
    expect(result.applied).toBe(true)
    expect(result.after.diagnostics.map((d) => d.code)).toEqual([])

    expect(fs.readFile(join(ROOT, '03-search/01-find-in-notes.yaml'))).toContain(`changelog:
  - date: "2026-10-16"
    summary: Initial almanac.
    changes:
      - feature: added
      - added: "3.1.1"
      - added: "3.1.1@android"
    version: "1.0"
`)
    const editor = fs.readFile(join(ROOT, '01-editing/01-editor.yaml')) ?? ''
    expect(editor).toContain('next_behaviour: 4')
    expect(editor.indexOf('summary: Initial almanac.')).toBeLessThan(editor.indexOf('summary: Autosave.'))
  })

  it('writes nothing when the result would have new errors', () => {
    const { fs, compilation } = open()
    const before = new Map(fs.files)
    const bad = { almanac: 1, ops: [{ op: 'add', level: 'variant', parent: '1.1.1', platforms: ['android'], description: 'A second Android variant on purpose.' }] }
    const result = commitChanges(compilation, planPatch(compilation, parsePatch(bad), NOW).changes)
    expect(result.introduced.map((d) => d.code)).toEqual(['ALM-E032'])
    expect(fs.files).toEqual(before)
  })

  it('rejects unknown placeholders, unsupported ops and malformed patches', () => {
    const { compilation } = open()
    expect(() => planPatch(compilation, parsePatch({ almanac: 1, ops: [{ op: 'add', level: 'behaviour', parent: '$nope', name: 'X', description: 'Y' }] }), NOW)).toThrow(
      '$nope is not defined',
    )
    expect(() => planPatch(compilation, parsePatch({ almanac: 1, ops: [{ op: 'delete', ref: '1.1.1' }] }), NOW)).toThrow('unknown op "delete"; expected one of add, set')
    expect(() => planPatch(compilation, parsePatch({ almanac: 1, ops: [{ op: 'remove', ref: '1.1.1' }] }), NOW)).toThrow('ops[0].reason')
    expect(() => planPatch(compilation, parsePatch({ almanac: 1, ops: [{ op: 'remove', ref: '1.1.1', reason: 'Gone.', extra: 1 }] }), NOW)).toThrow(
      'ops[0]: Unrecognized key: "extra"',
    )
    expect(() => planPatch(compilation, parsePatch({ almanac: 1, ops: [{ op: 'describe', ref: '1.1.1', description: 'a', overview: 'b' }] }), NOW)).toThrow(
      'needs exactly one of description and overview',
    )
    expect(() => planPatch(compilation, parsePatch({ almanac: 1, ops: [{ op: 'add', level: 'feature', parent: '1', name: 'X', description: 'Y' }] }), NOW)).toThrow(
      '"owner" is required',
    )
    expect(() => parsePatch({ almanac: 2, ops: [] })).toThrow('Invalid patch')
  })

  it('supports explicit changelog entries', () => {
    const { fs, compilation } = open()
    const patch = parsePatch({
      almanac: 1,
      ops: [{ op: 'add', level: 'behaviour', parent: '1.1', name: 'Italic formatting', description: 'Toggles italic on the selection or on new text.' }],
      changelog: [{ feature: '1.1', summary: 'Italic, as asked in PD-300.', ticket: 'PD-300', changes: [{ added: '1.1.3' }] }],
    })
    expect(commitChanges(compilation, planPatch(compilation, patch, NOW).changes).applied).toBe(true)
    expect(fs.readFile(join(ROOT, '01-editing/01-editor.yaml'))).toContain('summary: Italic, as asked in PD-300.')
  })
})

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

const WITH_SYNC = { ...BASE, '02-sync/category.yaml': SYNC.replace('next_feature: 1', 'next_feature: 2'), '02-sync/01-cloud-sync.yaml': CLOUD }

describe('apply edit ops', () => {
  it('runs set, describe, rename, remove and move in order with one changelog entry per feature', () => {
    const { fs, compilation } = open(WITH_SYNC)
    const patch = parsePatch({
      almanac: 1,
      ticket: 'TP-7',
      ops: [
        { op: 'add', level: 'behaviour', parent: '1.1', as: '$italic', name: 'Italic', description: 'Toggles italic on the selection or on new text.' },
        { op: 'set', ref: '$italic', values: { tags: ['formatting'], 'status.android': 'planned' } },
        { op: 'describe', ref: '1.1.1', description: 'Toggles bold on the selection, or on text typed next.' },
        { op: 'rename', ref: '1.1.2', name: 'Autosave on idle' },
        { op: 'move', ref: '1.1.2', to: '2.1' },
        { op: 'remove', ref: '1.1.1@android', reason: 'The formatting bar is gone.' },
      ],
    })
    const plan = planPatch(compilation, patch, NOW)
    expect(plan.created.map((item) => item.id)).toEqual(['1.1.3'])
    expect(plan.edits).toEqual([
      { op: 1, kind: 'set', id: '1.1.3' },
      { op: 2, kind: 'describe', id: '1.1.1' },
      { op: 3, kind: 'rename', id: '1.1.2' },
      { op: 4, kind: 'move', id: '2.1.2', from: '1.1.2' },
      { op: 5, kind: 'remove', id: '1.1.1@android' },
    ])
    const result = commitChanges(compilation, plan.changes)
    expect(result.introduced).toEqual([])
    expect(result.after.diagnostics.map((d) => d.code)).toEqual([])

    const editor = fs.readFile(join(ROOT, FEATURE)) ?? ''
    expect(editor).toContain(`changelog:
  - date: "2026-10-16"
    summary: Added Italic. Set tags → formatting; status.android → planned on Italic. Updated the description of Bold. Renamed Autosave to Autosave on idle. Moved Autosave on idle to Cloud sync. Removed Bold (Android).
    changes:
      - added: "1.1.3"
      - modified: "1.1.3"
      - modified: "1.1.1"
      - modified: "1.1.2"
      - moved:
          from: "1.1.2"
          to: "2.1.2"
      - removed: "1.1.1@android"
        detail: The formatting bar is gone.
    ticket: TP-7
  - date: "2026-02-01"`)
    const cloud = fs.readFile(join(ROOT, '02-sync/01-cloud-sync.yaml')) ?? ''
    expect(cloud).toContain('    name: Autosave on idle\n')
    expect(cloud).toContain('    summary: Moved Autosave on idle from Editor.\n')
  })

  it('writes the changelog of a feature moved during the patch under its new ID', () => {
    const { fs, compilation } = open(WITH_SYNC)
    const patch = parsePatch({
      almanac: 1,
      summary: 'Editing joins Sync.',
      ops: [
        { op: 'set', ref: '1.1', values: { tags: 'core' } },
        { op: 'move', ref: '1.1', to: '2' },
        { op: 'rename', ref: '1.1', name: 'Note editor' },
      ],
    })
    const result = commitChanges(compilation, planPatch(compilation, patch, NOW).changes)
    expect(result.introduced).toEqual([])
    expect(fs.readFile(join(ROOT, FEATURE))).toBeUndefined()
    const moved = fs.readFile(join(ROOT, '02-sync/02-note-editor.yaml')) ?? ''
    expect(moved).toContain(`  - date: "2026-10-16"
    summary: Editing joins Sync.
    changes:
      - feature: modified
      - moved:
          from: "1.1"
          to: "2.2"
  - date:`)
    expect(moved.match(/date: "2026-10-16"/g)).toHaveLength(1)
    expect(fs.readFile(join(ROOT, '02-sync/01-cloud-sync.yaml'))).toContain('related: ["2.2"]')
  })
})
