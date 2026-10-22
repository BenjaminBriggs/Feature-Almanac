import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  addBehaviour,
  addCategory,
  addFeature,
  addVariant,
  applyChanges,
  commitChanges,
  compile,
  loadWorkspace,
  planFormat,
} from '@feature-almanac/core'
import { BASE, FEATURE, ROOT, codes, compileFiles, edit, memoryFs, type Files } from './helpers.js'

const NOW = new Date('2026-10-16T12:00:00Z')

function open(files: Files = BASE) {
  const fs = memoryFs(files)
  const compilation = compile(loadWorkspace(ROOT, fs), { now: NOW })
  return { fs, compilation }
}

describe('fix 2/3: allocation comes from counters in the parent file', () => {
  it('allocates from the counter, not from the highest ID in the file', () => {
    const { fs, compilation } = open(edit(FEATURE, ['next_behaviour: 3', 'next_behaviour: 6']))
    const mutation = addBehaviour(compilation, { feature: '1.1', name: 'Italic', description: 'Toggles italic on the selection or on new text.', now: NOW })
    expect(mutation.id).toBe('1.1.6')
    expect(commitChanges(compilation, mutation.changes).applied).toBe(true)
    expect(fs.readFile(join(ROOT, FEATURE))).toContain('next_behaviour: 7')
  })

  it('never reuses the number of a hand-deleted behaviour', () => {
    const deleted = edit(
      FEATURE,
      ['  - id: "1.1.2"\n    name: Autosave\n    description: Saves the note after one second of idle input.\n', ''],
      ['  - date: "2026-02-01"\n    summary: Autosave.\n    changes:\n      - added: "1.1.2"\n', ''],
    )
    const { compilation } = open(deleted)
    expect(compilation.diagnostics).toEqual([])
    expect(addBehaviour(compilation, { feature: '1.1', name: 'Italic', description: 'Toggles italic on the selection or on new text.', now: NOW }).id).toBe('1.1.3')
  })

  it('skips IDs held as formerly anywhere, even when the counter is behind', () => {
    const files: Files = {
      ...edit('02-sync/category.yaml', ['next_feature: 1', 'next_feature: 2']),
      '02-sync/01-sync.yaml': `id: "2.1"
name: Sync
description: Edits appear on the other devices within seconds.
owner: ben
status: shipped
next_behaviour: 2
behaviours:
  - id: "2.1.1"
    name: Moved here
    description: Behaviour that used to live in the editor feature.
    formerly: ["1.1.4"]
changelog:
  - date: "2026-01-01"
    summary: Initial release.
    changes:
      - feature: added
      - added: "2.1.1"
`,
    }
    const { compilation } = open(files)
    expect(codes(compilation)).toEqual(['ALM-E012'])
    expect(addBehaviour(compilation, { feature: '1.1', name: 'Italic', description: 'Toggles italic on the selection or on new text.', now: NOW }).id).toBe('1.1.5')
  })

  it('parallel branches adding features both edit the category counter, so git sees a conflict', () => {
    const { compilation } = open()
    const a = addFeature(compilation, { category: '1', name: 'Attachments', description: 'Images and files inside notes.', owner: 'ben', now: NOW })
    const b = addFeature(compilation, { category: '1', name: 'Tables', description: 'Markdown tables with a grid editor.', owner: 'ben', now: NOW })
    const counterLine = (mutation: typeof a) =>
      mutation.changes.find((change) => change.kind === 'write' && change.path.endsWith('category.yaml'))
    expect(a.id).toBe('1.2')
    expect(b.id).toBe('1.2')
    // Same line changed in the same file on both branches: a textual merge conflict, not a silent duplicate.
    expect(counterLine(a)).toEqual(counterLine(b))
  })

  it('lint --fix raises counters that are behind or missing', () => {
    const { fs, compilation } = open(edit(FEATURE, ['next_behaviour: 3\n', '']))
    expect(compilation.counterFixes.map((fix) => [fix.key, fix.value])).toEqual([['next_behaviour', 3]])
    applyChanges(fs, planFormat(compilation.workspace, compilation.counterFixes).changes)
    expect(compile(loadWorkspace(ROOT, fs)).diagnostics).toEqual([])
  })

  it('add category bumps next_category in almanac.yaml', () => {
    const { fs, compilation } = open()
    const mutation = addCategory(compilation, { name: 'Search', description: 'Finding notes by text and tag.' })
    expect(mutation.id).toBe('3')
    expect(commitChanges(compilation, mutation.changes).applied).toBe(true)
    expect(fs.readFile(join(ROOT, 'almanac.yaml'))).toContain('next_category: 4')
    expect(fs.readFile(join(ROOT, '03-search/category.yaml'))).toContain('next_feature: 1')
  })
})

