import { describe, expect, it } from 'vitest'
import { MemoryFileSystem, OverlayFileSystem, WriteConflictError, applyChanges, renderDiff } from '@feature-almanac/core'

function base() {
  return new MemoryFileSystem({ '/r/a/one.yaml': '1', '/r/a/two.yaml': '2', '/r/b.yaml': 'b' })
}

describe('OverlayFileSystem', () => {
  it('renames files and folders and removes files without touching the base', () => {
    const fs = base()
    const overlay = new OverlayFileSystem(fs)
    overlay.rename('/r/a', '/r/c')
    overlay.remove('/r/b.yaml')
    expect(overlay.listDir('/r').sort()).toEqual(['c'])
    expect(overlay.listDir('/r/c').sort()).toEqual(['one.yaml', 'two.yaml'])
    expect(overlay.readFile('/r/c/one.yaml')).toBe('1')
    expect(overlay.readFile('/r/a/one.yaml')).toBeUndefined()
    expect(overlay.exists('/r/a')).toBe(false)
    expect(overlay.exists('/r/b.yaml')).toBe(false)
    expect(fs.files.size).toBe(3)

    overlay.writeFile('/r/a/new.yaml', 'n')
    expect(overlay.listDir('/r/a')).toEqual(['new.yaml'])
  })

  it('replays its changes in order, merging repeated writes to one file', () => {
    const overlay = new OverlayFileSystem(base())
    overlay.writeFile('/r/b.yaml', 'b1')
    overlay.writeFile('/r/b.yaml', 'b2')
    overlay.rename('/r/a/one.yaml', '/r/a/uno.yaml')
    overlay.writeFile('/r/a/uno.yaml', '1!')
    expect(overlay.changes()).toEqual([
      { kind: 'write', path: '/r/b.yaml', content: 'b2', previous: 'b' },
      { kind: 'rename', from: '/r/a/one.yaml', to: '/r/a/uno.yaml' },
      { kind: 'write', path: '/r/a/uno.yaml', content: '1!', previous: '1' },
    ])
  })
})

describe('applyChanges', () => {
  it('checks each change against the state the earlier ones leave', () => {
    const fs = base()
    const changes = [
      { kind: 'rename', from: '/r/a/one.yaml', to: '/r/a/uno.yaml' },
      { kind: 'write', path: '/r/a/uno.yaml', content: '1!', previous: '1' },
      { kind: 'remove', path: '/r/b.yaml', previous: 'b' },
    ] as const
    expect(renderDiff(changes, '/r')).toContain('rename a/one.yaml → a/uno.yaml\n')
    expect(renderDiff(changes, '/r')).toContain('+++ /dev/null')
    applyChanges(fs, changes)
    expect([...fs.files.entries()].sort()).toEqual([
      ['/r/a/two.yaml', '2'],
      ['/r/a/uno.yaml', '1!'],
    ])
  })

  it('changes nothing when a precondition fails', () => {
    const fs = base()
    const before = new Map(fs.files)
    expect(() =>
      applyChanges(fs, [
        { kind: 'write', path: '/r/b.yaml', content: 'b!', previous: 'b' },
        { kind: 'rename', from: '/r/a/one.yaml', to: '/r/a/two.yaml' },
      ]),
    ).toThrow(WriteConflictError)
    expect(() => applyChanges(fs, [{ kind: 'remove', path: '/r/b.yaml', previous: 'stale' }])).toThrow('changed since it was read')
    expect(fs.files).toEqual(before)
  })
})
