import { join, relative, sep } from 'node:path'
import { applyChanges, changedPaths, compile, countDiagnostics, diffSnapshots, fixWorkspace, planFormat, projectDir, renderDiff, snapshot } from '@feature-almanac/core'
import type { Command } from 'commander'
import { CliError, EXIT, type Context } from '../context.js'
import type { Wrap } from '../program.js'

export function registerCheckCommands(program: Command, wrap: Wrap): void {
  program
    .command('lint')
    .description('Validate the almanac (§10); exits 1 on errors, or on warnings with --strict')
    .option('--strict', 'fail on warnings too')
    .option('--require-source', 'warn about behaviours without source (ALM-W011)')
    .option('--against <git-ref>', 'compare with a git ref (ALM-E020, ALM-E021, ALM-W020)')
    .option('--fix', 'apply safe fixes: formatting, file names, ID counters')
    .action(
      wrap('lint', (ctx, options: { strict?: boolean; requireSource?: boolean; against?: string; fix?: boolean }) => {
        if (options.against !== undefined) {
          throw new CliError(EXIT.usage, '--against needs git history support, which arrives in v0.3')
        }
        const compileOptions = { now: ctx.io.now(), requireSource: options.requireSource === true }
        const root = ctx.root()
        let fixed: string[] = []
        if (options.fix === true) {
          if (ctx.dryRun) {
            const before = snapshot(ctx.io.fs, root)
            const after = snapshot(ctx.io.fs, root)
            fixed = fixWorkspace(after, root, compileOptions)
            ctx.out(diffSnapshots(before, after, root))
          } else {
            fixed = fixWorkspace(ctx.io.fs, root, compileOptions)
          }
        }
        const compilation = ctx.compile(compileOptions)
        const { errors, warnings } = countDiagnostics(compilation.diagnostics)
        const failed = errors > 0 || (options.strict === true && warnings > 0)
        ctx.diagnostics(compilation.diagnostics)
        if (fixed.length > 0 && ctx.dryRun === false) ctx.note(`Fixed ${fixed.join(', ')}`)
        ctx.out(errors + warnings === 0 ? 'No problems.' : `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`)
        ctx.envelope(failed === false, { errors, warnings, fixed }, compilation.diagnostics)
        return failed ? EXIT.lint : EXIT.ok
      }),
    )

  program
    .command('fmt')
    .description('Normalise key order, quoting, block scalars, behaviour order and file names')
    .option('--check', 'list files that would change and exit 1 if any')
    .action(
      wrap('fmt', (ctx, options: { check?: boolean }) => {
        const workspace = ctx.workspace()
        const plan = planFormat(workspace)
        const files = changedPaths(plan.changes, workspace.root)
        for (const skipped of plan.skipped) ctx.note(`skipped ${skipped}: it does not parse (see almanac lint)`)
        if (options.check === true) {
          for (const file of files) ctx.out(`would reformat ${file}`)
          if (files.length === 0) ctx.out('All files formatted.')
          ctx.envelope(files.length === 0, { changed: files, skipped: plan.skipped })
          return files.length === 0 ? EXIT.ok : EXIT.lint
        }
        if (ctx.dryRun) ctx.out(renderDiff(plan.changes, workspace.root))
        else {
          applyChanges(ctx.io.fs, plan.changes)
          ctx.out(files.length === 0 ? 'All files formatted.' : `Formatted ${plural(files.length, 'file')}: ${files.join(', ')}`)
        }
        ctx.envelope(true, { changed: files, skipped: plan.skipped, dryRun: ctx.dryRun })
        return EXIT.ok
      }),
    )

  program
    .command('build')
    .description('Write almanac.json (§12)')
    .option('--out <path>', 'output file (default: dist/almanac.json beside the almanac)')
    .action(
      wrap('build', (ctx, options: { out?: string }) => {
        const workspace = ctx.workspace()
        const gitRef = ctx.io.gitRef(workspace.root)
        const compilation = compile(workspace, { now: ctx.io.now(), ...(gitRef !== undefined ? { gitRef } : {}) })
        const model = ctx.model(compilation)
        const out = options.out !== undefined ? ctx.path(options.out) : join(projectDir(workspace.root), 'dist', 'almanac.json')
        if (ctx.dryRun === false) ctx.io.fs.writeFile(out, `${JSON.stringify(model, null, 2)}\n`)
        const features = model.categories.flatMap((category) => category.features)
        const counts = {
          categories: model.categories.length,
          features: features.length,
          behaviours: features.reduce((sum, feature) => sum + feature.behaviours.length, 0),
        }
        const { errors, warnings } = countDiagnostics(compilation.diagnostics)
        ctx.diagnostics(compilation.diagnostics)
        const fromCwd = relative(ctx.io.cwd, out).split(sep).join('/')
        const display = fromCwd.startsWith('..') ? out : fromCwd
        ctx.out(
          `${ctx.dryRun ? 'Would write' : 'Wrote'} ${display}: ${plural(counts.categories, 'category', 'categories')}, ` +
            `${plural(counts.features, 'feature')}, ${plural(counts.behaviours, 'behaviour')} ` +
            `(${plural(errors, 'error')}, ${plural(warnings, 'warning')})`,
        )
        ctx.envelope(errors === 0, { out, ...counts, dryRun: ctx.dryRun }, compilation.diagnostics)
        return errors > 0 ? EXIT.lint : EXIT.ok
      }),
    )
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
