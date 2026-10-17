import { join } from 'node:path'
import { MemoryFileSystem, compile, loadWorkspace, type Compilation } from '@feature-almanac/core'

/**
 * The spec's §4 config and §9 worked example, held in memory under a made-up product, with stub
 * source files so `source` and `code` paths resolve.
 */
export const SPEC_ROOT = '/example/almanac'

const CONFIG = `# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/config.json
almanac: 1                         # schema version (required)
next_category: 3

product:
  name: Example Notes               # required
  prefix: EX                        # optional, ^[A-Z][A-Z0-9]{0,9}$
  description: Write, format and sync notes.

code:                               # optional; enables source links and checks
  repo: https://github.com/example/notes
  ref: main                         # branch for links
  path: ..                          # code root relative to the almanac root

platforms:                          # required, at least one; key = tag name
  ios:     { name: iOS }
  ipados:  { name: iPadOS }
  macos:   { name: macOS }
  android: { name: Android }

platform_groups:                    # optional shorthand tags
  apple:  [ios, ipados, macos]
  mobile: [ios, android]

statuses:                           # optional; default shown; must include "removed"
  - planned
  - in-progress
  - shipped
  - deprecated
  - removed

formats:                            # optional; behaviour description formats
  default: prose
  allowed: [prose, gherkin, ears]

link_types: [design, prd, ticket, docs, support, analytics, code, other]

owners:                             # optional registry; enables ALM-W010
  ben:     { name: Ben Briggs }
  mobile:  { name: Mobile team }

tickets:                            # optional
  url: https://tracker.example/issue/{id}   # {id} replaced in viewer links

fields:                             # optional custom fields
  feature:
    tier:             { type: enum, values: [free, pro] }
    analytics_events: { type: list }
  behaviour:
    flag:             { type: string }

lint:                               # optional overrides
  require_source: off              # off | warn | error
  require_owner: error
  max_behaviours_per_feature: 20
`

const EDITING = `# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/category.json
id: 1
name: Editing
description: Creating, formatting and saving notes.
owner: ben          # optional
status: active      # optional: active | removed (default active)
removed_reason:     # required when status is removed
next_feature: 2
`

const SYNC = `# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/category.json
id: 2
name: Sync
description: Keeping notes in step across a person's devices.
owner: ben
next_feature: 2
`

const MARKDOWN_EDITOR = `# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/feature.json
id: "1.1"
name: Markdown editor
description: Rich editing of notes with live preview.
owner: ben
status:
  ios: shipped
  ipados: shipped
  macos: shipped
  android: in-progress
platforms: [apple, android]
since: { ios: "1.0", ipados: "1.0", macos: "1.0" }
tags: [core]
depends_on: ["2.1"]
links:
  - { type: design, title: Editor screens, url: "https://figma.com/file/abc" }
code: [Sources/Editor/]
fields:
  tier: free
overview: |
  Supports CommonMark plus task lists. Preview renders on a background
  queue and never blocks input.
next_behaviour: 6

behaviours:
  - id: "1.1.1"
    name: Bold formatting
    source: ["Sources/Editor/EditorView.swift#toggleBold"]
    description: |
      Toggles bold on the selection. With no selection, bold applies to
      newly typed text.
    variants:
      - platforms: [macos]
        description: Triggered with ⌘B or Format ▸ Bold.
      - platforms: [ios, ipados]
        description: Triggered from the keyboard toolbar; ⌘B with a hardware keyboard.
      - platforms: [android]
        status: in-progress
        source: [app/editor/FormatActions.kt]
        description: Triggered from the formatting bar above the keyboard.

  - id: "1.1.2"
    name: Autosave
    format: gherkin
    source: [Sources/Editor/Autosave.swift]
    description: |
      Given a note with unsaved edits
      When input is idle for 1 second
      Then the note is saved without interrupting typing

  - id: "1.1.3"
    name: Live preview
    source: [Sources/Editor/PreviewRenderer.swift]
    description: The preview updates within 100 ms of the last keystroke.
    variants:
      - platforms: [ios]
        mode: replace
        description: Preview is a separate tab; it re-renders when the tab is shown.

  - id: "1.1.4"
    name: Handoff
    platforms: [apple]
    since: "2.0"
    source: [Sources/Continuity/HandoffActivity.swift]
    description: |
      An open note can be continued on another device signed into the same
      Apple Account, with cursor position preserved.

  - id: "1.1.5"
    name: Export to PDF
    platforms: [apple]
    status: removed
    removed_reason: Replaced by system share sheet export in 2.4
    description: Offered Export as PDF from the note menu.

changelog:
  - date: "2026-10-12"
    version: "2.4"
    ticket: EX-212
    author: ben
    summary: Android formatting bar; autosave delay 2 s → 1 s; PDF export removed.
    changes:
      - added: "1.1.1@android"
      - modified: "1.1.2"
      - removed: "1.1.5"
  - date: "2026-06-02"
    version: "2.0"
    summary: Handoff between Apple devices.
    changes:
      - added: "1.1.4"
  - date: "2026-03-01"
    version: "1.0"
    summary: Initial release.
    changes:
      - feature: added
      - added: "1.1.1"
      - added: "1.1.2"
      - added: "1.1.3"
      - added: "1.1.5"
`

const ICLOUD_SYNC = `# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/feature.json
id: "2.1"
name: iCloud sync
description: Notes sync between Apple devices signed into the same Apple Account.
owner: ben
status: shipped
platforms: [apple]
since: "1.0"
code: [Sources/Sync/]
next_behaviour: 2

behaviours:
  - id: "2.1.1"
    name: Background sync
    source: [Sources/Sync/CloudSync.swift]
    description: |
      Edits made on one device appear on the others within a few seconds
      while both are online.

changelog:
  - date: "2026-03-01"
    version: "1.0"
    summary: Initial release.
    changes:
      - feature: added
      - added: "2.1.1"
`

const SOURCES = [
  'Sources/Editor/EditorView.swift',
  'Sources/Editor/Autosave.swift',
  'Sources/Editor/PreviewRenderer.swift',
  'Sources/Continuity/HandoffActivity.swift',
  'Sources/Sync/CloudSync.swift',
  'app/editor/FormatActions.kt',
]

export function specExampleFs(): MemoryFileSystem {
  const fs = new MemoryFileSystem({
    [join(SPEC_ROOT, 'almanac.yaml')]: CONFIG,
    [join(SPEC_ROOT, '01-editing/category.yaml')]: EDITING,
    [join(SPEC_ROOT, '01-editing/01-markdown-editor.yaml')]: MARKDOWN_EDITOR,
    [join(SPEC_ROOT, '02-sync/category.yaml')]: SYNC,
    [join(SPEC_ROOT, '02-sync/01-icloud-sync.yaml')]: ICLOUD_SYNC,
  })
  for (const source of SOURCES) fs.writeFile(join(SPEC_ROOT, '..', source), '// stub\n')
  return fs
}

export function compileSpecExample(): Compilation {
  return compile(loadWorkspace(SPEC_ROOT, specExampleFs()), { now: new Date('2026-10-16T12:00:00Z') })
}
