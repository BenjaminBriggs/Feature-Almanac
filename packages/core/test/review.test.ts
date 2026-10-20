import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { commitChanges, compile, listEntities, loadWorkspace, parsePatch, planPatch, reviewHash, type Compilation } from '@feature-almanac/core'
import { BASE, FEATURE, ROOT, memoryFs } from './helpers.js'

const NOW = new Date('2026-10-20T12:00:00Z')

function open() {
  const fs = memoryFs(BASE)
  return { fs, compilation: compile(loadWorkspace(ROOT, fs), { now: NOW }) }
}

function hashOf(compilation: Compilation, id: string): string {
  return compilation.behaviours.get(id)?.model.hash ?? ''
}

function review(ops: Record<string, unknown>[]) {
  return parsePatch({ almanac: 1, changelog: 'none', ops: ops.map((op) => ({ op: 'review', by: 'Sam Price', ...op })) })
}

describe('reviewHash', () => {
  it('covers the name, description and variants, ignoring trailing space', () => {
    const base = { name: 'Autosave', description: 'Saves the note.', variants: [] }
    expect(reviewHash(base)).toMatch(/^[0-9a-f]{8}$/)
    expect(reviewHash({ ...base, description: 'Saves the note.  \n' })).toBe(reviewHash(base))
    expect(reviewHash({ ...base, description: 'Saves the note later.' })).not.toBe(reviewHash(base))
    expect(reviewHash({ ...base, name: 'Saving' })).not.toBe(reviewHash(base))
    expect(reviewHash({ ...base, variants: [{ platforms: ['android'], mode: 'append', description: 'Also on Android.' }] })).not.toBe(reviewHash(base))
  })
})

describe('review ops', () => {
  it('record approvals and rejections without a changelog entry, and skip a verdict on changed text', () => {
    const { fs, compilation } = open()
    const before = fs.readFile(join(ROOT, FEATURE)) ?? ''
    const plan = planPatch(
      compilation,
      review([
        { ref: 'TP-1.1.1', state: 'approved', date: '2026-10-19', hash: hashOf(compilation, '1.1.1') },
        { ref: '1.1.2', state: 'rejected', note: 'It should save on every change.', hash: hashOf(compilation, '1.1.2') },
        { ref: '1.1.2', state: 'approved', hash: '00000000' },
      ]),
      NOW,
    )
    expect(plan.skipped).toEqual([{ op: 2, ref: '1.1.2', reason: 'TP-1.1.2 changed after it was reviewed; review it again' }])
    const result = commitChanges(compilation, plan.changes)
    expect(result.introduced).toEqual([])

    const file = fs.readFile(join(ROOT, FEATURE)) ?? ''
    expect(file).toContain(`        description: Triggered from the formatting bar above the keyboard.
    review:
      state: approved
      by: Sam Price
      date: "2026-10-19"
      hash: "${hashOf(compilation, '1.1.1')}"
`)
    expect(file).toContain(`    review:
      state: rejected
      by: Sam Price
      date: "2026-10-20"
      note: It should save on every change.
`)
    expect(file.match(/- date:/g)).toEqual(before.match(/- date:/g))
    expect(result.after.behaviours.get('1.1.1')?.model.review).toEqual({ state: 'approved', by: 'Sam Price', date: '2026-10-19', hash: hashOf(compilation, '1.1.1'), stale: false })
  })

  it('leave the review in place but stale once the behaviour changes', () => {
    const { fs, compilation } = open()
    commitChanges(compilation, planPatch(compilation, review([{ ref: '1.1.2', state: 'approved', hash: hashOf(compilation, '1.1.2') }]), NOW).changes)
    const reviewed = compile(loadWorkspace(ROOT, fs), { now: NOW })
    expect(reviewed.behaviours.get('1.1.2')?.model.review?.stale).toBe(false)
    const edit = parsePatch({ almanac: 1, ops: [{ op: 'describe', ref: '1.1.2', description: 'Saves the note after two seconds of idle input.' }] })
    const result = commitChanges(reviewed, planPatch(reviewed, edit, NOW).changes)
    expect(result.after.behaviours.get('1.1.2')?.model.review).toMatchObject({ state: 'approved', by: 'Sam Price', stale: true })
    const model = result.after.model
    if (model === undefined) throw new Error('no model')
    const ids = (review: 'unreviewed' | 'changed' | 'approved' | 'rejected' | 'needed') => listEntities(model, { review }).map((item) => item.entity.id)
    expect(ids('changed')).toEqual(['1.1.2'])
    expect(ids('approved')).toEqual([])
    expect(ids('unreviewed')).toEqual(['1.1.1'])
    expect(ids('needed')).toEqual(['1.1.1', '1.1.2'])
  })

  it('need a note to reject, and a behaviour to review', () => {
    const { compilation } = open()
    expect(() => planPatch(compilation, review([{ ref: '1.1.2', state: 'rejected', hash: hashOf(compilation, '1.1.2') }]), NOW)).toThrow('a rejection needs a note saying why')
    expect(() => planPatch(compilation, review([{ ref: '1.1', state: 'approved', hash: '00000000' }]), NOW)).toThrow('Only behaviours are reviewed; 1.1 is a feature')
  })
})
