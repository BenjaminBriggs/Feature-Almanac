import { join, relative, sep } from 'node:path'
import type { FileKind } from '@feature-almanac/schema'
import type { FileSystem } from './fs.js'
import { CONFIG_FILE } from './root.js'
import { parseYaml, type ParsedYaml } from './yaml.js'

export const CATEGORY_FILE = 'category.yaml'
const CATEGORY_DIR_RE = /^\d+-/

export interface SourceFile {
  kind: FileKind
  /** Root-relative, `/`-separated. */
  path: string
  absPath: string
  text: string
  parsed: ParsedYaml
}

export interface CategoryDir {
  dirName: string
  absDir: string
  /** Undefined when the folder looks like a category (`NN-…`) but has no category.yaml. */
  file?: SourceFile
  features: SourceFile[]
}

export interface Workspace {
  root: string
  fs: FileSystem
  config?: SourceFile
  categories: CategoryDir[]
}

/** Reads and parses every almanac file under `root`. No validation happens here. */
export function loadWorkspace(root: string, fs: FileSystem): Workspace {
  const load = (kind: FileKind, absPath: string): SourceFile | undefined => {
    const text = fs.readFile(absPath)
    if (text === undefined) return undefined
    return { kind, path: relative(root, absPath).split(sep).join('/'), absPath, text, parsed: parseYaml(text) }
  }

  const workspace: Workspace = { root, fs, categories: [] }
  const config = load('config', join(root, CONFIG_FILE))
  if (config !== undefined) workspace.config = config

  for (const dirName of fs.listDir(root).sort()) {
    const absDir = join(root, dirName)
    if (dirName.startsWith('.') || fs.isDirectory(absDir) === false) continue
    const file = load('category', join(absDir, CATEGORY_FILE))
    if (file === undefined && CATEGORY_DIR_RE.test(dirName) === false) continue
    const features = fs
      .listDir(absDir)
      .filter((name) => name.endsWith('.yaml') && name !== CATEGORY_FILE)
      .sort()
      .map((name) => load('feature', join(absDir, name)))
      .filter((feature): feature is SourceFile => feature !== undefined)
    const dir: CategoryDir = { dirName, absDir, features }
    if (file !== undefined) dir.file = file
    workspace.categories.push(dir)
  }
  return workspace
}

export function allFiles(workspace: Workspace): SourceFile[] {
  const files: SourceFile[] = []
  if (workspace.config !== undefined) files.push(workspace.config)
  for (const dir of workspace.categories) {
    if (dir.file !== undefined) files.push(dir.file)
    files.push(...dir.features)
  }
  return files
}
