import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyChanges, formatDocument, loadWorkspace, parseYaml, planFormat, serialize, slugify, padNumber } from '@feature-almanac/core'
import { BASE, EDITOR, FEATURE, ROOT, compileFiles, memoryFs } from './helpers.js'

function format(text: string): string {
  const { doc } = parseYaml(text)
  formatDocument(doc, 'feature')
  return serialize(doc)
}

const MESSY = `# header comment
name: Editor
id: 1.10
owner: ben
description: |
  Rich editing of notes with live preview.
status: shipped
next_behaviour: 3
since: 2.0
changelog:
  - summary: Initial release.
    date: 2026-01-01
    changes:
      - added: "1.10.2"
      - added: 1.10.1
behaviours:
  # Autosave comes second
  - id: "1.10.2"
    description: "Saves the note after one second of idle input."
    name: Autosave
  - name: Bold
    id: "1.10.1"
    description: >
      Toggles bold on the selection
      or on new text.
`

describe('formatDocument', () => {
  it('normalises key order, quoting, block scalars and behaviour order, keeping comments', () => {
    expect(format(MESSY)).toBe(`# header comment
id: "1.10"
name: Editor
description: Rich editing of notes with live preview.
owner: ben
status: shipped
since: "2.0"
next_behaviour: 3

behaviours:
  - id: "1.10.1"
    name: Bold
    description: Toggles bold on the selection or on new text.

  # Autosave comes second
  - id: "1.10.2"
    name: Autosave
    description: Saves the note after one second of idle input.

changelog:
  - date: "2026-01-01"
    summary: Initial release.
    changes:
      - added: "1.10.2"
      - added: "1.10.1"
`)
  })

  it('is idempotent', () => {
    const once = format(MESSY)
    expect(format(once)).toBe(once)
  })

  it('keeps quotes where YAML needs them', () => {
    const text = format('id: "1.1"\nname: "Editor: beta"\nplatforms: ["!macos"]\ndescription: "yes"\n')
    expect(text).toContain('name: "Editor: beta"')
    expect(text).toContain('platforms: ["!macos"]')
    expect(text).toContain('description: "yes"')
    expect(parseYaml(text).problems).toEqual([])
  })

  it('writes one line ending in a line break as plain text, so a second pass changes nothing', () => {
    const once = format('id: "1.1"\ndescription: "one line\\n"\n')
    expect(once).toBe('id: "1.1"\ndescription: one line\n')
    expect(format(once)).toBe(once)
  })

  it('writes multi-line text as a literal block', () => {
    expect(format('id: "1.1"\ndescription: "line one\\nline two"\n')).toBe('id: "1.1"\ndescription: |\n  line one\n  line two\n')
  })
})

describe('planFormat', () => {
  it('renames files and folders to match their ID and name', () => {
    const fs = memoryFs({ ...BASE, [FEATURE]: undefined as never, '01-editing/1-editor.yaml': EDITOR, '01-editing/category.yaml': BASE['01-editing/category.yaml']!.replace('Editing', 'Writing') })
    fs.remove(join(ROOT, FEATURE))
    const workspace = loadWorkspace(ROOT, fs)
    const plan = planFormat(workspace)
    expect(plan.changes.filter((change) => change.kind === 'rename')).toEqual([
      { kind: 'rename', from: join(ROOT, '01-editing/1-editor.yaml'), to: join(ROOT, '01-editing/01-editor.yaml') },
      { kind: 'rename', from: join(ROOT, '01-editing'), to: join(ROOT, '01-writing') },
    ])
    applyChanges(fs, plan.changes)
    expect(fs.exists(join(ROOT, '01-writing/01-editor.yaml'))).toBe(true)
  })

  it('leaves files that do not parse alone', () => {
    const fs = memoryFs({ ...BASE, [FEATURE]: 'id: [unclosed\n' })
    const plan = planFormat(loadWorkspace(ROOT, fs))
    expect(plan.skipped).toEqual([FEATURE])
    expect(plan.changes.some((change) => change.kind === 'write' && change.path.endsWith('editor.yaml'))).toBe(false)
  })

  it('formatting never changes the compiled model', () => {
    const messy = MESSY.replaceAll('1.10', '1.1').replace('id: 1.1\n', 'id: "1.1"\n').replace('since: 2.0', 'since: "2.0"')
    const files = { ...BASE, [FEATURE]: messy }
    const before = compileFiles(files)
    expect(before.diagnostics.map((d) => d.code)).toEqual(['ALM-E010'])
    const fs = memoryFs(files)
    applyChanges(fs, planFormat(loadWorkspace(ROOT, fs)).changes)
    const after = compileFiles({ ...files, [FEATURE]: fs.readFile(join(ROOT, FEATURE)) ?? '' })
    const withoutLines = (value: unknown) => JSON.parse(JSON.stringify(value, (key, entry) => (key === 'line' ? undefined : entry)))
    expect(after.diagnostics).toEqual([])
    expect(withoutLines(after.model?.categories)).toEqual(withoutLines(before.model?.categories))
  })
})

describe('names', () => {
  it('slugs are ASCII kebab-case, at most 48 characters', () => {
    expect(slugify('Crème brûlée & Co.')).toBe('creme-brulee-co')
    expect(slugify('x'.repeat(60)).length).toBe(48)
    expect(padNumber(7)).toBe('07')
    expect(padNumber(104)).toBe('104')
  })
})
