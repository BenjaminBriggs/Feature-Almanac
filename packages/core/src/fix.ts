import { join } from 'node:path'
import { applyChanges, changedPaths } from './changes.js'
import { compile, type CompileOptions } from './compile.js'
import { planFormat } from './format.js'
import { MemoryFileSystem, type FileSystem } from './fs.js'
import { loadWorkspace } from './workspace.js'

const MAX_ROUNDS = 5

/**
 * `lint --fix`: formatting, file names and counters, repeated until nothing changes. One fix can
 * enable another (quoting `id: 1.1` makes the file valid, which exposes its missing counter).
 * Returns the root-relative paths touched.
 */
export function fixWorkspace(fs: FileSystem, root: string, options: CompileOptions = {}): string[] {
  const touched = new Set<string>()
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const workspace = loadWorkspace(root, fs)
    const plan = planFormat(workspace, compile(workspace, options).counterFixes)
    if (plan.changes.length === 0) break
    applyChanges(fs, plan.changes)
    for (const path of changedPaths(plan.changes, root)) touched.add(path)
  }
  return [...touched]
}

/** Copies every file under `dir` into memory, for dry runs of multi-step changes. */
export function snapshot(fs: FileSystem, dir: string): MemoryFileSystem {
  const copy = new MemoryFileSystem()
  const walk = (current: string) => {
    for (const name of fs.listDir(current)) {
      const path = join(current, name)
      if (fs.isDirectory(path)) walk(path)
      else {
        const content = fs.readFile(path)
        if (content !== undefined) copy.writeFile(path, content)
      }
    }
  }
  walk(dir)
  return copy
}
