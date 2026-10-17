import { execFile, execFileSync } from 'node:child_process'
import { readFileSync, watch } from 'node:fs'
import { homedir } from 'node:os'
import { NodeFileSystem, type FileSystem } from '@feature-almanac/core'

/** Everything the CLI touches outside itself, so commands run in tests without a process. */
export interface Io {
  stdout(text: string): void
  stderr(text: string): void
  readStdin(): string
  cwd: string
  env: Record<string, string | undefined>
  isTTY: boolean
  now(): Date
  fs: FileSystem
  home: string
  gitRef(dir: string): string | undefined
  /** Runs git in `dir` and returns its stdout; throws with git's message when it fails. */
  git(dir: string, args: readonly string[]): string
  openUrl(url: string): void
  /** Calls `onChange` when a file under `dir` changes (hidden folders and dist/ excepted); returns a stop function. */
  watch(dir: string, onChange: () => void): () => void
  /** Resolves when the process is asked to stop (Ctrl-C); long-running commands await it. */
  waitForExit(): Promise<void>
}

export function nodeIo(): Io {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: () => readFileSync(0, 'utf8'),
    cwd: process.cwd(),
    env: process.env,
    isTTY: process.stdout.isTTY === true,
    now: () => new Date(),
    fs: new NodeFileSystem(),
    home: homedir(),
    gitRef: (dir) => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      } catch {
        return undefined
      }
    },
    git: (dir, args) => {
      try {
        return execFileSync('git', [...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString()
      } catch (error) {
        const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim()
        throw new Error(stderr || (error instanceof Error ? error.message : String(error)))
      }
    },
    openUrl: (url) => {
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(command, [url], () => {})
    },
    watch: (dir, onChange) => {
      const watcher = watch(dir, { recursive: true }, (_event, filename) => {
        if (/(^|[\\/])(\.|dist([\\/]|$))/.test(String(filename ?? ''))) return
        onChange()
      })
      return () => watcher.close()
    },
    waitForExit: () =>
      new Promise((resolve) => {
        process.once('SIGINT', () => resolve())
        process.once('SIGTERM', () => resolve())
      }),
  }
}
