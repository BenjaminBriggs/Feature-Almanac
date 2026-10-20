import { describe, expect, it } from 'vitest'
import { BASE, CONFIG, EDITOR, FEATURE, codes, compileFiles, edit, type Files } from './helpers.js'
import { compileSpecExample } from './spec-example.js'

describe('baseline', () => {
  it('the test almanac lints clean', () => {
    expect(compileFiles().diagnostics).toEqual([])
  })

  it('the §9 worked example lints clean and resolves as specified', () => {
    const compilation = compileSpecExample()
    expect(compilation.diagnostics).toEqual([])
    const feature = compilation.features.get('1.1')?.model
    expect(feature?.ref).toBe('EX-1.1')
    expect(feature?.platforms).toEqual(['ios', 'ipados', 'macos', 'android'])
    const [bold, autosave, preview, handoff, pdf] = feature?.behaviours ?? []
    expect(bold?.variants.map((variant) => variant.ref)).toEqual(['1.1.1@macos', '1.1.1@ios', '1.1.1@android'])
    expect(bold?.resolved.android).toBe(
      'Toggles bold on the selection. With no selection, bold applies to\nnewly typed text.\n\nTriggered from the formatting bar above the keyboard.',
    )
    expect(bold?.source[0]).toEqual({ path: 'Sources/Editor/EditorView.swift', symbol: 'toggleBold' })
    expect(autosave?.gherkin).toEqual([
      {
        steps: [
          { keyword: 'Given', text: 'a note with unsaved edits' },
          { keyword: 'When', text: 'input is idle for 1 second' },
          { keyword: 'Then', text: 'the note is saved without interrupting typing' },
        ],
      },
    ])
    expect(preview?.resolved.ios).toBe('Preview is a separate tab; it re-renders when the tab is shown.')
    expect(handoff?.platforms).toEqual(['ios', 'ipados', 'macos'])
    expect(handoff?.since).toEqual({ ios: '2.0', ipados: '2.0', macos: '2.0' })
    expect(pdf?.status).toEqual({ ios: 'removed', ipados: 'removed', macos: 'removed' })
    expect(feature?.changelog[0]?.ticket).toEqual({ id: 'EX-212', url: 'https://tracker.example/issue/EX-212' })
  })
})

interface Case {
  code: string
  files: Files
  options?: { requireSource?: boolean }
  fixable?: boolean
}

const BAD_PDF = `
  - id: "1.1.3"
    name: Export
    description: Offered Export as PDF from the note menu.
    status: removed
`

