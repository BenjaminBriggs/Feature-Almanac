import { basename, dirname, join, resolve } from 'node:path'
import type { FileSystem } from './fs.js'

export const CONFIG_FILE = 'almanac.yaml'

export class RootNotFoundError extends Error {}

export interface RootOptions {
  root?: string
  env?: Record<string, string | undefined>
  cwd: string
  fs: FileSystem
}

/** §2 root discovery: `--root`, then `ALMANAC_ROOT`, then walk up for `almanac.yaml` or `almanac/almanac.yaml`. */
export function findRoot(options: RootOptions): string {
  const explicit = options.root ?? options.env?.ALMANAC_ROOT
  if (explicit !== undefined && explicit !== '') {
    const root = resolve(options.cwd, explicit)
    if (options.fs.exists(join(root, CONFIG_FILE)) === false) {
      throw new RootNotFoundError(`No ${CONFIG_FILE} in ${root}`)
    }
    return root
  }
  let dir = resolve(options.cwd)
  for (;;) {
    if (options.fs.exists(join(dir, CONFIG_FILE))) return dir
    const nested = join(dir, 'almanac')
    if (options.fs.exists(join(nested, CONFIG_FILE))) return nested
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new RootNotFoundError(`No ${CONFIG_FILE} found from ${options.cwd} upwards; run almanac init`)
}

/**
 * The directory holding `dist/` (§2 layout): the app repo when the root is an embedded
 * `almanac/` folder, otherwise the root itself. Deviation: §2's hidden `.almanac/` folder is
 * not used; a cache, when one is needed, goes somewhere visible.
 */
export function projectDir(root: string): string {
  return basename(root) === 'almanac' ? dirname(root) : root
}
