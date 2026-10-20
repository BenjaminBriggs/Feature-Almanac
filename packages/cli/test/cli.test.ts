import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryFileSystem } from '@feature-almanac/core'
import { run, type Io } from '../src/index.js'

const CWD = '/work'
const ROOT = join(CWD, 'almanac')

/** Stands in for git in tests: answers by the command, `git rev-parse --show-prefix` with the folder below CWD. */
type GitStub = (dir: string, args: readonly string[]) => string
let git: GitStub = () => {
  throw new Error('not a git repository')
}

function harness(files: Record<string, string> = {}) {
  const fs = new MemoryFileSystem()
  for (const [path, content] of Object.entries(files)) fs.writeFile(join(CWD, path), content)
  let stdin = ''
  let stdout = ''
  let stderr = ''
  const io: Io = {
    stdout: (text) => void (stdout += text),
    stderr: (text) => void (stderr += text),
    readStdin: () => stdin,
    cwd: CWD,
    env: {},
    isTTY: false,
    now: () => new Date('2026-10-16T12:00:00Z'),
    fs,
    home: '/home/tester',
    gitRef: () => undefined,
    git: (dir, args) => git(dir, args),
    openUrl: () => {},
    watch: () => () => {},
    waitForExit: () => Promise.resolve(),
  }
  const almanac = async (...argv: string[]) => {
    stdout = ''
    stderr = ''
    const code = await run(argv, io)
    return { code, stdout, stderr, json: () => JSON.parse(stdout) as Record<string, unknown> }
  }
  return { fs, almanac, setStdin: (text: string) => void (stdin = text) }
}

async function seeded() {
  const h = harness()
  await h.almanac('init', '--product', 'Painting Desk', '--prefix', 'PD', '--platforms', 'ios,macos,android')
  await h.almanac('add', 'category', '--name', 'Editing', '--description', 'Creating, formatting and saving notes.')
  await h.almanac('add', 'feature', '--category', '1', '--name', 'Markdown editor', '--description', 'Rich editing of notes with live preview.', '--owner', 'ben', '--status', 'shipped')
  await h.almanac('add', 'behaviour', '--feature', '1.1', '--name', 'Bold formatting', '--format', 'prose', '--description', 'Toggles bold on the selection or on newly typed text.')
  return h
}

