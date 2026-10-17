import { describe, expect, it } from 'vitest'
import { affectedBy, parseChangedFiles, type ChangedFile } from '@feature-almanac/core'
import { compileSpecExample } from './spec-example.js'

function model() {
  const compiled = compileSpecExample().model
  if (compiled === undefined) throw new Error('the spec example failed to compile')
  return compiled
}

describe('affectedBy', () => {
  const files: ChangedFile[] = [
    { path: 'Sources/Editor/Autosave.swift', status: 'modified' },
    { path: 'Sources/Continuity/Handoff.swift', status: 'renamed', from: 'Sources/Continuity/HandoffActivity.swift' },
    { path: 'app/editor/FormatActions.kt', status: 'modified' },
    { path: 'Sources/Settings/Theme.swift', status: 'added' },
    { path: 'README.md', status: 'modified' },
  ]

  it('finds behaviours by their own and their variants’ sources, and features by their code', () => {
    const result = affectedBy(model(), files)
    expect(result.features.map((feature) => feature.id)).toEqual(['1.1'])
    const [editor] = result.features
    expect(editor?.behaviours.map((behaviour) => behaviour.id)).toEqual(['1.1.1', '1.1.2', '1.1.4'])
    expect(editor?.behaviours[0]?.citations).toEqual([{ entry: 'app/editor/FormatActions.kt', file: files[2], variant: 'EX-1.1.1@android' }])
    // A renamed file still counts against the old path the behaviour cites, flagged as stale.
    expect(editor?.behaviours[2]?.citations[0]).toEqual({ entry: 'Sources/Continuity/HandoffActivity.swift', file: files[1], stale: true })
    expect(editor?.code).toEqual([{ entry: 'Sources/Editor/', file: files[0] }])
    expect(result.uncited.map((file) => file.path)).toEqual(['Sources/Settings/Theme.swift', 'README.md'])
  })

  it('matches globs, and leaves removed entities out', () => {
    const changed = structuredClone(model())
    const feature = changed.categories[1]?.features[0]
    if (feature === undefined) throw new Error('no 2.1')
    feature.code = ['Sources/**/Theme*.swift']
    expect(affectedBy(changed, files).features.map((item) => item.id)).toEqual(['1.1', '2.1'])
    feature.status = Object.fromEntries(Object.keys(feature.status).map((platform) => [platform, 'removed']))
    expect(affectedBy(changed, files).features.map((item) => item.id)).toEqual(['1.1'])
  })

  it('reports nothing for a change no source names', () => {
    expect(affectedBy(model(), [{ path: 'docs/notes.md', status: 'modified' }])).toEqual({ features: [], uncited: [{ path: 'docs/notes.md', status: 'modified' }] })
  })
})

describe('parseChangedFiles', () => {
  it('reads git name-status output and plain path lists', () => {
    expect(parseChangedFiles('M\ta.swift\nA\tb.swift\nD\tc.swift\nR087\told.swift\tnew.swift\nC100\tx.swift\ty.swift\n')).toEqual([
      { path: 'a.swift', status: 'modified' },
      { path: 'b.swift', status: 'added' },
      { path: 'c.swift', status: 'deleted' },
      { path: 'new.swift', status: 'renamed', from: 'old.swift' },
      { path: 'y.swift', status: 'added' },
    ])
    expect(parseChangedFiles('Sources/A.swift\r\n\nSources/B.swift\n')).toEqual([
      { path: 'Sources/A.swift', status: 'modified' },
      { path: 'Sources/B.swift', status: 'modified' },
    ])
  })
})