describe('fix 4: features may have no behaviours yet', () => {
  it('add feature writes a file that lints with a warning, not an error', () => {
    const { fs, compilation } = open()
    const mutation = addFeature(compilation, { category: '1', name: 'Attachments', description: 'Images and files inside notes.', owner: 'ben', now: NOW })
    const result = commitChanges(compilation, mutation.changes)
    expect(result.applied).toBe(true)
    expect(codes(result.after)).toEqual(['ALM-W017'])
    expect(fs.readFile(join(ROOT, '01-editing/02-attachments.yaml'))).toBe(`# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/feature.json
id: "1.2"
name: Attachments
description: Images and files inside notes.
owner: ben
status: planned
next_behaviour: 1

behaviours: []

changelog:
  - date: "2026-10-16"
    summary: Added Attachments.
    changes:
      - feature: added
`)
  })

  it('a removed feature with no behaviours does not warn', () => {
    const empty = `id: "1.1"
name: Editor
description: Rich editing of notes with live preview.
owner: ben
status: removed
removed_reason: Never built
next_behaviour: 1
behaviours: []
changelog:
  - date: "2026-01-01"
    summary: Added Editor.
    changes:
      - feature: added
`
    expect(compileFiles({ ...BASE, [FEATURE]: empty }).diagnostics).toEqual([])
  })
})

describe('fix 5: writes are blocked only by errors they introduce', () => {
  it('an existing error elsewhere does not block a write', () => {
    const broken = edit(FEATURE, ['status: shipped', 'status: shiped'])
    const { compilation } = open(broken)
    expect(codes(compilation)).toContain('ALM-E007')
    const mutation = addCategory(compilation, { name: 'Search', description: 'Finding notes by text and tag.' })
    expect(commitChanges(compilation, mutation.changes).applied).toBe(true)
  })

  it('a new error rejects the whole change and writes nothing', () => {
    const { fs, compilation } = open()
    const before = new Map(fs.files)
    const mutation = addVariant(compilation, { behaviour: '1.1.1', platforms: ['android', 'ios'], description: 'Overlaps the Android variant on purpose.', now: NOW })
    const result = commitChanges(compilation, mutation.changes)
    expect(result.applied).toBe(false)
    expect(result.introduced.map((diagnostic) => diagnostic.code)).toEqual(['ALM-E032'])
    expect(fs.files).toEqual(before)
  })

  it('an invalid status passed to add feature is rejected by the same check', () => {
    const { compilation } = open()
    const mutation = addFeature(compilation, { category: '1', name: 'Tables', description: 'Markdown tables with a grid editor.', owner: 'ben', status: 'done', now: NOW })
    expect(commitChanges(compilation, mutation.changes).introduced.map((diagnostic) => diagnostic.code)).toEqual(['ALM-E007'])
  })

  it('dry runs compute the result without writing', () => {
    const { fs, compilation } = open()
    const before = new Map(fs.files)
    const mutation = addCategory(compilation, { name: 'Search', description: 'Finding notes by text and tag.' })
    const result = commitChanges(compilation, mutation.changes, { dryRun: true })
    expect(result.applied).toBe(false)
    expect(result.after.categories.has('3')).toBe(true)
    expect(fs.files).toEqual(before)
  })
})