describe('almanac CLI', () => {
  it('init, add, lint, build, show and list work end to end', async () => {
    const h = harness()
    const init = await h.almanac('init', '--product', 'Painting Desk', '--prefix', 'PD', '--platforms', 'ios,macos,android')
    expect(init).toMatchObject({ code: 0, stdout: 'Created almanac/almanac.yaml, .gitignore\n' })
    expect(h.fs.readFile(join(CWD, '.gitignore'))).toBe('/dist/\n')
    expect(h.fs.readFile(join(ROOT, 'almanac.yaml'))).toBe(`# yaml-language-server: $schema=https://feature-almanac.dev/schema/v1/config.json
almanac: 1
next_category: 1
product:
  name: Painting Desk
  prefix: PD
platforms:
  ios: {name: iOS}
  macos: {name: macOS}
  android: {name: Android}
`)

    expect((await h.almanac('add', 'category', '--name', 'Editing', '--description', 'Creating, formatting and saving notes.')).stdout).toBe(
      'Added category 1 Editing (01-editing/category.yaml)\n',
    )
    const feature = await h.almanac('add', 'feature', '--category', '1', '--name', 'Markdown editor', '--description', 'Rich editing of notes with live preview.', '--owner', 'ben', '--status', 'shipped')
    expect(feature.stdout).toBe('Added feature 1.1 Markdown editor (01-editing/01-markdown-editor.yaml)\n')

    h.setStdin('Given a note with unsaved edits\nWhen input is idle for 1 second\nThen the note is saved\n')
    expect((await h.almanac('add', 'behaviour', '--feature', 'PD-1.1', '--name', 'Autosave', '-')).code).toBe(0)
    expect((await h.almanac('add', 'variant', '1.1.1', '--platforms', 'android', '--mode', 'replace', '--description', 'Saves when the app goes to the background.')).stdout).toBe(
      'Added variant 1.1.1@android (01-editing/01-markdown-editor.yaml)\n',
    )

    expect(await h.almanac('lint')).toMatchObject({ code: 0, stdout: 'No problems.\n' })

    const build = await h.almanac('build')
    expect(build).toMatchObject({ code: 0, stdout: 'Wrote dist/almanac.json: 1 category, 1 feature, 1 behaviour (0 errors, 0 warnings)\n' })
    const model = JSON.parse(h.fs.readFile(join(CWD, 'dist/almanac.json')) ?? '{}')
    expect(model.categories[0].features[0].behaviours[0].resolved.android).toBe('Saves when the app goes to the background.')
    expect(model.categories[0].features[0].behaviours[0].gherkin[0].steps).toHaveLength(3)

    const show = await h.almanac('--json', 'show', '1.1.1')
    expect(show.code).toBe(0)
    expect(show.json()).toMatchObject({ almanac: 1, command: 'show', ok: true, data: { kind: 'behaviour', entity: { id: '1.1.1', ref: 'PD-1.1.1' } }, diagnostics: [], redirects: [] })
    expect(show.stderr).toBe('')

    expect((await h.almanac('show', '1.1.1', '--platform', 'android')).stdout).toContain('Saves when the app goes to the background.')
    expect((await h.almanac('list', '--level', 'behaviour')).stdout).toBe('1.1.1  Autosave  shipped\n')
    const listed = (await h.almanac('--json', 'list')).json()
    expect(listed.data).toEqual([expect.objectContaining({ level: 'feature', id: '1.1', behaviourCount: 1 })])
  })

  it('init anchors its .gitignore entry and keeps a pattern that already covers it', async () => {
    const appended = harness({ '.gitignore': 'node_modules/' })
    expect((await appended.almanac('init', '--platforms', 'ios')).code).toBe(0)
    expect(appended.fs.readFile(join(CWD, '.gitignore'))).toBe('node_modules/\n/dist/\n')

    const kept = harness({ '.gitignore': 'node_modules/\ndist' })
    expect(await kept.almanac('init', '--platforms', 'ios')).toMatchObject({ code: 0, stdout: 'Created almanac/almanac.yaml\n' })
    expect(kept.fs.readFile(join(CWD, '.gitignore'))).toBe('node_modules/\ndist')
  })

  it('returns the §11 exit codes', async () => {
    const h = await seeded()
    expect((await h.almanac('show', '9.9')).code).toBe(3)
    expect((await h.almanac('show', 'QQ-1.1')).code).toBe(3)
    expect((await h.almanac('show', '1.x')).code).toBe(2)
    expect((await h.almanac('frobnicate')).code).toBe(2)
    expect((await h.almanac('add', 'feature', '--category', '1')).code).toBe(2)
    expect((await h.almanac('init', '--platforms', 'ios')).code).toBe(4)
    expect((await h.almanac('--help')).code).toBe(0)
    expect(await h.almanac('--version')).toMatchObject({ code: 0, stdout: '0.1.0\n' })
    expect((await harness().almanac('lint')).code).toBe(2)
  })

  it('lint exits 1 on errors, and on warnings only with --strict', async () => {
    const h = await seeded()
    await h.almanac('add', 'feature', '--category', '1', '--name', 'Attachments', '--description', 'Images and files inside notes.', '--owner', 'ben')
    expect(await h.almanac('lint')).toMatchObject({ code: 0, stdout: expect.stringContaining('ALM-W017') })
    expect((await h.almanac('lint', '--strict')).code).toBe(1)

    const file = join(ROOT, '01-editing/01-markdown-editor.yaml')
    h.fs.writeFile(file, (h.fs.readFile(file) ?? '').replace('status: shipped', 'status: shiped'))
    const lint = await h.almanac('--json', 'lint')
    expect(lint.code).toBe(1)
    expect(lint.json()).toMatchObject({ ok: false, data: { errors: 1, warnings: 1 } })
    expect((lint.json().diagnostics as { code: string }[]).map((d) => d.code)).toEqual(['ALM-E007', 'ALM-W017'])
    expect(lint.stderr).toBe('')
  })

  it('refuses a write that would add an error and leaves files untouched', async () => {
    const h = await seeded()
    await h.almanac('add', 'variant', '1.1.1', '--platforms', 'android', '--description', 'Triggered from the formatting bar.')
    const file = join(ROOT, '01-editing/01-markdown-editor.yaml')
    const before = h.fs.readFile(file)
    const result = await h.almanac('add', 'variant', '1.1.1', '--platforms', 'android', '--description', 'A second Android variant.')
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('ALM-E032')
    expect(h.fs.readFile(file)).toBe(before)
  })

  it('--dry-run prints the diff and writes nothing', async () => {
    const h = await seeded()
    const before = new Map(h.fs.files)
    const result = await h.almanac('--dry-run', 'add', 'behaviour', '--feature', '1.1', '--name', 'Italic', '--description', 'Toggles italic on the selection or on new text.')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('+  - id: "1.1.2"')
    expect(result.stdout).toContain('-next_behaviour: 2')
    expect(h.fs.files).toEqual(before)
  })

  it('follows former IDs and reports the redirect', async () => {
    const h = await seeded()
    const file = join(ROOT, '01-editing/01-markdown-editor.yaml')
    h.fs.writeFile(file, (h.fs.readFile(file) ?? '').replace('    name: Bold formatting\n', '    name: Bold formatting\n    formerly: ["1.1.9"]\n').replace('next_behaviour: 2', 'next_behaviour: 10'))
    const show = await h.almanac('show', '1.1.9')
    expect(show.code).toBe(0)
    expect(show.stderr).toBe('note: 1.1.9 is now 1.1.1\n')
    expect((await h.almanac('--json', 'show', '1.1.9')).json().redirects).toEqual([{ from: '1.1.9', to: '1.1.1' }])
  })

  it('fmt --check, fmt and lint --fix', async () => {
    const h = await seeded()
    const file = join(ROOT, '01-editing/01-markdown-editor.yaml')
    const messy = (h.fs.readFile(file) ?? '').replace('id: "1.1"\nname: Markdown editor\n', 'name: Markdown editor\nid: 1.1\n').replace('next_behaviour: 2\n', '')
    h.fs.writeFile(file, messy)
    expect(await h.almanac('fmt', '--check')).toMatchObject({ code: 1, stdout: 'would reformat 01-editing/01-markdown-editor.yaml\n' })
    expect((await h.almanac('lint')).code).toBe(1)
    const preview = await h.almanac('--dry-run', 'lint', '--fix')
    expect(preview.stdout).toContain('+next_behaviour: 2')
    expect(preview.stdout).toContain('+id: "1.1"')
    expect(h.fs.readFile(file)).toBe(messy)
    const fixed = await h.almanac('lint', '--fix')
    expect(fixed).toMatchObject({ code: 0, stdout: 'No problems.\n', stderr: 'Fixed 01-editing/01-markdown-editor.yaml\n' })
    expect(h.fs.readFile(file)).toContain('id: "1.1"\nname: Markdown editor\n')
    expect(h.fs.readFile(file)).toContain('next_behaviour: 2\n')
    expect((await h.almanac('fmt', '--check')).code).toBe(0)
  })

  it('site build writes one self-contained page', async () => {
    const h = await seeded()
    const result = await h.almanac('site', 'build')
    expect(result).toMatchObject({ code: 0, stdout: 'Wrote dist/site/index.html (0 errors, 0 warnings)\n' })
    const page = h.fs.readFile(join(CWD, 'dist/site/index.html')) ?? ''
    expect(page).toMatch(/<li class="behaviour" id="1\.1\.1" data-hash="[0-9a-f]{8}">/)
    expect(page).toContain('window.MiniSearch')
    expect(h.fs.readFile(join(CWD, 'dist/site/almanac.json'))).toContain('"name": "Markdown editor"')
  })

  it('site serve serves until asked to stop', async () => {
    const h = await seeded()
    const result = await h.almanac('site', 'serve', '--port', '0')
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^Serving http:\/\/127\.0\.0\.1:\d+\/ — watching almanac; Ctrl-C to stop\n$/)
  })

  it('apply reads a patch from stdin', async () => {
    const h = await seeded()
    h.setStdin(JSON.stringify({
      almanac: 1,
      summary: 'Initial almanac.',
      ops: [
        { op: 'add', level: 'feature', parent: '1', as: '$tables', name: 'Tables', description: 'Markdown tables with a grid editor.', owner: 'ben', status: 'shipped' },
        {
          op: 'add',
          level: 'behaviour',
          parent: '$tables',
          name: 'Insert table',
          description: 'Inserts a two-by-two table at the cursor.\nGiven a note open in the editor\nWhen the user chooses "Insert Table"\nThen a two-by-two table appears at the cursor',
        },
        { op: 'add', level: 'behaviour', parent: '$tables', name: 'Prose', description: 'Inserts a two-by-two table at the cursor.' },
      ],
    }))
    const result = await h.almanac('apply', '-')
    expect(result).toMatchObject({ code: 0, stdout: 'Added feature 1.2 ($tables)\nAdded behaviour 1.2.1\nAdded behaviour 1.2.2\nWrote 2 files\n' })
    // Gherkin is the default format: prose with no format set is a warning that says how to opt out.
    expect((await h.almanac('lint')).stdout).toBe(
      '01-editing/02-tables.yaml:20  warn   ALM-W015  Behaviour 1.2.2 has format gherkin, but no Given/When/Then steps found (gherkin is the default; set format: prose for plain text)\n0 errors, 1 warning\n',
    )
    const behaviour = (await h.almanac('--json', 'show', '1.2.1')).json().data.entity
    expect(behaviour).toMatchObject({ format: 'gherkin', summary: 'Inserts a two-by-two table at the cursor.' })
    expect(behaviour.gherkin[0].steps).toHaveLength(3)
    expect((await h.almanac('apply', 'missing.json')).code).toBe(2)
  })

  it('apply records a review file and says which decisions were on changed text', async () => {
    const h = await seeded()
    const hash = (await h.almanac('--json', 'show', '1.1.1')).json().data as { entity: { hash: string } }
    h.setStdin(JSON.stringify({
      almanac: 1,
      summary: 'Review by Sam Price.',
      changelog: 'none',
      ops: [
        { op: 'review', ref: 'PD-1.1.1', state: 'approved', by: 'Sam Price', date: '2026-10-19', hash: hash.entity.hash },
        { op: 'review', ref: 'PD-1.1.1', state: 'rejected', by: 'Sam Price', note: 'Wrong.', hash: '00000000' },
      ],
    }))
    expect(await h.almanac('apply', '-')).toMatchObject({
      code: 0,
      stdout: 'Recorded 1 review\nWrote 1 file\nSkipped: PD-1.1.1 changed after it was reviewed; review it again\n',
    })
    expect((await h.almanac('show', '1.1.1')).stdout).toContain('- Review: approved by Sam Price on 2026-10-19\n')
  })

  it('set writes typed values, including one platform of a status', async () => {
    const h = await seeded()
    const file = join(ROOT, '01-editing/01-markdown-editor.yaml')
    expect(await h.almanac('set', '1.1.1', 'status.android=planned', 'tags=formatting,core')).toMatchObject({
      code: 0,
      stdout: 'Updated 1.1.1 Bold formatting (01-editing/01-markdown-editor.yaml)\n',
    })
    expect(h.fs.readFile(file)).toContain('    status:\n      android: planned\n')
    expect(h.fs.readFile(file)).toContain('    tags: [formatting, core]\n')
    expect(h.fs.readFile(file)).toContain('    summary: Set status.android → planned; tags → formatting, core on Bold formatting.\n')
    expect(await h.almanac('lint')).toMatchObject({ code: 0, stdout: 'No problems.\n' })

    expect((await h.almanac('set', '1.1.1', 'tags=formatting,core')).code).toBe(4)
    expect((await h.almanac('set', '1.1.1', 'name=Bold')).stderr).toContain('use almanac rename')
    expect((await h.almanac('set', '1.1.1', 'platforms=web')).code).toBe(1)
    await h.almanac('add', 'variant', '1.1.1', '--platforms', 'android', '--description', 'Triggered from the formatting bar.')
    await h.almanac('set', '1.1.1@android', 'status=in-progress')
    const override = await h.almanac('set', '1.1.1', 'status.android=shipped')
    expect(override.code).toBe(2)
    expect(override.stderr).toContain('use almanac set 1.1.1@android status.android=…')
  })

  it('describe replaces a description from stdin, or a feature overview', async () => {
    const h = await seeded()
    const file = join(ROOT, '01-editing/01-markdown-editor.yaml')
    h.setStdin('Toggles bold on the selection.\nWith no selection, newly typed text is bold.\n')
    expect(await h.almanac('describe', '1.1.1', '-')).toMatchObject({ code: 0, stdout: 'Described 1.1.1 Bold formatting (01-editing/01-markdown-editor.yaml)\n' })
    expect(h.fs.readFile(file)).toContain('    description: |\n      Toggles bold on the selection.\n      With no selection, newly typed text is bold.\n')
    expect((await h.almanac('describe', '1.1', '--overview', '--description', 'CommonMark with task lists and tables.')).code).toBe(0)
    expect(h.fs.readFile(file)).toContain('overview: CommonMark with task lists and tables.\n')
    expect((await h.almanac('describe', '1.1.1', '--overview', '--description', 'x')).code).toBe(2)

    h.setStdin('Toggles bold on the selection or on newly typed text.\n')
    expect((await h.almanac('describe', '1.1.1', '-')).code).toBe(0)
    expect(h.fs.readFile(file)).toContain('    description: Toggles bold on the selection or on newly typed text.\n')
    expect((await h.almanac('fmt', '--check')).code).toBe(0)
  })

  it('rename renames the entity and its file', async () => {
    const h = await seeded()
    expect((await h.almanac('--dry-run', 'rename', '1.1', '--name', 'Note editor')).stdout).toContain(
      'rename 01-editing/01-markdown-editor.yaml → 01-editing/01-note-editor.yaml\n',
    )
    expect(h.fs.readFile(join(ROOT, '01-editing/01-markdown-editor.yaml'))).toBeDefined()
    expect(await h.almanac('rename', '1.1', '--name', 'Note editor')).toMatchObject({ code: 0, stdout: 'Renamed 1.1 to Note editor (01-editing/01-note-editor.yaml)\n' })
    expect(h.fs.readFile(join(ROOT, '01-editing/01-markdown-editor.yaml'))).toBeUndefined()
    expect(await h.almanac('rename', '1', '--name', 'Writing')).toMatchObject({ code: 0, stdout: 'Renamed 1 to Writing (01-writing/category.yaml)\n' })
    expect(h.fs.readFile(join(ROOT, '01-writing/01-note-editor.yaml'))).toContain('name: Note editor\n')
    expect(await h.almanac('lint')).toMatchObject({ code: 0, stdout: 'No problems.\n' })
  })

  it('remove tombstones behaviours and variants', async () => {
    const h = await seeded()
    await h.almanac('add', 'variant', '1.1.1', '--platforms', 'android', '--description', 'Triggered from the formatting bar.')
    expect(await h.almanac('remove', '1.1.1@android', '--reason', 'The formatting bar is gone.')).toMatchObject({
      code: 0,
      stdout: 'Removed 1.1.1@android (01-editing/01-markdown-editor.yaml)\n',
    })
    expect(await h.almanac('remove', '1.1.1', '--reason', 'Formatting moved to a toolbar.')).toMatchObject({ code: 0 })
    const file = h.fs.readFile(join(ROOT, '01-editing/01-markdown-editor.yaml'))
    expect(file).toContain('    status: removed\n    removed_reason: Formatting moved to a toolbar.\n')
    expect((await h.almanac('list', '--level', 'behaviour')).stderr).toBe('Nothing matches.\n')
    expect((await h.almanac('remove', '1.1.1', '--reason', 'Again.')).code).toBe(4)
    expect((await h.almanac('remove', '1.1.1')).code).toBe(2)
    expect(await h.almanac('lint')).toMatchObject({ code: 0 })
  })

  it('mv re-IDs under the new parent and the old ID keeps resolving', async () => {
    const h = await seeded()
    await h.almanac('add', 'category', '--name', 'Sync', '--description', 'Keeping notes in step across devices.')
    await h.almanac('add', 'feature', '--category', '2', '--name', 'Cloud sync', '--description', 'Notes sync between signed-in devices.', '--owner', 'ben', '--status', 'shipped')
    expect(await h.almanac('mv', '1.1.1', '--to', '2.1')).toMatchObject({ code: 0, stdout: 'Moved 1.1.1 → 2.1.1 Bold formatting (02-sync/01-cloud-sync.yaml)\n' })
    const show = await h.almanac('show', '1.1.1')
    expect(show.stderr).toBe('note: 1.1.1 is now 2.1.1\n')
    expect(show.stdout).toContain('# 2.1.1 Bold formatting')

    const moved = (await h.almanac('--json', 'mv', '1.1', '--to', '2')).json()
    expect(moved).toMatchObject({ ok: true, data: { kind: 'feature', from: '1.1', id: '2.2', entity: { formerly: ['1.1'] } } })
    expect(h.fs.readFile(join(ROOT, '02-sync/02-markdown-editor.yaml'))).toContain('id: "2.2"\n')
    expect((await h.almanac('mv', '1', '--to', '2')).code).toBe(2)
    // Its only behaviour moved out first, so 2.2 is now empty.
    expect(await h.almanac('lint')).toMatchObject({ code: 0, stdout: expect.stringContaining('ALM-W017  Feature 2.2 has no behaviours yet\n0 errors, 1 warning') })
    expect((await h.almanac('next-id', '1')).stdout).toBe('1.2\n')
  })

  it('changelog add prepends an entry', async () => {
    const h = await seeded()
    const result = await h.almanac('changelog', 'add', '1.1', '--summary', 'Bold works on Android.', '--change', 'modified:PD-1.1.1', '--release', '1.4', '--ticket', 'PD-9')
    expect(result).toMatchObject({ code: 0, stdout: 'Added a changelog entry to 1.1 Markdown editor (01-editing/01-markdown-editor.yaml)\n' })
    expect(h.fs.readFile(join(ROOT, '01-editing/01-markdown-editor.yaml'))).toContain(`changelog:
  - date: "2026-10-16"
    summary: Bold works on Android.
    changes:
      - modified: "1.1.1"
    version: "1.4"
    ticket: PD-9
`)
    expect((await h.almanac('changelog', 'add', '1.1', '--summary', 'Nothing.')).code).toBe(2)
    expect((await h.almanac('changelog', 'add', '1.1', '--summary', 'Typo.', '--change', 'modified:1.1.9')).code).toBe(1)
  })

  it('next-id prints the ID add would allocate', async () => {
    const h = await seeded()
    expect((await h.almanac('next-id')).stdout).toBe('2\n')
    expect((await h.almanac('next-id', '1')).stdout).toBe('1.2\n')
    expect((await h.almanac('--json', 'next-id', 'PD-1.1')).json()).toMatchObject({ ok: true, data: { parent: 'PD-1.1', id: '1.1.2' } })
    expect((await h.almanac('next-id', '1.1.1')).code).toBe(2)
  })

  it('agent install writes the skill and commands', async () => {
    const h = harness()
    const result = await h.almanac('agent', 'install')
    expect(result.code).toBe(0)
    expect(h.fs.readFile(join(CWD, '.claude/skills/almanac/SKILL.md'))).toContain('name: almanac')
    const generate = h.fs.readFile(join(CWD, '.claude/commands/almanac-generate.md'))
    expect(generate).toMatch(/^---\ndescription: "Build the initial almanac for this codebase from its code"\nargument-hint: "\[path to the code, default: this repository\]"\n---\n\nInput: \$ARGUMENTS\n/)
    expect(generate).toContain('Verify every feature with `/almanac-verify`')
    expect(generate).toContain('Write each behaviour as a one-line summary followed by Given/When/Then')
    expect(h.fs.readFile(join(CWD, '.claude/skills/almanac/SKILL.md'))).toContain('## Writing behaviours: Given / When / Then')
    expect((await h.almanac('agent', 'install')).stdout).toBe('Already up to date.\n')
    expect((await h.almanac('agent', 'install', '--global')).stdout).toContain('Wrote ../home/tester/.claude/skills/almanac/SKILL.md')
    expect((await h.almanac('agent', 'install', '--tool', 'cursor')).code).toBe(2)
    expect((await h.almanac('agent', 'install', '--tool', 'codex,cursor')).code).toBe(2)
  })

  it('agent install renders the workflows for Copilot and Codex', async () => {
    const h = harness()
    const result = await h.almanac('agent', 'install', '--tool', 'copilot,codex')
    expect(result.code).toBe(0)
    expect(result.stderr).toContain('In Copilot Chat: /almanac-generate')
    expect(result.stderr).toContain('In Codex: $almanac-generate')

    const skill = h.fs.readFile(join(CWD, '.claude/skills/almanac/SKILL.md'))
    expect(skill).toBeUndefined()
    expect(h.fs.readFile(join(CWD, '.github/skills/almanac/SKILL.md'))).toContain('name: almanac')
    const prompt = h.fs.readFile(join(CWD, '.github/prompts/almanac-ask.prompt.md'))
    expect(prompt).toContain('argument-hint: "<question>"\nagent: "agent"\n---\n\nInput: the text typed after the command (may be empty)\n')
    expect(h.fs.readFile(join(CWD, '.github/prompts/almanac-generate.prompt.md'))).toContain('with the `/almanac-verify` prompt')

    expect(h.fs.readFile(join(CWD, '.agents/skills/almanac/SKILL.md'))).toContain('name: almanac')
    const codex = h.fs.readFile(join(CWD, '.agents/skills/almanac-generate/SKILL.md'))
    expect(codex).toMatch(/^---\nname: "almanac-generate"\ndescription: "Build the initial almanac for this codebase from its code\. Use when asked to create/)
    expect(codex).toContain('Input: what the user asked for\n')
    expect(codex).toContain('with the `$almanac-verify` skill')
    for (const file of ['.github/prompts/almanac-verify.prompt.md', '.agents/skills/almanac-verify/SKILL.md', '.agents/skills/almanac-ask/SKILL.md']) {
      expect(h.fs.readFile(join(CWD, file))).not.toContain('$ARGUMENTS')
    }

    const global = await h.almanac('agent', 'install', '--tool', 'copilot', '--global')
    expect(global.stdout).toBe('Wrote ../home/tester/.copilot/skills/almanac/SKILL.md\n')
    expect(global.stderr).toContain('per repository')
    expect((await h.almanac('agent', 'install', '--tool', 'codex', '--global')).stdout).toContain('Wrote ../home/tester/.agents/skills/almanac-ask/SKILL.md')
  })

  it('agent install --ci adds the Copilot pull request checks', async () => {
    const h = harness()
    await h.almanac('agent', 'install', '--tool', 'copilot')
    expect(h.fs.readFile(join(CWD, '.github/workflows/almanac-verify.md'))).toBeUndefined()

    const result = await h.almanac('agent', 'install', '--tool', 'copilot', '--ci')
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('Wrote .github/workflows/almanac-verify.md\nWrote .github/instructions/almanac.instructions.md\n')
    expect(result.stderr).toContain('Run gh aw compile')
    expect(result.stderr).toContain('COPILOT_GITHUB_TOKEN')
    expect(result.stderr).toContain('In .github/instructions/almanac.instructions.md, replace YOUR_SOURCE_GLOBS')

    const workflow = h.fs.readFile(join(CWD, '.github/workflows/almanac-verify.md')) as string
    expect(workflow).toMatch(/^---\ndescription: .*\n[\s\S]*\non:\n {2}pull_request:\n {4}types: \[opened, synchronize\]\n/)
    expect(workflow).toContain('engine: copilot\n')
    expect(workflow).toContain('almanac affected --base origin/${{ github.event.pull_request.base.ref }} --json')
    expect(workflow).toMatch(/\nsafe-outputs:\n {2}add-comment:\n/)
    expect(workflow).not.toMatch(/create-issue:|push-to-pull-request-branch:|create-pull-request:/)

    const instructions = h.fs.readFile(join(CWD, '.github/instructions/almanac.instructions.md')) as string
    expect(instructions).toMatch(/^---\napplyTo: "YOUR_SOURCE_GLOBS,almanac\/\*\*"\n---\n/)
    // Copilot code review reads only the first 4,000 characters of an instructions file.
    expect(instructions.length).toBeLessThan(4000)

    // Installing again keeps the globs the repository chose.
    h.fs.writeFile(join(CWD, '.github/instructions/almanac.instructions.md'), instructions.replace('YOUR_SOURCE_GLOBS', 'app/**'))
    const again = await h.almanac('agent', 'install', '--tool', 'copilot', '--ci')
    expect(again.stdout).toBe('Already up to date.\n')
    expect(again.stderr).toBe('')
    h.fs.writeFile(join(CWD, '.github/workflows/almanac-verify.md'), 'edited')
    const refreshed = await h.almanac('agent', 'install', '--tool', 'copilot', '--ci')
    expect(refreshed.stdout).toBe('Wrote .github/workflows/almanac-verify.md\n')
    expect(refreshed.stderr).toContain('Run gh aw compile')
    expect(refreshed.stderr).not.toContain('YOUR_SOURCE_GLOBS')
    expect(h.fs.readFile(join(CWD, '.github/instructions/almanac.instructions.md'))).toContain('applyTo: "app/**,almanac/**"')

    expect((await h.almanac('agent', 'install', '--tool', 'claude', '--ci')).code).toBe(2)
    expect((await h.almanac('agent', 'install', '--tool', 'copilot', '--ci', '--global')).code).toBe(2)
  })

  it('converts a prose behaviour to Given/When/Then in one patch, as the skill describes', async () => {
    const h = await seeded()
    h.setStdin(JSON.stringify({
      almanac: 1,
      summary: 'Bold formatting in Given/When/Then.',
      ops: [
        { op: 'set', ref: '1.1.1', values: { format: 'gherkin' } },
        { op: 'describe', ref: '1.1.1', description: 'Given text is selected in a note\nWhen the user taps "Bold"\nThen the selection becomes bold' },
      ],
    }))
    expect((await h.almanac('apply', '-')).code).toBe(0)
    expect((await h.almanac('lint')).stdout).toBe('No problems.\n')
    const shown = JSON.stringify((await h.almanac('show', '1.1.1', '--format', 'json')).json())
    expect(shown).toContain('"format":"gherkin"')
    expect(shown).toMatch(/"keyword":"Given".*"keyword":"When".*"keyword":"Then"/)
  })

  it('agent install adds the update workflow', async () => {
    const h = harness()
    await h.almanac('agent', 'install', '--tool', 'claude,codex')
    expect(h.fs.readFile(join(CWD, '.claude/commands/almanac-update.md'))).toContain('almanac affected --files - --json')
    expect(h.fs.readFile(join(CWD, '.agents/skills/almanac-update/SKILL.md'))).toMatch(/^---\nname: "almanac-update"\n/)
  })

  describe('affected', () => {
    const DIFF = 'M\tSources/Editor/Bold.swift\nA\tSources/Settings/Theme.swift\nM\tdocs/notes.md\n'

    async function cited() {
      const h = await seeded()
      h.fs.writeFile(join(ROOT, 'almanac.yaml'), `${h.fs.readFile(join(ROOT, 'almanac.yaml'))}code:\n  path: ..\n`)
      expect((await h.almanac('set', '1.1.1', 'source=Sources/Editor/Bold.swift#toggle')).code).toBe(0)
      return h
    }

    function stubGit(diff: string, calls: string[][] = []) {
      git = (dir, args) => {
        calls.push([dir, ...args])
        if (args[0] === 'rev-parse') return dir === ROOT ? 'almanac/\n' : '\n'
        if (args[0] === 'merge-base') return 'abc123\n'
        if (args[0] === 'ls-files') return 'Sources/Untracked.swift\n'
        return diff
      }
      return calls
    }

    it('lists the behaviours that cite changed files, and the files nothing cites', async () => {
      const h = await cited()
      const calls = stubGit(DIFF)
      const result = await h.almanac('affected', 'main...HEAD')
      expect(result.code).toBe(0)
      expect(calls).toContainEqual([CWD, 'diff', '--name-status', '-M', 'main...HEAD'])
      expect(result.stdout).toContain('main...HEAD: 3 files changed, 3 under the code path.')
      expect(result.stdout).toContain('PD-1.1  Markdown editor\n  PD-1.1.1  Bold formatting\n      modified  Sources/Editor/Bold.swift#toggle')
      expect(result.stdout).toContain('Cited by nothing (2):\n  added     Sources/Settings/Theme.swift\n  modified  docs/notes.md')
      const json = (await h.almanac('--json', 'affected', 'main...HEAD')).json()
      expect(json).toMatchObject({ ok: true, data: { needsUpdate: true, almanacFiles: [], features: [{ ref: 'PD-1.1', behaviours: [{ ref: 'PD-1.1.1' }] }] } })
    })

    it('reads a commit, a branch since its base, or uncommitted work', async () => {
      const h = await cited()
      const calls = stubGit(DIFF)
      await h.almanac('affected', 'abc123')
      expect(calls).toContainEqual([CWD, 'diff-tree', '-r', '--no-commit-id', '--name-status', '-M', '--root', '-m', '--first-parent', 'abc123'])
      const branch = await h.almanac('affected', '--base', 'main')
      expect(calls).toContainEqual([CWD, 'diff', '--name-status', '-M', 'abc123'])
      expect(branch.stdout).toContain('this branch since main: 4 files changed')
      expect(branch.stdout).toContain('added     Sources/Untracked.swift')
      expect((await h.almanac('affected')).stdout).toContain('uncommitted changes: 4 files changed')
      expect((await h.almanac('affected', 'abc123', '--base', 'main')).code).toBe(2)
    })

    it('takes a pull request\u2019s file list on stdin', async () => {
      const h = await cited()
      stubGit('')
      h.setStdin('Sources/Editor/Bold.swift\nalmanac/01-editing/01-markdown-editor.yaml\n')
      const result = await h.almanac('--json', 'affected', '--files', '-', '--check')
      expect(result.code).toBe(0)
      expect(result.json()).toMatchObject({ ok: true, data: { needsUpdate: false, almanacFiles: ['almanac/01-editing/01-markdown-editor.yaml'], uncited: [] } })
    })

    it('--check fails when cited code changed and the almanac did not', async () => {
      const h = await cited()
      stubGit(DIFF)
      const result = await h.almanac('affected', 'main...HEAD', '--check')
      expect(result.code).toBe(1)
      expect(result.stderr).toContain('The change touches code that 1 behaviour cite but no almanac file.')
      stubGit('M\tdocs/notes.md\n')
      expect((await h.almanac('affected', 'main...HEAD', '--check')).code).toBe(0)
    })

    it('relink repoints sources at moved files without changelog entries', async () => {
      const h = await cited()
      const feature = join(ROOT, '01-editing/01-markdown-editor.yaml')
      const before = h.fs.readFile(feature) ?? ''
      stubGit('R100\tSources/Editor/Bold.swift\tSources/Formatting/Bold.swift\nM\tdocs/notes.md\n')
      expect((await h.almanac('affected', 'main...HEAD')).stdout).toContain('renamed   Sources/Editor/Bold.swift#toggle  stale: now Sources/Formatting/Bold.swift (almanac relink)')
      const dry = await h.almanac('--dry-run', 'relink', 'main...HEAD')
      expect(dry.code).toBe(0)
      expect(dry.stdout).toContain('+    source: [Sources/Formatting/Bold.swift#toggle]')
      expect(h.fs.readFile(feature)).toBe(before)

      const result = await h.almanac('relink', 'main...HEAD')
      expect(result.stdout).toContain('PD-1.1.1           source Sources/Editor/Bold.swift#toggle\n                          → Sources/Formatting/Bold.swift#toggle')
      expect(result.stdout).toContain('Repointed 1 entry on 1 feature or behaviour, in 1 file.')
      const after = h.fs.readFile(feature) ?? ''
      expect(after).toContain('source: [Sources/Formatting/Bold.swift#toggle]')
      expect(after.split('- date:').length).toBe(before.split('- date:').length)
      expect((await h.almanac('relink', 'main...HEAD')).stdout).toContain('No source or code entry points at a moved file.')
      // affected now shows the new path the almanac cites, and where the file came from.
      expect((await h.almanac('affected', 'main...HEAD')).stdout).toContain('renamed   Sources/Formatting/Bold.swift#toggle  (was Sources/Editor/Bold.swift)')
    })

    it('says so when git is missing', async () => {
      const h = await cited()
      git = () => {
        throw new Error('not a git repository')
      }
      const result = await h.almanac('affected', 'main...HEAD')
      expect(result.code).toBe(2)
      expect(result.stderr).toContain('not a git repository')
    })
  })
})
