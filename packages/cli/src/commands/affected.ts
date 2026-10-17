import { affectedBy, type Affected, type ChangedFile } from '@feature-almanac/core'
import type { Command } from 'commander'
import { EXIT } from '../context.js'
import type { Wrap } from '../program.js'
import { changeArguments, resolveChange, type ChangeOptions } from './change.js'

export function registerAffectedCommand(program: Command, wrap: Wrap): void {
  changeArguments(program.command('affected').description('List the features and behaviours a code change touches, by the files their source and code cite'))
    .option('--check', 'exit 1 when the change touches code that behaviours cite but leaves the almanac alone (for CI)')
    .action(
      wrap('affected', (ctx, change: string | undefined, options: ChangeOptions & { check?: boolean }) => {
        const compilation = ctx.compile()
        const model = ctx.model(compilation)
        const { label, total, codeFiles, almanacFiles } = resolveChange(ctx, compilation, change, options)
        const result = affectedBy(model, codeFiles)
        const behaviours = result.features.reduce((sum, feature) => sum + feature.behaviours.length, 0)
        const stale = result.features.length > 0 && almanacFiles.length === 0

        ctx.out(report(label, total, codeFiles.length, almanacFiles.length, result))
        if (options.check === true && stale) {
          ctx.note(`The change touches code that ${plural(behaviours, 'behaviour')} cite but no almanac file. Update the almanac in the same change (almanac agent install adds an update workflow).`)
        }
        ctx.envelope(options.check !== true || stale === false, {
          change: label,
          files: codeFiles,
          outside: total - codeFiles.length - almanacFiles.length,
          almanacFiles,
          features: result.features,
          uncited: result.uncited,
          needsUpdate: stale,
        })
        return options.check === true && stale ? EXIT.lint : EXIT.ok
      }),
    )
}

function report(label: string, total: number, underCode: number, almanac: number, result: Affected): string {
  const lines = [`${label}: ${plural(total, 'file')} changed, ${underCode} under the code path.`]
  if (result.features.length === 0 && result.uncited.length === 0) lines.push('', 'No behaviour or feature cites a changed file.')
  for (const feature of result.features) {
    lines.push('', `${feature.ref}  ${feature.name}`)
    for (const behaviour of feature.behaviours) {
      lines.push(`  ${behaviour.ref}  ${behaviour.name}`)
      for (const citation of behaviour.citations) lines.push(`      ${citationLine(citation)}${citation.variant !== undefined ? `  (variant ${citation.variant})` : ''}`)
    }
    if (feature.code.length > 0) {
      lines.push('  feature code')
      for (const citation of feature.code) lines.push(`      ${citationLine(citation)}`)
    }
  }
  if (result.uncited.length > 0) {
    lines.push('', `Cited by nothing (${result.uncited.length}):`)
    for (const file of result.uncited) lines.push(`  ${fileLine(file)}`)
  }
  if (almanac > 0) lines.push('', `The change also edits ${plural(almanac, 'almanac file')}.`)
  return lines.join('\n')
}

/**
 * The changed file, then the symbol the entry names (`#save`), or the folder or glob that matched it. A renamed
 * file shows the path the entry cites: the new one with where it came from, or the old one flagged for relink.
 */
function citationLine(citation: { entry: string; file: ChangedFile; stale?: true }): string {
  const target = citation.entry.split('#')[0] as string
  const { file } = citation
  const exact = target === file.path || target === file.from
  const via = exact ? citation.entry.slice(target.length) : `  via ${citation.entry}`
  if (file.status !== 'renamed' || file.from === undefined) return `${fileLine(file)}${via}`
  if (citation.stale === true) return `${'renamed'.padEnd(9)} ${file.from}${via}  stale: now ${file.path} (almanac relink)`
  return `${'renamed'.padEnd(9)} ${file.path}${via}  (was ${file.from})`
}

function fileLine(file: ChangedFile): string {
  const path = file.status === 'renamed' && file.from !== undefined ? `${file.from} → ${file.path}` : file.path
  return `${file.status.padEnd(9)} ${path}`
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}