describe('fix 6: status maps and removal propagation', () => {
  it('a partial behaviour status map falls through to the feature', () => {
    const compilation = compileFiles(edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    status: { android: planned }\n']))
    expect(compilation.diagnostics).toEqual([])
    expect(compilation.behaviours.get('1.1.2')?.model.status).toEqual({ ios: 'shipped', android: 'planned', macos: 'shipped' })
  })

  it('a feature status map must still cover every platform', () => {
    const compilation = compileFiles(edit(FEATURE, ['status: shipped', 'status: { ios: shipped, android: planned }']))
    expect(compilation.diagnostics.map((d) => d.message)).toEqual(['Status map of 1.1 is missing macos'])
  })

  it('a removed feature forces every behaviour and variant to removed', () => {
    const compilation = compileFiles(edit(FEATURE, ['status: shipped\n', 'status: removed\nremoved_reason: Replaced by the new editor\n']))
    expect(compilation.diagnostics).toEqual([])
    const bold = compilation.behaviours.get('1.1.1')?.model
    expect(Object.values(bold?.status ?? {})).toEqual(['removed', 'removed', 'removed'])
    expect(Object.values(compilation.behaviours.get('1.1.2')?.model.status ?? {})).toEqual(['removed', 'removed', 'removed'])
  })

  it('a removed platform needs a reason and only affects that platform', () => {
    const files = edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    status: { android: removed }\n'])
    expect(codes(compileFiles(files))).toEqual(['ALM-E011'])
    const fixed = compileFiles(edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    status: { android: removed }\n    removed_reason: Android has system autosave\n']))
    expect(fixed.diagnostics).toEqual([])
    expect(fixed.behaviours.get('1.1.2')?.model.status).toEqual({ ios: 'shipped', android: 'removed', macos: 'shipped' })
  })

  it('a removed category forces its features to removed in the model', () => {
    const compilation = compileFiles(edit('01-editing/category.yaml', ['next_feature: 2', 'status: removed\nremoved_reason: Merged into Sync\nnext_feature: 2']))
    expect(Object.values(compilation.features.get('1.1')?.model.status ?? {})).toEqual(['removed', 'removed', 'removed'])
  })
})

describe('fix 7: variants have a lifecycle', () => {
  const tombstone = edit(
    FEATURE,
    ['        description: Triggered from the formatting bar above the keyboard.\n', '        description: Triggered from the formatting bar above the keyboard.\n        status: removed\n        removed_reason: Android uses the system toolbar\n'],
    ['  - date: "2026-02-01"', '  - date: "2026-03-01"\n    summary: Dropped the Android bar.\n    changes:\n      - removed: "1.1.1@android"\n  - date: "2026-02-01"'],
  )

  it('a variant can be tombstoned and still be referenced by the changelog', () => {
    const compilation = compileFiles(tombstone)
    expect(compilation.diagnostics).toEqual([])
    const bold = compilation.behaviours.get('1.1.1')?.model
    expect(bold?.variants[0]?.removedReason).toBe('Android uses the system toolbar')
    expect(bold?.status.android).toBe('removed')
    expect(bold?.status.ios).toBe('shipped')
  })

  it('a removed variant needs a reason', () => {
    const files = edit(FEATURE, ['        description: Triggered from the formatting bar above the keyboard.\n', '        description: Triggered from the formatting bar above the keyboard.\n        status: removed\n'])
    expect(codes(compileFiles(files))).toEqual(['ALM-E011'])
  })

  it('a variant ref names its first platform in config order', () => {
    const compilation = compileFiles(edit(FEATURE, ['      - platforms: [android]', '      - platforms: [macos, android]'], ['added: "1.1.1"', 'added: "1.1.1"']))
    expect(compilation.behaviours.get('1.1.1')?.model.variants[0]?.ref).toBe('1.1.1@android')
    const { compilation: base } = open()
    expect(addVariant(base, { behaviour: '1.1.1', platforms: ['apple'], description: 'Triggered with ⌘B on Apple keyboards.', now: NOW }).id).toBe('1.1.1@ios')
  })

  it('a new variant needs known platforms, rather than covering them all', () => {
    const { compilation } = open()
    const add = (platforms: string[]) => () => addVariant(compilation, { behaviour: '1.1.1', platforms, description: 'Shown on a platform nobody has.', now: NOW })
    expect(add(['windows', 'ios'])).toThrow('Unknown platform or group "windows"; known: ios, android, macos, apple')
    expect(add([])).toThrow('A variant needs at least one platform')
  })
})
