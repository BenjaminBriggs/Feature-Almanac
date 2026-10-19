import { join } from 'node:path'
import { MemoryFileSystem, compile, loadWorkspace, type Compilation, type CompileOptions } from '@feature-almanac/core'

export const ROOT = '/repo/almanac'
export const FEATURE = '01-editing/01-editor.yaml'

export const CONFIG = `almanac: 1
next_category: 3
product:
  name: Test Product
  prefix: TP
platforms:
  ios: { name: iOS }
  android: { name: Android }
  macos: { name: macOS }
platform_groups:
  apple: [ios, macos]
formats:
  default: prose
`

export const EDITING = `id: 1
name: Editing
description: Creating, formatting and saving notes.
next_feature: 2
`

export const SYNC = `id: 2
name: Sync
description: Keeping notes in step across devices.
next_feature: 1
`

/** A feature that lints clean against CONFIG. */
export const EDITOR = `id: "1.1"
name: Editor
description: Rich editing of notes with live preview.
owner: ben
status: shipped
next_behaviour: 3

behaviours:
  - id: "1.1.1"
    name: Bold
    description: Toggles bold on the selection or on new text.
    variants:
      - platforms: [android]
        description: Triggered from the formatting bar above the keyboard.

  - id: "1.1.2"
    name: Autosave
    description: Saves the note after one second of idle input.

changelog:
  - date: "2026-02-01"
    summary: Autosave.
    changes:
      - added: "1.1.2"
  - date: "2026-01-01"
    summary: Initial release.
    changes:
      - feature: added
      - added: "1.1.1"
`

export type Files = Record<string, string>

export const BASE: Files = {
  'almanac.yaml': CONFIG,
  '01-editing/category.yaml': EDITING,
  '02-sync/category.yaml': SYNC,
  [FEATURE]: EDITOR,
}

/** Root-relative files → memory file system rooted at ROOT. */
export function memoryFs(files: Files = BASE): MemoryFileSystem {
  const fs = new MemoryFileSystem()
  for (const [path, content] of Object.entries(files)) fs.writeFile(join(ROOT, path), content)
  return fs
}

export function compileFiles(files: Files = BASE, options: CompileOptions = {}): Compilation {
  return compile(loadWorkspace(ROOT, memoryFs(files)), { now: new Date('2026-10-16T12:00:00Z'), ...options })
}

/** BASE with one file's text replaced (each pair is an exact substring replacement). */
export function edit(path: string, ...replacements: [string, string][]): Files {
  let text = BASE[path] ?? ''
  for (const [from, to] of replacements) {
    if (text.includes(from) === false) throw new Error(`"${from}" not found in ${path}`)
    text = text.replace(from, to)
  }
  return { ...BASE, [path]: text }
}

export function codes(compilation: Compilation): string[] {
  return compilation.diagnostics.map((diagnostic) => diagnostic.code)
}
