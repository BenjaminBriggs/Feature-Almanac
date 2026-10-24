// Builds the published `feature-almanac` package: one file holding the CLI and the private
// @feature-almanac/* packages, compiled from their sources. Everything else stays an npm dependency.
//
// The layout keeps the asset paths in the sources working unchanged:
//   bundle/bin/almanac.js  agent.ts reads ../../assets/agent/, which is this package's assets/agent/
//   bundle/assets/         render.ts reads ../assets/, so the site's assets are copied here
import { builtinModules } from 'node:module'
import { copyFileSync, cpSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const cli = fileURLToPath(new URL('..', import.meta.url))
const packages = join(cli, '..')
const pkg = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8'))
const WORKSPACE = /^@feature-almanac\/([a-z]+)$/

rmSync(join(cli, 'bundle'), { recursive: true, force: true })

const result = await build({
  entryPoints: [join(cli, 'src', 'bin.ts')],
  outfile: join(cli, 'bundle', 'bin', 'almanac.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  metafile: true,
  logLevel: 'warning',
  plugins: [
    {
      name: 'workspace',
      setup(build) {
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          const workspace = WORKSPACE.exec(args.path)
          if (workspace !== null) return { path: join(packages, workspace[1], 'src', 'index.ts') }
          return { external: true }
        })
      },
    },
  ],
})

cpSync(join(packages, 'site', 'assets'), join(cli, 'bundle', 'assets'), { recursive: true })
copyFileSync(join(packages, '..', 'LICENSE'), join(cli, 'LICENSE'))

// The bundled packages' dependencies have to be this package's, at the same ranges.
const problems = []
const builtins = new Set(builtinModules)
const packageName = (path) => path.split('/').slice(0, path.startsWith('@') ? 2 : 1).join('/')
const imported = new Set(
  Object.values(result.metafile.inputs)
    .flatMap((input) => input.imports)
    .filter((imp) => imp.external && imp.path.startsWith('node:') === false && builtins.has(imp.path) === false)
    .map((imp) => packageName(imp.path)),
)
for (const name of imported) {
  if (pkg.dependencies[name] === undefined) problems.push(`the bundle imports ${name}, which isn't in packages/cli dependencies`)
}
for (const dir of ['schema', 'core', 'site']) {
  const dependencies = JSON.parse(readFileSync(join(packages, dir, 'package.json'), 'utf8')).dependencies ?? {}
  for (const [name, range] of Object.entries(dependencies)) {
    if (WORKSPACE.test(name) || pkg.dependencies[name] === range) continue
    problems.push(`packages/${dir} depends on ${name}@${range}, but packages/cli has ${pkg.dependencies[name] ?? 'nothing'}`)
  }
}
if (problems.length > 0) {
  console.error(problems.map((problem) => `bundle: ${problem}`).join('\n'))
  process.exit(1)
}
