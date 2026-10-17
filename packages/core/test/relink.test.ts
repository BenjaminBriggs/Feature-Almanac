import { describe, expect, it } from 'vitest'
import { planRelink, type ChangedFile } from '@feature-almanac/core'
import { compileSpecExample } from './spec-example.js'

function model() {
  const compiled = compileSpecExample().model
  if (compiled === undefined) throw new Error('the spec example failed to compile')
  return compiled
}

const moved = (from: string, path: string): ChangedFile => ({ path, status: 'renamed', from })
const editorMove = [
  moved('Sources/Editor/EditorView.swift', 'Sources/Editing/EditorView.swift'),
  moved('Sources/Editor/Autosave.swift', 'Sources/Editing/Autosave.swift'),
  moved('Sources/Editor/PreviewRenderer.swift', 'Sources/Editing/PreviewRenderer.swift'),
  moved('app/editor/FormatActions.kt', 'app/editing/FormatActions.kt'),
]

describe('planRelink', () => {
  it('repoints files, keeping symbols, variants included, and a folder that moved whole', () => {
    const plan = planRelink(model(), editorMove, () => false)
    expect(plan.ops).toEqual([
      { op: 'set', ref: '1.1', values: { code: ['Sources/Editing/'] } },
      { op: 'set', ref: '1.1.1', values: { source: ['Sources/Editing/EditorView.swift#toggleBold'] } },
      { op: 'set', ref: '1.1.1@android', values: { source: ['app/editing/FormatActions.kt'] } },
      { op: 'set', ref: '1.1.2', values: { source: ['Sources/Editing/Autosave.swift'] } },
      { op: 'set', ref: '1.1.3', values: { source: ['Sources/Editing/PreviewRenderer.swift'] } },
    ])
    expect(plan.repoints[1]).toEqual({ ref: 'EX-1.1.1', field: 'source', from: 'Sources/Editor/EditorView.swift#toggleBold', to: 'Sources/Editing/EditorView.swift#toggleBold' })
    expect(plan.repoints[2]?.ref).toBe('EX-1.1.1@android')
    expect(plan.unresolved).toEqual([])
  })

  it('leaves a folder alone when files stay behind or scatter, and reports deletions and globs', () => {
    expect(planRelink(model(), editorMove, () => true).unresolved).toEqual([
      { ref: 'EX-1.1', field: 'code', entry: 'Sources/Editor/', reason: 'only some of its files moved' },
    ])
    const scattered = [moved('Sources/Sync/CloudSync.swift', 'Sources/Cloud/CloudSync.swift'), moved('Sources/Sync/Merge.swift', 'Sources/Merging/Merge.swift')]
    const plan = planRelink(model(), scattered, () => false)
    expect(plan.unresolved).toEqual([{ ref: 'EX-2.1', field: 'code', entry: 'Sources/Sync/', reason: 'its files moved to different places' }])
    expect(plan.ops).toEqual([{ op: 'set', ref: '2.1.1', values: { source: ['Sources/Cloud/CloudSync.swift'] } }])

    expect(planRelink(model(), [{ path: 'Sources/Sync/CloudSync.swift', status: 'deleted' }], () => false).unresolved).toEqual([
      { ref: 'EX-2.1.1', field: 'source', entry: 'Sources/Sync/CloudSync.swift', reason: 'the file was deleted' },
    ])

    const globbed = structuredClone(model())
    const sync = globbed.categories[1]?.features[0]
    if (sync === undefined) throw new Error('no 2.1')
    sync.code = ['Sources/**/*.swift']
    expect(planRelink(globbed, scattered, () => false).unresolved[0]).toMatchObject({ entry: 'Sources/**/*.swift', reason: 'a glob over renamed files; check it by hand' })
  })

  it('does nothing when nothing cited moved', () => {
    expect(planRelink(model(), [moved('docs/a.md', 'docs/b.md'), { path: 'Sources/Editor/Autosave.swift', status: 'modified' }], () => false)).toEqual({ ops: [], repoints: [], unresolved: [] })
  })
})
