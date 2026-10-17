import type { Diagnostic } from '@feature-almanac/schema'
import { applyChanges, type FileChange } from './changes.js'
import { compile, type Compilation, type CompileOptions } from './compile.js'
import { OverlayFileSystem } from './fs.js'
import { loadWorkspace } from './workspace.js'

export interface CommitOptions {
  dryRun?: boolean
  compileOptions?: CompileOptions
}

export interface CommitResult {
  applied: boolean
  /** Errors present after the change that were not present before it. */
  introduced: Diagnostic[]
  /** The almanac as it is (or, for a dry run or a rejected change, would be) after the change. */
  after: Compilation
}

/**
 * Lints the almanac as it would be after `changes` and writes only when the change introduces no
 * new errors. Errors that were already there never block a write.
 */
export function commitChanges(baseline: Compilation, changes: readonly FileChange[], options: CommitOptions = {}): CommitResult {
  const workspace = baseline.workspace
  const overlay = new OverlayFileSystem(workspace.fs)
  applyChanges(overlay, changes)
  const after = compile(loadWorkspace(workspace.root, overlay), options.compileOptions)
  const introduced = newErrors(baseline.diagnostics, after.diagnostics)
  if (introduced.length > 0 || options.dryRun === true) return { applied: false, introduced, after }
  applyChanges(workspace.fs, changes)
  return { applied: true, introduced, after }
}

/** Errors in `after` beyond those in `before`, matched by code, file, entity and message (not position). */
export function newErrors(before: readonly Diagnostic[], after: readonly Diagnostic[]): Diagnostic[] {
  const key = (diagnostic: Diagnostic) => `${diagnostic.code}|${diagnostic.file}|${diagnostic.id ?? ''}|${diagnostic.message}`
  const remaining = new Map<string, number>()
  for (const diagnostic of before) {
    if (diagnostic.severity === 'error') remaining.set(key(diagnostic), (remaining.get(key(diagnostic)) ?? 0) + 1)
  }
  const introduced: Diagnostic[] = []
  for (const diagnostic of after) {
    if (diagnostic.severity !== 'error') continue
    const count = remaining.get(key(diagnostic)) ?? 0
    if (count > 0) remaining.set(key(diagnostic), count - 1)
    else introduced.push(diagnostic)
  }
  return introduced
}
