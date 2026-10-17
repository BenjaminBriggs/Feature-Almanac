import { relative, sep } from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { OverlayFileSystem, type FileSystem, type MemoryFileSystem } from './fs.js'

export type FileChange =
  /** `previous` is the content the change was computed from; undefined for a new file. */
  | { kind: 'write'; path: string; content: string; previous?: string }
  /** Moves a file, or a directory with everything in it. */
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'remove'; path: string; previous: string }

/** Exit code 4: a file changed since it was read, or a rename target exists. */
export class WriteConflictError extends Error {}

/**
 * Applies changes in order, all or nothing: every precondition is checked first, against the
 * state the earlier changes leave, and any failure part-way undoes what was already applied.
 */
export function applyChanges(fs: FileSystem, changes: readonly FileChange[]): void {
  const preview = new OverlayFileSystem(fs)
  for (const change of changes) {
    if (change.kind === 'rename') {
      if (preview.exists(change.from) === false) throw new WriteConflictError(`${change.from} no longer exists`)
      if (preview.exists(change.to)) throw new WriteConflictError(`${change.to} already exists`)
    } else if (preview.readFile(change.path) !== change.previous) {
      throw new WriteConflictError(`${change.path} changed since it was read`)
    }
    perform(preview, change)
  }
  const undo: (() => void)[] = []
  try {
    for (const change of changes) {
      if (change.kind === 'write') {
        const previous = fs.readFile(change.path)
        fs.writeFile(change.path, change.content)
        undo.push(() => (previous === undefined ? fs.remove(change.path) : fs.writeFile(change.path, previous)))
      } else if (change.kind === 'remove') {
        fs.remove(change.path)
        undo.push(() => fs.writeFile(change.path, change.previous))
      } else {
        if (fs.exists(change.to)) throw new WriteConflictError(`${change.to} already exists`)
        fs.rename(change.from, change.to)
        undo.push(() => fs.rename(change.to, change.from))
      }
    }
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        step()
      } catch {
        // Keep undoing the remaining steps; the original error is what gets reported.
      }
    }
    throw error
  }
}

function perform(fs: FileSystem, change: FileChange): void {
  if (change.kind === 'write') fs.writeFile(change.path, change.content)
  else if (change.kind === 'remove') fs.remove(change.path)
  else fs.rename(change.from, change.to)
}

/** Unified diff for `--dry-run`, with paths relative to `base`. */
export function renderDiff(changes: readonly FileChange[], base: string): string {
  const display = (path: string) => relative(base, path).split(sep).join('/')
  return changes
    .map((change) => {
      if (change.kind === 'rename') return `rename ${display(change.from)} → ${display(change.to)}\n`
      const name = display(change.path)
      return createTwoFilesPatch(
        change.previous === undefined ? '/dev/null' : `a/${name}`,
        change.kind === 'remove' ? '/dev/null' : `b/${name}`,
        change.previous ?? '',
        change.kind === 'remove' ? '' : change.content,
        undefined,
        undefined,
        { context: 3 },
      ).replace(/^=+\n/, '')
    })
    .join('')
}

/** Unified diff between two in-memory trees, e.g. a snapshot before and after `lint --fix`. */
export function diffSnapshots(before: MemoryFileSystem, after: MemoryFileSystem, base: string): string {
  const display = (path: string) => relative(base, path).split(sep).join('/')
  const paths = [...new Set([...before.files.keys(), ...after.files.keys()])].sort()
  return paths
    .map((path) => {
      const old = before.files.get(path)
      const now = after.files.get(path)
      if (old === now) return ''
      const name = display(path)
      return createTwoFilesPatch(old === undefined ? '/dev/null' : `a/${name}`, now === undefined ? '/dev/null' : `b/${name}`, old ?? '', now ?? '').replace(
        /^=+\n/,
        '',
      )
    })
    .join('')
}

export function changedPaths(changes: readonly FileChange[], base: string): string[] {
  const display = (path: string) => relative(base, path).split(sep).join('/')
  return changes.map((change) => (change.kind === 'rename' ? display(change.to) : display(change.path)))
}