const cases: Record<string, Case> = {
  'invalid YAML': { code: 'ALM-E001', files: { ...BASE, [FEATURE]: 'id: "1.1"\nname: [unclosed\n' } },
  'unquoted !exclusion parses as a YAML tag': {
    code: 'ALM-E001',
    files: edit(FEATURE, ['status: shipped\n', 'status: shipped\nplatforms: [!macos]\n']),
  },
  'unknown key': { code: 'ALM-E002', files: edit(FEATURE, ['owner: ben\n', 'owner: ben\ncolour: red\n']) },
  'unknown variant key': { code: 'ALM-E002', files: edit(FEATURE, ['      - platforms: [android]\n', '      - platforms: [android]\n        colour: red\n']) },
  'unquoted feature ID': { code: 'ALM-E003', files: edit(FEATURE, ['id: "1.1"', 'id: 1.1']) },
  'behaviour not under its feature': { code: 'ALM-E004', files: edit(FEATURE, ['id: "1.1.2"', 'id: "1.2.2"'], ['added: "1.1.2"', 'added: "1.2.2"']) },
  'feature not under its category': {
    code: 'ALM-E004',
    files: { ...BASE, [FEATURE]: undefined as never, '02-sync/01-editor.yaml': EDITOR },
  },
  'duplicate ID': { code: 'ALM-E005', files: edit(FEATURE, ['id: "1.1.2"', 'id: "1.1.1"'], ['added: "1.1.2"', 'added: "1.1.1"']) },
  'duplicate against formerly': {
    code: 'ALM-E005',
    files: edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    formerly: ["1.1.1"]\n']),
  },
  'missing required field': { code: 'ALM-E006', files: edit(FEATURE, ['owner: ben\n', '']) },
  'missing counter': { code: 'ALM-E006', files: edit(FEATURE, ['next_behaviour: 3\n', '']), fixable: true },
  'empty changelog': {
    code: 'ALM-E006',
    files: { ...BASE, [FEATURE]: EDITOR.slice(0, EDITOR.indexOf('changelog:')) + 'changelog: []\n' },
  },
  'status not in vocabulary': { code: 'ALM-E007', files: edit(FEATURE, ['status: shipped', 'status: shiped']) },
  'format not allowed': { code: 'ALM-E007', files: edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    format: rst\n']) },
  'depends_on does not resolve': { code: 'ALM-E008', files: edit(FEATURE, ['owner: ben\n', 'owner: ben\ndepends_on: ["9.9"]\n']) },
  'changelog ref does not resolve': { code: 'ALM-E008', files: edit(FEATURE, ['- added: "1.1.2"', '- modified: "1.1.9"']) },
  'changelog variant ref has no such variant': { code: 'ALM-E008', files: edit(FEATURE, ['- added: "1.1.2"', '- added: "1.1.2"\n      - added: "1.1.1@macos"']) },
  'wrong type': { code: 'ALM-E009', files: edit(FEATURE, ['owner: ben\n', 'owner: ben\ntags: [Not A Tag]\n']) },
  'two change kinds in one change': { code: 'ALM-E009', files: edit(FEATURE, ['- added: "1.1.2"', '- added: "1.1.2"\n        modified: "1.1.1"']) },
  'behaviours out of order': {
    code: 'ALM-E010',
    files: edit(FEATURE, ['id: "1.1.1"', 'id: "1.1.X"'], ['id: "1.1.2"', 'id: "1.1.1"'], ['id: "1.1.X"', 'id: "1.1.2"'], ['added: "1.1.2"', 'added: "1.1.1"'], ['added: "1.1.1"\n', 'added: "1.1.2"\n']),
    fixable: true,
  },
  'removed without reason': { code: 'ALM-E011', files: edit(FEATURE, ['next_behaviour: 3', 'next_behaviour: 4'], ['\nchangelog:', `${BAD_PDF}\nchangelog:`], ['- added: "1.1.2"', '- added: "1.1.2"\n      - added: "1.1.3"']) },
  'counter behind used IDs': { code: 'ALM-E012', files: edit(FEATURE, ['next_behaviour: 3', 'next_behaviour: 2']), fixable: true },
  'counter behind a former ID held elsewhere': {
    code: 'ALM-E012',
    files: {
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
    formerly: ["1.1.7"]
changelog:
  - date: "2026-01-01"
    summary: Initial release.
    changes:
      - feature: added
      - added: "2.1.1"
`,
    },
    fixable: true,
  },
  'rejected review without a note': {
    code: 'ALM-E014',
    files: edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    review:\n      state: rejected\n      by: Sam Price\n      date: "2026-10-20"\n      hash: "0000abcd"\n']),
  },
  'removed category with live features': {
    code: 'ALM-E013',
    files: edit('01-editing/category.yaml', ['next_feature: 2', 'status: removed\nremoved_reason: Merged into Sync\nnext_feature: 2']),
  },
  'behaviour platforms outside feature': {
    code: 'ALM-E030',
    files: edit(FEATURE, ['status: shipped\n', 'status: shipped\nplatforms: [ios, android]\n'], ['    name: Autosave\n', '    name: Autosave\n    platforms: [macos]\n']),
  },
  'variant platforms outside behaviour': {
    code: 'ALM-E031',
    files: edit(FEATURE, ['    name: Bold\n', '    name: Bold\n    platforms: [ios]\n']),
  },
  'overlapping variants': {
    code: 'ALM-E032',
    files: edit(FEATURE, ['        description: Triggered from the formatting bar above the keyboard.\n', '        description: Triggered from the formatting bar above the keyboard.\n      - platforms: [android, ios]\n        description: Overlaps the Android variant on purpose.\n']),
  },
  'incomplete feature status map': { code: 'ALM-E033', files: edit(FEATURE, ['status: shipped', 'status: { ios: shipped, android: planned }']) },
  'status key outside behaviour platforms': {
    code: 'ALM-E033',
    files: edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    platforms: [ios]\n    status: { android: planned }\n']),
  },
  'unknown platform': { code: 'ALM-E034', files: edit(FEATURE, ['status: shipped\n', 'status: shipped\nplatforms: [windows]\n']) },
  'changelog not newest first': { code: 'ALM-E040', files: edit(FEATURE, ['date: "2026-02-01"', 'date: "2025-02-01"']) },
  'changelog entry without changes': {
    code: 'ALM-E040',
    files: edit(FEATURE, ['    summary: Autosave.\n    changes:\n      - added: "1.1.2"\n', '    summary: Autosave.\n    changes: []\n']),
  },
  'file name does not match': { code: 'ALM-W001', files: { ...BASE, [FEATURE]: undefined as never, '01-editing/07-wrong.yaml': EDITOR }, fixable: true },
  'owner not in registry': { code: 'ALM-W010', files: { ...BASE, 'almanac.yaml': `${CONFIG}owners:\n  mobile: { name: Mobile team }\n` } },
  'no source with --require-source': { code: 'ALM-W011', files: BASE, options: { requireSource: true } },
  'behaviour never added': { code: 'ALM-W012', files: edit(FEATURE, ['- added: "1.1.2"', '- modified: "1.1.2"']) },
  'source path missing': {
    code: 'ALM-W013',
    files: edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    source: [Sources/Missing.swift]\n']),
  },
  'too many behaviours': { code: 'ALM-W014', files: { ...BASE, 'almanac.yaml': `${CONFIG}lint:\n  max_behaviours_per_feature: 1\n` } },
  'gherkin that does not parse': { code: 'ALM-W015', files: edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    format: gherkin\n']) },
  'short description': { code: 'ALM-W016', files: edit(FEATURE, ['Saves the note after one second of idle input.', 'Saves.']) },
  'feature without behaviours': {
    code: 'ALM-W017',
    files: {
      ...BASE,
      [FEATURE]: `id: "1.1"
name: Editor
description: Rich editing of notes with live preview.
owner: ben
status: planned
next_behaviour: 1
behaviours: []
changelog:
  - date: "2026-01-01"
    summary: Added Editor.
    changes:
      - feature: added
`,
    },
  },
  'status overridden by removed feature': {
    code: 'ALM-W018',
    files: edit(FEATURE, ['status: shipped\n', 'status: removed\nremoved_reason: Replaced by the new editor\n'], ['    name: Autosave\n', '    name: Autosave\n    status: shipped\n']),
  },
}

describe('lint rules', () => {
  for (const [name, testCase] of Object.entries(cases)) {
    it(`${testCase.code}: ${name}`, () => {
      const files = Object.fromEntries(Object.entries(testCase.files).filter(([, content]) => content !== undefined))
      if (testCase.code === 'ALM-W013') files['almanac.yaml'] = `${CONFIG}code:\n  path: .\n`
      const compilation = compileFiles(files, testCase.options ?? {})
      expect(codes(compilation)).toContain(testCase.code)
      const diagnostic = compilation.diagnostics.find((d) => d.code === testCase.code)
      expect(diagnostic?.file).toBeTruthy()
      if (testCase.fixable !== undefined) expect(diagnostic?.fixable).toBe(testCase.fixable)
    })
  }

  it('diagnostics carry the JSON path and line', () => {
    const compilation = compileFiles(edit(FEATURE, ['    name: Autosave\n', '    name: Autosave\n    platforms: [windows]\n']))
    expect(compilation.diagnostics).toEqual([
      {
        code: 'ALM-E034',
        severity: 'error',
        message: 'Unknown platform or group "windows"',
        id: '1.1.2',
        file: FEATURE,
        path: 'behaviours[1].platforms[0]',
        line: 18,
        fixable: false,
      },
    ])
  })

  it('require_owner raises ALM-W010 to an error', () => {
    const compilation = compileFiles({ ...BASE, 'almanac.yaml': `${CONFIG}owners:\n  mobile: { name: Mobile team }\nlint:\n  require_owner: error\n` })
    expect(compilation.diagnostics.find((d) => d.code === 'ALM-W010')?.severity).toBe('error')
  })

  it('a file that fails validation still reserves its IDs', () => {
    const compilation = compileFiles(edit(FEATURE, ['owner: ben\n', 'owner: ben\ncolour: red\n']))
    expect(compilation.features.has('1.1')).toBe(false)
    expect([...compilation.usedIds]).toEqual(expect.arrayContaining(['1.1', '1.1.1', '1.1.2']))
  })
})
