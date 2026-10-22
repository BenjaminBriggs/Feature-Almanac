import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nodeIo, run } from '../src/index.js'

/** `affected` against a real git repository, for what a stub can't show: merges, untracked files, prefixes. */
describe('almanac affected with git', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'almanac-git-'))
    dirs.push(dir)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString()
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    git('config', 'commit.gpgsign', 'false')
    const write = (path: string, content: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), content)
    }
    const almanac = async (...argv: string[]) => {
      let stdout = ''
      let stderr = ''
      const io = { ...nodeIo(), cwd: dir, env: {}, isTTY: false, stdout: (text: string) => void (stdout += text), stderr: (text: string) => void (stderr += text) }
      const code = await run(argv, io)
      return { code, stdout, stderr }
    }
    const commit = (message: string) => {
      git('add', '-A')
      git('commit', '-q', '-m', message)
    }
    return { dir, git, write, almanac, commit }
  }

  /** An almanac whose one behaviour cites `source`, with code.path set to `codePath`. */
  async function seed(r: ReturnType<typeof repo>, codePath: string, source: string, ...init: string[]) {
    expect((await r.almanac('init', '--prefix', 'PD', '--platforms', 'cli', ...init)).code).toBe(0)
    expect((await r.almanac('add', 'category', '--name', 'Saving', '--description', 'Saving work.')).code).toBe(0)
    expect((await r.almanac('add', 'feature', '--category', '1', '--name', 'Autosave', '--description', 'Saves as you type.', '--owner', 'ben', '--status', 'shipped')).code).toBe(0)
    expect((await r.almanac('add', 'behaviour', '--feature', '1.1', '--name', 'Idle save', '--format', 'prose', '--description', 'Saves after a second of quiet.')).code).toBe(0)
    expect((await r.almanac('set', '1.1.1', `source=${source}`)).code).toBe(0)
    const config = init.includes('--standalone') ? 'almanac.yaml' : 'almanac/almanac.yaml'
    r.write(config, `${readFileSync(join(r.dir, config), 'utf8')}code:\n  path: ${codePath}\n`)
  }

  it('lists a merge commit against its first parent, each file once', async () => {
    const r = repo()
    await seed(r, '..', 'src/save.ts')
    r.write('src/save.ts', 'one\n')
    r.write('src/other.ts', 'one\n')
    r.commit('init')
    r.git('checkout', '-q', '-b', 'feature')
    r.write('src/save.ts', 'feature\n')
    r.commit('feature')
    r.git('checkout', '-q', 'main')
    r.write('src/save.ts', 'main\n')
    r.write('src/other.ts', 'main\n')
    r.commit('main')
    try {
      r.git('merge', '-q', 'feature', '-m', 'merge')
    } catch {
      // Both sides changed save.ts: resolve the conflict.
    }
    r.write('src/save.ts', 'merged\n')
    r.commit('merge')

    const result = await r.almanac('affected', 'HEAD')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('HEAD: 1 file changed, 1 under the code path.')
    expect(result.stdout).toContain('modified  src/save.ts')
    expect(result.stdout).not.toContain('src/other.ts')
  })

  it('counts untracked files outside the code path, new almanac files included', async () => {
    const r = repo()
    await seed(r, '../src', 'save.ts')
    r.write('src/save.ts', 'one\n')
    r.commit('init')
    r.write('src/save.ts', 'two\n')
    r.write('notes.md', 'new\n')
    expect((await r.almanac('affected', '--check')).code).toBe(1)

    expect((await r.almanac('add', 'feature', '--category', '1', '--name', 'Backups', '--description', 'Keeps old copies.', '--owner', 'ben', '--status', 'shipped')).code).toBe(0)
    const result = await r.almanac('affected', '--check')
    expect(result.stdout).toContain('uncommitted changes: 4 files changed, 1 under the code path.')
    expect(result.stdout).toContain('The change also edits 2 almanac files.')
    expect(result.code).toBe(0)
  })

  it('tells almanac files from code when the almanac is the top of the repository', async () => {
    const r = repo()
    await seed(r, '.', 'src/save.ts', '--standalone')
    r.write('src/save.ts', 'one\n')
    r.commit('init')
    r.write('src/save.ts', 'two\n')

    const result = await r.almanac('affected', '--check')
    expect(result.stdout).toContain('uncommitted changes: 1 file changed, 1 under the code path.')
    expect(result.stdout).toContain('PD-1.1.1  Idle save')
    expect(result.code).toBe(1)

    expect((await r.almanac('set', '1.1.1', 'tags=quiet')).code).toBe(0)
    const updated = await r.almanac('affected', '--check')
    expect(updated.stdout).toContain('uncommitted changes: 2 files changed, 1 under the code path.')
    expect(updated.stdout).toContain('The change also edits 1 almanac file.')
    expect(updated.code).toBe(0)
  })
})
