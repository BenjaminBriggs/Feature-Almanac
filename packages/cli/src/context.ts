import { resolve } from 'node:path'
import {
  InvalidStateError,
  NotFoundError,
  RootNotFoundError,
  UsageError,
  WriteConflictError,
  compile,
  findRoot,
  loadWorkspace,
  type Compilation,
  type CompileOptions,
  type Redirect,
  type Workspace,
} from '@feature-almanac/core'
import type { Diagnostic, Almanac } from '@feature-almanac/schema'
import type { Io } from './io.js'

/** §11 exit codes. */
export const EXIT = { ok: 0, lint: 1, usage: 2, notFound: 3, conflict: 4, internal: 5 } as const

export class CliError extends Error {
  constructor(
    readonly exitCode: number,
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message)
  }
}

export interface Globals {
  root?: string
  json?: boolean
  quiet?: boolean
  color?: boolean
  dryRun?: boolean
}

const ANSI = { red: 31, yellow: 33, dim: 2, bold: 1 } as const

export class Context {
  constructor(
    readonly io: Io,
    readonly globals: Globals,
    readonly command: string,
  ) {}

  get json(): boolean {
    return this.globals.json === true
  }

  get dryRun(): boolean {
    return this.globals.dryRun === true
  }

  get quiet(): boolean {
    return this.globals.quiet === true
  }

  root(): string {
    return findRoot({ root: this.globals.root, env: this.io.env, cwd: this.io.cwd, fs: this.io.fs })
  }

  workspace(): Workspace {
    return loadWorkspace(this.root(), this.io.fs)
  }

  compile(options: CompileOptions = {}): Compilation {
    return compile(this.workspace(), { now: this.io.now(), ...options })
  }

  model(compilation: Compilation): Almanac {
    if (compilation.model === undefined) {
      throw new CliError(EXIT.lint, 'almanac.yaml is missing or invalid', compilation.diagnostics)
    }
    return compilation.model
  }

  path(input: string): string {
    return resolve(this.io.cwd, input)
  }

  /** Result text on stdout; suppressed in --json mode. */
  out(text: string): void {
    if (this.json) return
    this.io.stdout(text.endsWith('\n') ? text : `${text}\n`)
  }

  /** Secondary information on stderr; suppressed by --json and --quiet. */
  note(text: string): void {
    if (this.json || this.quiet) return
    this.io.stderr(`${text}\n`)
  }

  redirects(redirects: readonly Redirect[]): void {
    for (const redirect of redirects) this.note(`note: ${redirect.from} is now ${redirect.to}`)
  }

  /** §11 JSON envelope; only in --json mode. */
  envelope(ok: boolean, data: unknown, diagnostics: readonly Diagnostic[] = [], redirects: readonly Redirect[] = []): void {
    if (this.json === false) return
    const body = { almanac: 1, command: this.command, ok, data, diagnostics, redirects }
    this.io.stdout(`${JSON.stringify(body, null, 2)}\n`)
  }

  diagnostics(diagnostics: readonly Diagnostic[], stream: 'stdout' | 'stderr' = 'stdout'): void {
    if (this.json) return
    const write = stream === 'stdout' ? this.io.stdout : this.io.stderr
    for (const diagnostic of diagnostics) {
      if (this.quiet && diagnostic.severity !== 'error') continue
      const where = diagnostic.line === undefined ? diagnostic.file : `${diagnostic.file}:${diagnostic.line}`
      const severity = diagnostic.severity === 'error' ? this.paint('red', 'error') : this.paint('yellow', 'warn ')
      write(`${this.paint('dim', where)}  ${severity}  ${diagnostic.code}  ${diagnostic.message}\n`)
    }
  }

  paint(style: keyof typeof ANSI, text: string): string {
    const enabled = this.globals.color !== false && this.io.isTTY && this.json === false && this.io.env.NO_COLOR === undefined
    return enabled ? `\u001b[${ANSI[style]}m${text}\u001b[0m` : text
  }

  /** Reports a failure in the active output mode and returns its exit code. */
  fail(error: unknown): number {
    const { exitCode, message, diagnostics } = classify(error)
    if (this.json) {
      this.envelope(false, { error: message }, diagnostics)
    } else {
      this.diagnostics(diagnostics, 'stderr')
      this.io.stderr(`${this.paint('red', 'error')}: ${message}\n`)
    }
    return exitCode
  }
}

function classify(error: unknown): { exitCode: number; message: string; diagnostics: Diagnostic[] } {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof CliError) return { exitCode: error.exitCode, message, diagnostics: error.diagnostics }
  if (error instanceof UsageError || error instanceof RootNotFoundError) return { exitCode: EXIT.usage, message, diagnostics: [] }
  if (error instanceof NotFoundError) return { exitCode: EXIT.notFound, message, diagnostics: [] }
  if (error instanceof InvalidStateError || error instanceof WriteConflictError) return { exitCode: EXIT.conflict, message, diagnostics: [] }
  const detail = error instanceof Error && error.stack !== undefined ? error.stack : message
  return { exitCode: EXIT.internal, message: `internal error: ${detail}`, diagnostics: [] }
}

export function parseList(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}
