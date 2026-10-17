import { join } from 'node:path'
import { changedPaths, commitChanges, parsePatch, planPatch, planRelink, renderDiff, type FileSystem, type RelinkPlan } from '@feature-almanac/core'
import type { Command } from 'commander'
import { CliError, EXIT } from '../context.js'
import type { Wrap } from '../program.js'
import { changeArguments, resolveChange, type ChangeOptions } from './change.js'

export function registerRelinkCommand(program: Command, wrap: Wrap): void {
  changeArguments(program.command('relink').description('Repoint source and code paths at files a change renamed or moved; no changelog entries'))
    .action(
      wrap('relink', (ctx, change: string | undefined, options: ChangeOptions) => {
        const compilation = ctx.compile()
        const model = ctx.model(compilation)
        const { label, codeFiles, codeDir } = resolveChange(ctx, compilation, change, options)
        const plan = planRelink(model, codeFiles, (folder) => hasFiles(ctx.io.fs, join(codeDir, folder)))
        const renamed = codeFiles.filter((file) => file.status === 'renamed').length

        let files: string[] = []
        if (plan.ops.length > 0) {
          // Moving a file changes nothing a user sees, so the patch writes no changelog entries.
          const patch = parsePatch({ almanac: 1, summary: 'Source paths follow renamed files.', changelog: 'none', ops: plan.ops })
          const patchPlan = planPatch(compilation, patch, ctx.io.now(), { now: ctx.io.now() })
          const result = commitChanges(compilation, patchPlan.changes, { dryRun: ctx.dryRun, compileOptions: { now: ctx.io.now() } })
          if (result.introduced.length > 0) throw new CliError(EXIT.lint, 'Repointing would introduce lint errors; nothing was written', result.introduced)
          files = changedPaths(patchPlan.changes, compilation.workspace.root)
          if (ctx.dryRun) ctx.out(renderDiff(patchPlan.changes, compilation.workspace.root))
        }
        if (ctx.dryRun === false || plan.ops.length === 0) ctx.out(report(label, renamed, plan, files.length, ctx.dryRun))
        ctx.envelope(true, { change: label, renamed, repointed: plan.repoints, unresolved: plan.unresolved, files, dryRun: ctx.dryRun })
        return EXIT.ok
      }),
    )
}

/** True when the folder still holds a file somewhere below it. */
function hasFiles(fs: FileSystem, dir: string): boolean {
  if (fs.isDirectory(dir) === false) return false
  return fs.listDir(dir).some((name) => {
    const path = join(dir, name)
    return fs.isDirectory(path) ? hasFiles(fs, path) : true
  })
}

function report(label: string, renamed: number, plan: RelinkPlan, written: number, dryRun: boolean): string {
  const lines = [`${label}: ${plural(renamed, 'file')} renamed or moved under the code path.`]
  if (plan.repoints.length === 0) lines.push('', 'No source or code entry points at a moved file.')
  else {
    const entities = new Set(plan.repoints.map((repoint) => repoint.ref)).size
    lines.push('')
    for (const repoint of plan.repoints) lines.push(`${repoint.ref.padEnd(18)} ${repoint.field.padEnd(6)} ${repoint.from}\n${' '.repeat(26)}→ ${repoint.to}`)
    lines.push('', `${dryRun ? 'Would repoint' : 'Repointed'} ${plural(plan.repoints.length, 'entry', 'entries')} on ${plural(entities, 'feature or behaviour', 'features and behaviours')}${dryRun ? '' : `, in ${plural(written, 'file')}`}.`)
  }
  if (plan.unresolved.length > 0) {
    lines.push('', `Left for you (${plan.unresolved.length}):`)
    for (const item of plan.unresolved) lines.push(`  ${item.ref.padEnd(18)} ${item.field.padEnd(6)} ${item.entry}: ${item.reason}`)
  }
  return lines.join('\n')
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}
