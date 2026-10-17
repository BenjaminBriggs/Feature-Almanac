import * as nodeFs from 'node:fs'
import { dirname, join } from 'node:path'
import type { FileChange } from './changes.js'

/** Synchronous file access over absolute paths. Every read and write in core goes through it. */
export interface FileSystem {
  readFile(path: string): string | undefined
  exists(path: string): boolean
  isDirectory(path: string): boolean
  listDir(path: string): string[]
  writeFile(path: string, content: string): void
  rename(from: string, to: string): void
  remove(path: string): void
}

export class NodeFileSystem implements FileSystem {
  readFile(path: string): string | undefined {
    try {
      return nodeFs.readFileSync(path, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT' || errorCode(error) === 'EISDIR') return undefined
      throw error
    }
  }

  exists(path: string): boolean {
    return nodeFs.existsSync(path)
  }

  isDirectory(path: string): boolean {
    return nodeFs.statSync(path, { throwIfNoEntry: false })?.isDirectory() === true
  }

  listDir(path: string): string[] {
    if (this.isDirectory(path) === false) return []
    return nodeFs.readdirSync(path)
  }

  /** Writes via a temporary file and rename, so a reader never sees a half-written file. */
  writeFile(path: string, content: string): void {
    nodeFs.mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.almanac-tmp`
    nodeFs.writeFileSync(temporary, content, 'utf8')
    nodeFs.renameSync(temporary, path)
  }

  rename(from: string, to: string): void {
    nodeFs.mkdirSync(dirname(to), { recursive: true })
    nodeFs.renameSync(from, to)
  }

  remove(path: string): void {
    nodeFs.rmSync(path, { force: true })
  }
}

/** In-memory file system; directories exist implicitly while they contain files. */
export class MemoryFileSystem implements FileSystem {
  readonly files = new Map<string, string>()

  constructor(initial: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initial)) this.files.set(path, content)
  }

  readFile(path: string): string | undefined {
    return this.files.get(path)
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.isDirectory(path)
  }

  isDirectory(path: string): boolean {
    const prefix = withSlash(path)
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) return true
    }
    return false
  }

  listDir(path: string): string[] {
    const prefix = withSlash(path)
    const names = new Set<string>()
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0] as string)
    }
    return [...names]
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content)
  }

  rename(from: string, to: string): void {
    const content = this.files.get(from)
    if (content !== undefined) {
      this.files.delete(from)
      this.files.set(to, content)
      return
    }
    const prefix = withSlash(from)
    for (const [key, value] of [...this.files]) {
      if (key.startsWith(prefix) === false) continue
      this.files.delete(key)
      this.files.set(to + key.slice(from.length), value)
    }
  }

  remove(path: string): void {
    this.files.delete(path)
  }
}

/**
 * Read-through overlay: writes, renames and removals land in memory and never reach the base file
 * system. `changes()` replays them as FileChanges, in order, for `applyChanges`.
 */
export class OverlayFileSystem implements FileSystem {
  private readonly layer = new MemoryFileSystem()
  /** Base paths removed or renamed away; a directory hides everything under it. */
  private readonly hidden = new Set<string>()
  private readonly log: FileChange[] = []
  /** Paths whose latest log entry is a write that later writes can merge into. */
  private readonly open = new Map<string, number>()

  constructor(private readonly base: FileSystem) {}

  readFile(path: string): string | undefined {
    if (this.layer.files.has(path)) return this.layer.readFile(path)
    return this.isHidden(path) ? undefined : this.base.readFile(path)
  }

  exists(path: string): boolean {
    return this.layer.exists(path) || (this.isHidden(path) === false && this.base.exists(path))
  }

  isDirectory(path: string): boolean {
    return this.layer.isDirectory(path) || (this.isHidden(path) === false && this.base.isDirectory(path))
  }

  listDir(path: string): string[] {
    const base = this.isHidden(path) ? [] : this.base.listDir(path).filter((name) => this.isHidden(join(path, name)) === false)
    return [...new Set([...base, ...this.layer.listDir(path)])]
  }

  writeFile(path: string, content: string): void {
    const previous = this.readFile(path)
    this.layer.writeFile(path, content)
    const index = this.open.get(path)
    const earlier = index === undefined ? undefined : this.log[index]
    if (index !== undefined && earlier?.kind === 'write') {
      this.log[index] = { ...earlier, content }
      return
    }
    this.open.set(path, this.log.length)
    this.log.push(previous === undefined ? { kind: 'write', path, content } : { kind: 'write', path, content, previous })
  }

  /** Moves a file, or a directory with everything in it. */
  rename(from: string, to: string): void {
    for (const path of this.filesAt(from)) {
      const content = this.readFile(path) as string
      this.layer.remove(path)
      this.layer.writeFile(to + path.slice(from.length), content)
    }
    this.hidden.add(from)
    this.close(from)
    this.close(to)
    this.log.push({ kind: 'rename', from, to })
  }

  remove(path: string): void {
    const previous = this.readFile(path)
    if (previous === undefined) return
    this.layer.remove(path)
    this.hidden.add(path)
    this.close(path)
    this.log.push({ kind: 'remove', path, previous })
  }

  /** Everything done to the overlay, in order; consecutive writes to one file are merged. */
  changes(): FileChange[] {
    return [...this.log]
  }

  private isHidden(path: string): boolean {
    for (let current = path; ; current = dirname(current)) {
      if (this.hidden.has(current)) return true
      if (dirname(current) === current) return false
    }
  }

  /** `path` itself when it is a file, otherwise every file under it. */
  private filesAt(path: string): string[] {
    if (this.readFile(path) !== undefined) return [path]
    const files: string[] = []
    for (const name of this.listDir(path)) files.push(...this.filesAt(join(path, name)))
    return files
  }

  /** A rename or removal ends the run of writes that later writes to the same paths merge into. */
  private close(path: string): void {
    for (const open of [...this.open.keys()]) {
      if (open === path || open.startsWith(withSlash(path))) this.open.delete(open)
    }
  }
}

function withSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || 'code' in error === false) return undefined
  return String(error.code)
}
