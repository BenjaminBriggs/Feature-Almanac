import { relative, resolve, sep } from 'node:path'
import { parseChangedFiles, type ChangedFile, type Compilation } from '@feature-almanac/core'
import type { Command } from 'commander'
import { CliError, EXIT, type Context } from '../context.js'

/** How `affected` and `relink` name a code change. */
export interface ChangeOptions {
  base?: string
  files?: string
}

/** A code change, split into what lies under the code root and what is the almanac itself. */
export interface ResolvedChange {
  label: string
  /** Every file git (or the list) reported. */
  total: number
  /** Files under the code root, with paths relative to it, as `source` and `code` cite them. */
  codeFiles: ChangedFile[]
  /** Almanac files the change edits, relative to the repository. */
  almanacFiles: string[]
  /** The code root on disk. */
  codeDir: string
}

export function changeArguments(command: Command): Command {
  return command
    .argument('[change]', 'a commit (abc123) or a range (main..HEAD, main...HEAD); nothing means uncommitted changes')
    .option('--base <ref>', 'everything on this branch since it left <ref>, uncommitted changes included')
    .option('--files <path>', 'read the changed files from a file, or - for stdin: git diff --name-status output, or one path per line as gh pr diff --name-only prints')
}

export function resolveChange(ctx: Context, compilation: Compilation, change: string | undefined, options: ChangeOptions): ResolvedChange {
  if (options.base !== undefined && change !== undefined) throw new CliError(EXIT.usage, 'give a change or --base, not both')
  if (options.files !== undefined && (change !== undefined || options.base !== undefined)) {
    throw new CliError(EXIT.usage, '--files replaces the change; give one or the other')
  }
  const root = compilation.workspace.root
  // `source` paths are relative to code.path (the model carries `code` only when it has a repo to link to).
  const codeDir = resolve(root, compilation.config?.code?.path ?? '.')
  const { label, files } = changedFiles(ctx, codeDir, change, options)
  const { codePrefix, almanacPrefix } = prefixes(ctx, root, codeDir, options.files !== undefined)
  const almanacFiles = files.filter((file) => file.path.startsWith(almanacPrefix)).map((file) => file.path)
  const codeFiles: ChangedFile[] = []
  for (const file of files) {
    if (file.path.startsWith(almanacPrefix) || file.path.startsWith(codePrefix) === false) continue
    const from = file.from !== undefined && file.from.startsWith(codePrefix) ? file.from.slice(codePrefix.length) : undefined
    codeFiles.push({ path: file.path.slice(codePrefix.length), status: file.status, ...(from !== undefined ? { from } : {}) })
  }
  return { label, total: files.length, codeFiles, almanacFiles, codeDir }
}

function changedFiles(ctx: Context, codeDir: string, change: string | undefined, options: ChangeOptions): { label: string; files: ChangedFile[] } {
  if (options.files !== undefined) {
    const text = options.files === '-' ? ctx.io.readStdin() : ctx.io.fs.readFile(ctx.path(options.files))
    if (text === undefined) throw new CliError(EXIT.usage, `${options.files} not found`)
    return { label: options.files === '-' ? 'the files on stdin' : options.files, files: parseChangedFiles(text) }
  }
  const run = (args: string[]) => git(ctx, codeDir, args)
  if (options.base !== undefined) {
    const fork = run(['merge-base', options.base, 'HEAD']).trim()
    return { label: `this branch since ${options.base}`, files: [...parseChangedFiles(run(['diff', '--name-status', '-M', fork])), ...untracked(run)] }
  }
  if (change === undefined) {
    return { label: 'uncommitted changes', files: [...parseChangedFiles(run(['diff', '--name-status', '-M', 'HEAD'])), ...untracked(run)] }
  }
  if (change.includes('..')) return { label: change, files: parseChangedFiles(run(['diff', '--name-status', '-M', change])) }
  // One commit: what it changed against its first parent (a merge brings in its whole branch; a root commit adds everything).
  return { label: change, files: parseChangedFiles(run(['diff-tree', '-r', '--no-commit-id', '--name-status', '-M', '--root', '-m', '--first-parent', change])) }
}

function untracked(run: (args: string[]) => string): ChangedFile[] {
  return parseChangedFiles(run(['ls-files', '--others', '--exclude-standard', '--full-name']))
    .map((file) => ({ path: file.path, status: 'added' as const }))
}

/**
 * Git reports paths from the top of the repository; `source` paths are relative to the code root.
 * Without git (a --files list outside a repository), the list is taken as relative to the code root.
 */
function prefixes(ctx: Context, root: string, codeDir: string, lenient: boolean): { codePrefix: string; almanacPrefix: string } {
  try {
    return {
      codePrefix: git(ctx, codeDir, ['rev-parse', '--show-prefix']).trim(),
      almanacPrefix: git(ctx, root, ['rev-parse', '--show-prefix']).trim(),
    }
  } catch (error) {
    if (lenient === false) throw error
    const almanac = relative(codeDir, root).split(sep).join('/')
    return { codePrefix: '', almanacPrefix: almanac === '' ? '' : `${almanac}/` }
  }
}

function git(ctx: Context, dir: string, args: string[]): string {
  try {
    return ctx.io.git(dir, args)
  } catch (error) {
    throw new CliError(EXIT.usage, `git ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
