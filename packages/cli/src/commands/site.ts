import { join, relative, sep } from 'node:path'
import { compile, countDiagnostics, loadWorkspace, projectDir, type Compilation } from '@feature-almanac/core'
import { buildSite, siteOptions, startDevServer } from '@feature-almanac/site'
import type { Command } from 'commander'
import { CliError, EXIT, type Context } from '../context.js'
import type { Wrap } from '../program.js'

export function registerSiteCommands(program: Command, wrap: Wrap): void {
  const site = program.command('site').description('Build and serve the website (§14)')

  site
    .command('build')
    .description('Write the static site (default dist/site/ beside the almanac)')
    .option('--out <dir>', 'output folder')
    .action(
      wrap('site build', (ctx, options: { out?: string }) => {
        const root = ctx.root()
        const compilation = compileForSite(ctx, root)
        const files = siteFiles(ctx, compilation, false)
        const out = options.out !== undefined ? ctx.path(options.out) : join(projectDir(root), 'dist', 'site')
        if (ctx.dryRun === false) for (const [name, content] of Object.entries(files)) ctx.io.fs.writeFile(join(out, name), content)
        const { errors, warnings } = countDiagnostics(compilation.diagnostics)
        ctx.diagnostics(compilation.diagnostics)
        ctx.out(`${ctx.dryRun ? 'Would write' : 'Wrote'} ${display(ctx, join(out, 'index.html'))} (${errors} errors, ${warnings} warnings)`)
        ctx.envelope(errors === 0, { out, files: Object.keys(files), dryRun: ctx.dryRun }, compilation.diagnostics)
        return errors > 0 ? EXIT.lint : EXIT.ok
      }),
    )

  site
    .command('serve')
    .description('Serve the site locally and reload it whenever an almanac file changes')
    .option('--port <port>', 'port', '4173')
    .option('--open', 'open it in the browser')
    .action(
      wrap('site serve', async (ctx, options: { port: string; open?: boolean }) => {
        const root = ctx.root()
        const port = Number(options.port)
        if (Number.isInteger(port) === false || port < 0 || port > 65535) throw new CliError(EXIT.usage, `Invalid port "${options.port}"`)
        let last: Compilation | undefined
        const server = await startDevServer({
          port,
          watch: (onChange) => ctx.io.watch(root, onChange),
          build: () => {
            last = compileForSite(ctx, root)
            return siteFiles(ctx, last, true)
          },
          onRebuild: (error) => {
            if (error !== undefined) {
              ctx.io.stderr(`rebuild failed: ${error instanceof Error ? error.message : String(error)}\n`)
              return
            }
            const { errors, warnings } = countDiagnostics(last?.diagnostics ?? [])
            ctx.note(`rebuilt (${errors} errors, ${warnings} warnings)`)
          },
        })
        ctx.diagnostics(last?.diagnostics ?? [], 'stderr')
        ctx.out(`Serving ${server.url} — watching ${display(ctx, root)}; Ctrl-C to stop`)
        ctx.envelope(true, { url: server.url })
        if (options.open === true) ctx.io.openUrl(server.url)
        await ctx.io.waitForExit()
        await server.close()
        return EXIT.ok
      }),
    )
}

function compileForSite(ctx: Context, root: string): Compilation {
  const workspace = loadWorkspace(root, ctx.io.fs)
  const gitRef = ctx.io.gitRef(root)
  return compile(workspace, { now: ctx.io.now(), ...(gitRef !== undefined ? { gitRef } : {}) })
}

function siteFiles(ctx: Context, compilation: Compilation, liveReload: boolean): Record<string, string> {
  const model = ctx.model(compilation)
  const raw = compilation.config?.data.site
  const options = siteOptions(model, raw)
  return buildSite(model, liveReload ? { ...options, liveReload } : options)
}

function display(ctx: Context, path: string): string {
  const fromCwd = relative(ctx.io.cwd, path).split(sep).join('/')
  return fromCwd.startsWith('..') ? path : fromCwd === '' ? '.' : fromCwd
}
