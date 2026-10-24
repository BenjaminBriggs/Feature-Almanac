// Packs this package, installs the tarball the way `npm install -g` and the Homebrew formula do,
// and runs the installed `almanac` through the commands that read files shipped beside the bundle.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('..', import.meta.url))
const repo = join(cli, '..', '..')
const { version } = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'almanac-smoke-'))
const prefix = join(work, 'prefix')
const app = join(work, 'app')

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const almanac = (args, cwd = app) => sh(join(prefix, 'bin', 'almanac'), args, cwd)
const step = (text) => console.log(`smoke: ${text}`)

step(`packing feature-almanac ${version}`)
sh('npm', ['pack', '--pack-destination', work], cli)
const tarball = join(work, readdirSync(work).find((file) => file.endsWith('.tgz')))

step(`installing ${tarball}`)
sh('npm', ['install', '--global', '--prefix', prefix, '--no-audit', '--no-fund', tarball], work)

const printed = almanac(['--version'], work).trim()
if (printed !== version) throw new Error(`almanac --version printed ${printed}, expected ${version}`)

step('building the site for this repository’s almanac')
almanac(['--root', join(repo, 'almanac'), 'site', 'build', '--out', join(work, 'site')], work)
if (existsSync(join(work, 'site', 'index.html')) === false) throw new Error('site build wrote no index.html')

step('creating an almanac and installing the agent files')
mkdirSync(app)
sh('git', ['init', '--quiet'], app)
almanac(['init', '--product', 'Smoke', '--prefix', 'SM', '--platforms', 'ios'])
almanac(['lint'])
almanac(['agent', 'install', '--tool', 'claude,copilot,codex', '--ci'])

rmSync(work, { recursive: true, force: true })
step('passed')
