import { changedPaths, commitChanges, parsePatch, planPatch, renderDiff, UsageError } from '@feature-almanac/core'
import type { Command } from 'commander'
import { CliError, EXIT } from '../context.js'
import type { Wrap } from '../program.js'

export function registerApplyCommand(program: Command, wrap: Wrap): void {
  program
    .command('apply')
    .description('Apply a batch of operations atomically (§11 patch format); "-" reads stdin')
    .argument('<patch>', 'patch.json, or - for stdin')
    .action(
      wrap('apply', (ctx, source: string) => {
        const text = source === '-' ? ctx.io.readStdin() : ctx.io.fs.readFile(ctx.path(source))
        if (text === undefined) throw new UsageError(`Cannot read ${source}`)
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch (error) {
          throw new UsageError(`Patch is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
        }
        const patch = parsePatch(json)
        const compilation = ctx.compile()
        const plan = planPatch(compilation, patch, ctx.io.now(), { now: ctx.io.now() })
        const result = commitChanges(compilation, plan.changes, { dryRun: ctx.dryRun, compileOptions: { now: ctx.io.now() } })
        if (result.introduced.length > 0) {
          throw new CliError(EXIT.lint, 'This patch would introduce lint errors; nothing was written', result.introduced)
        }
        const root = compilation.workspace.root
        const files = changedPaths(plan.changes, root)
        if (ctx.dryRun) {
          ctx.out(renderDiff(plan.changes, root))
        } else {
          for (const item of plan.created) ctx.out(`Added ${item.level} ${item.id}${item.as === undefined ? '' : ` (${item.as})`}`)
          ctx.out(`Wrote ${files.length} file${files.length === 1 ? '' : 's'}`)
        }
        ctx.envelope(true, { created: plan.created, files, dryRun: ctx.dryRun })
        return EXIT.ok
      }),
    )
}
