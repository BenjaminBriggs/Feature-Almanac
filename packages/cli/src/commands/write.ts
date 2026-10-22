import { join, relative, sep } from 'node:path'
import {
  addBehaviour,
  addCategory,
  addChangelogEntry,
  addFeature,
  addVariant,
  applyChanges,
  changedPaths,
  commitChanges,
  describeEntity,
  lookup,
  moveEntity,
  parseAssignments,
  parseChange,
  planInit,
  projectDir,
  removeEntity,
  renameEntity,
  renderDiff,
  setValues,
  UsageError,
  type Compilation,
  type Mutation,
} from '@feature-almanac/core'
import type { Command } from 'commander'
import { CliError, EXIT, parseList, type Context } from '../context.js'
import type { Wrap } from '../program.js'

interface DescriptionOptions {
  description?: string
  descriptionFile?: string
}

export function registerWriteCommands(program: Command, wrap: Wrap): void {
  program
    .command('init')
    .description('Create almanac.yaml (in almanac/ unless --standalone)')
    .option('--product <name>', 'product name (default: the folder name)')
    .option('--prefix <prefix>', 'reference prefix, e.g. PD for PD-1.2.3')
    .option('--platforms <list>', 'comma-separated platform tags, e.g. ios,android')
    .option('--standalone', 'the current folder is the almanac root')
    .action(
      wrap('init', (ctx, options: { product?: string; prefix?: string; platforms?: string; standalone?: boolean }) => {
        const root =
          ctx.globals.root !== undefined ? ctx.path(ctx.globals.root) : options.standalone === true ? ctx.io.cwd : join(ctx.io.cwd, 'almanac')
        const project = projectDir(root)
        const changes = planInit({
          fs: ctx.io.fs,
          root,
          product: options.product ?? project.split(sep).pop() ?? 'Product',
          ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
          platforms: parseList(options.platforms) ?? [],
        })
        const files = changedPaths(changes, ctx.io.cwd)
        if (ctx.dryRun) {
          ctx.out(renderDiff(changes, ctx.io.cwd))
        } else {
          applyChanges(ctx.io.fs, changes)
          ctx.out(`Created ${files.join(', ')}`)
          ctx.note('Next: almanac add category --name <name> --description <text>')
        }
        ctx.envelope(true, { root, files, dryRun: ctx.dryRun })
      }),
    )

  const add = program.command('add').description('Add a category, feature, behaviour or variant')

  add
    .command('category')
    .description('New category with the next free ID')
    .requiredOption('--name <name>', 'category name')
    .requiredOption('--description <text>', 'one-paragraph description')
    .option('--owner <owner>', 'owner key or free text')
    .action(
      wrap('add category', (ctx, options: { name: string; description: string; owner?: string }) => {
        const compilation = ctx.compile()
        const mutation = addCategory(compilation, {
          name: options.name,
          description: options.description,
          ...(options.owner !== undefined ? { owner: options.owner } : {}),
        })
        return commit(ctx, compilation, mutation, 'category')
      }),
    )

  add
    .command('feature')
    .description('New feature file in a category, with a changelog entry')
    .requiredOption('--category <N>', 'category ID')
    .requiredOption('--name <name>', 'feature name')
    .requiredOption('--description <text>', 'one-line summary (≤ 280 characters)')
    .requiredOption('--owner <owner>', 'owner key')
    .option('--platforms <list>', 'platforms, groups or !exclusions (default: all)')
    .option('--status <status>', 'status (default: the first in statuses)')
    .action(
      wrap(
        'add feature',
        (ctx, options: { category: string; name: string; description: string; owner: string; platforms?: string; status?: string }) => {
          const compilation = ctx.compile()
          const platforms = parseList(options.platforms)
          const mutation = addFeature(compilation, {
            category: options.category,
            name: options.name,
            description: options.description,
            owner: options.owner,
            ...(platforms !== undefined ? { platforms } : {}),
            ...(options.status !== undefined ? { status: options.status } : {}),
            now: ctx.io.now(),
          })
          return commit(ctx, compilation, mutation, 'feature')
        },
      ),
    )

  add
    .command('behaviour')
    .description('Append a behaviour to a feature; "-" reads the description from stdin')
    .argument('[stdin]', '"-" to read the description from stdin')
    .requiredOption('--feature <N.M>', 'feature ID')
    .requiredOption('--name <name>', 'behaviour name')
    .option('--platforms <list>', 'platforms, groups or !exclusions (default: the feature’s)')
    .option('--format <format>', 'description format (default: formats.default)')
    .option('--source <path>', 'cited code, path[#symbol]; repeatable', collect, [])
    .option('--description <text>', 'description (Markdown)')
    .option('--description-file <path>', 'read the description from a file')
    .action(
      wrap(
        'add behaviour',
        (
          ctx,
          stdin: string | undefined,
          options: DescriptionOptions & { feature: string; name: string; platforms?: string; format?: string; source: string[] },
        ) => {
          const description = readDescription(ctx, options, stdin)
          const compilation = ctx.compile()
          const platforms = parseList(options.platforms)
          const mutation = addBehaviour(compilation, {
            feature: options.feature,
            name: options.name,
            description,
            ...(platforms !== undefined ? { platforms } : {}),
            ...(options.format !== undefined ? { format: options.format } : {}),
            source: options.source,
            now: ctx.io.now(),
          })
          return commit(ctx, compilation, mutation, 'behaviour')
        },
      ),
    )

  add
    .command('variant')
    .description('Add a platform carve-out to a behaviour')
    .argument('<ref>', 'behaviour ID (N.M.K)')
    .argument('[stdin]', '"-" to read the description from stdin')
    .requiredOption('--platforms <list>', 'platforms or groups the variant covers')
    .option('--mode <mode>', 'append (default) or replace')
    .option('--description <text>', 'description (Markdown)')
    .option('--description-file <path>', 'read the description from a file')
    .action(
      wrap('add variant', (ctx, ref: string, stdin: string | undefined, options: DescriptionOptions & { platforms: string; mode?: string }) => {
        if (options.mode !== undefined && options.mode !== 'append' && options.mode !== 'replace') {
          throw new UsageError(`--mode must be append or replace, got "${options.mode}"`)
        }
        const description = readDescription(ctx, options, stdin)
        const compilation = ctx.compile()
        const mutation = addVariant(compilation, {
          behaviour: ref,
          platforms: parseList(options.platforms) ?? [],
          ...(options.mode !== undefined ? { mode: options.mode } : {}),
          description,
          now: ctx.io.now(),
        })
        return commit(ctx, compilation, mutation, 'variant')
      }),
    )

  program
    .command('set')
    .description('Set fields on an entity, e.g. status=shipped status.android=planned tags=a,b; an empty value unsets')
    .argument('<ref>', 'ID or reference')
    .argument('<assignments...>', 'key=value pairs: status, status.<platform>, since.<platform>, platforms, source, tags, owner, fields.<key>, …')
    .option('--summary <text>', 'changelog summary (default: generated)')
    .action(
      wrap('set', (ctx, ref: string, assignments: string[], options: EditFlags) => {
        const compilation = ctx.compile()
        const mutation = setValues(compilation, { ref, values: parseAssignments(assignments), ...edit(ctx, options) })
        return commitEdit(ctx, compilation, mutation, (id, name) => `Updated ${id} ${name}`, 'these values')
      }),
    )

  program
    .command('describe')
    .description('Replace the description of an entity (or a feature’s overview); "-" reads it from stdin')
    .argument('<ref>', 'ID or reference')
    .argument('[stdin]', '"-" to read the text from stdin')
    .option('--description <text>', 'the new text')
    .option('--description-file <path>', 'read the new text from a file')
    .option('--overview', 'replace a feature’s overview instead of its description')
    .option('--summary <text>', 'changelog summary (default: generated)')
    .action(
      wrap('describe', (ctx, ref: string, stdin: string | undefined, options: DescriptionOptions & EditFlags & { overview?: boolean }) => {
        const text = readDescription(ctx, options, stdin)
        const compilation = ctx.compile()
        const mutation = describeEntity(compilation, {
          ref,
          ...(options.overview === true ? { overview: text } : { description: text }),
          ...edit(ctx, options),
        })
        return commitEdit(ctx, compilation, mutation, (id, name) => `Described ${id} ${name}`, 'this description')
      }),
    )

  program
    .command('rename')
    .description('Rename a category, feature or behaviour; folders and files follow the name')
    .argument('<ref>', 'ID or reference')
    .requiredOption('--name <name>', 'the new name')
    .option('--summary <text>', 'changelog summary (default: generated)')
    .action(
      wrap('rename', (ctx, ref: string, options: EditFlags & { name: string }) => {
        const compilation = ctx.compile()
        const mutation = renameEntity(compilation, { ref, name: options.name, ...edit(ctx, options) })
        return commitEdit(ctx, compilation, mutation, (id, name) => `Renamed ${id} to ${name}`, 'this rename')
      }),
    )

  program
    .command('remove')
    .description('Tombstone an entity: status removed plus removed_reason. IDs are never deleted or reused')
    .argument('<ref>', 'ID or reference, including variants (1.2.3@android)')
    .requiredOption('--reason <text>', 'why it was removed')
    .option('--summary <text>', 'changelog summary (default: generated)')
    .action(
      wrap('remove', (ctx, ref: string, options: EditFlags & { reason: string }) => {
        const compilation = ctx.compile()
        const mutation = removeEntity(compilation, { ref, reason: options.reason, ...edit(ctx, options) })
        return commitEdit(ctx, compilation, mutation, (id, name) => `Removed ${id} ${name}`, 'this removal')
      }),
    )

  program
    .command('mv')
    .description('Move a feature to another category or a behaviour to another feature; the old ID goes to formerly')
    .argument('<ref>', 'feature (N.M) or behaviour (N.M.K) ID')
    .requiredOption('--to <parent>', 'the new parent: a category for a feature, a feature for a behaviour')
    .option('--summary <text>', 'changelog summary (default: generated)')
    .action(
      wrap('mv', (ctx, ref: string, options: EditFlags & { to: string }) => {
        const compilation = ctx.compile()
        // moveEntity first: it refuses a broken almanac.yaml, which lookup would report as a missing entity.
        const mutation = moveEntity(compilation, { ref, to: options.to, ...edit(ctx, options) })
        const from = lookup(compilation, ref).target
        const fromId = from.kind === 'feature' ? from.feature.model.id : from.kind === 'behaviour' ? from.behaviour.model.id : ref
        return commitEdit(ctx, compilation, mutation, (id, name) => `Moved ${fromId} → ${id} ${name}`, 'this move', { from: fromId })
      }),
    )

  const changelog = program.command('changelog').description('Feature changelogs')

  changelog
    .command('add')
    .description('Prepend a changelog entry to a feature, e.g. --change modified:1.2.3 --change removed:1.2.4')
    .argument('<feature>', 'feature ID (N.M)')
    .requiredOption('--summary <text>', 'one-line summary')
    .option('--change <kind:ref>', 'added|modified|removed:<ref>, moved:<from>:<to> or feature:added|modified|removed; repeatable', collect, [])
    .option('--release <version>', 'the version the change ships in (the entry’s version; --version is taken)')
    .option('--ticket <id>', 'ticket ID or URL')
    .option('--author <name>', 'author')
    .option('--platforms <list>', 'platforms the entry applies to')
    .action(
      wrap(
        'changelog add',
        (ctx, feature: string, options: { summary: string; change: string[]; release?: string; ticket?: string; author?: string; platforms?: string }) => {
          const compilation = ctx.compile()
          const platforms = parseList(options.platforms)
          const mutation = addChangelogEntry(compilation, {
            feature,
            summary: options.summary,
            changes: options.change.map((change) => parseChange(compilation, change)),
            ...(options.release !== undefined ? { version: options.release } : {}),
            ...(options.ticket !== undefined ? { ticket: options.ticket } : {}),
            ...(options.author !== undefined ? { author: options.author } : {}),
            ...(platforms !== undefined ? { platforms } : {}),
            now: ctx.io.now(),
          })
          return commitEdit(ctx, compilation, mutation, (id, name) => `Added a changelog entry to ${id} ${name}`, 'this changelog entry')
        },
      ),
    )
}

interface EditFlags {
  summary?: string
}

function edit(ctx: Context, options: EditFlags): { summary?: string; now: Date } {
  return { ...(options.summary !== undefined ? { summary: options.summary } : {}), now: ctx.io.now() }
}

/** Like `commit`, for edits of existing entities: prints `line(id, name)` and the file. */
function commitEdit(
  ctx: Context,
  compilation: Compilation,
  mutation: Mutation,
  line: (id: string, name: string) => string,
  what: string,
  extra: Record<string, unknown> = {},
): number {
  const root = compilation.workspace.root
  const result = commitChanges(compilation, mutation.changes, { dryRun: ctx.dryRun, compileOptions: { now: ctx.io.now() } })
  if (result.introduced.length > 0) {
    throw new CliError(EXIT.lint, `Writing ${what} would introduce lint errors; nothing was written`, result.introduced)
  }
  const { target } = lookup(result.after, mutation.id)
  const model = modelOf(target)
  const files = changedPaths(mutation.changes, root)
  ctx.redirects(mutation.redirects)
  if (ctx.dryRun) {
    ctx.out(renderDiff(mutation.changes, root))
  } else {
    const name = 'name' in model ? model.name : ''
    ctx.out(`${line(mutation.id, name).trimEnd()} (${relative(root, mutation.file).split(sep).join('/')})`)
  }
  ctx.envelope(true, { kind: target.kind, ...extra, id: mutation.id, entity: model, changelog: mutation.changelog ?? [], files, dryRun: ctx.dryRun }, [], mutation.redirects)
  return EXIT.ok
}

function modelOf(target: ReturnType<typeof lookup>['target']) {
  switch (target.kind) {
    case 'category':
      return target.category.model
    case 'feature':
      return target.feature.model
    case 'behaviour':
      return target.behaviour.model
    case 'variant':
      return target.variant
  }
}

/** Writes a mutation unless it would add lint errors; prints the diff instead under --dry-run. */
function commit(ctx: Context, compilation: Compilation, mutation: Mutation, kind: string): number {
  const root = compilation.workspace.root
  const result = commitChanges(compilation, mutation.changes, { dryRun: ctx.dryRun, compileOptions: { now: ctx.io.now() } })
  if (result.introduced.length > 0) {
    throw new CliError(EXIT.lint, `Adding this ${kind} would introduce lint errors; nothing was written`, result.introduced)
  }
  const model = modelOf(lookup(result.after, mutation.id).target)
  const files = changedPaths(mutation.changes, root)
  ctx.redirects(mutation.redirects)
  if (ctx.dryRun) {
    ctx.out(renderDiff(mutation.changes, root))
  } else {
    const name = 'name' in model ? ` ${model.name}` : ''
    ctx.out(`Added ${kind} ${mutation.id}${name} (${relative(root, mutation.file).split(sep).join('/')})`)
  }
  ctx.envelope(true, { kind, entity: model, files, dryRun: ctx.dryRun }, [], mutation.redirects)
  return EXIT.ok
}

function readDescription(ctx: Context, options: DescriptionOptions, stdin: string | undefined): string {
  if (stdin !== undefined && stdin !== '-') throw new UsageError(`Unexpected argument "${stdin}"`)
  const given = [options.description !== undefined, options.descriptionFile !== undefined, stdin === '-'].filter((flag) => flag)
  if (given.length > 1) throw new UsageError('Use only one of --description, --description-file and -')
  if (options.description !== undefined) return options.description
  if (options.descriptionFile !== undefined) {
    const text = ctx.io.fs.readFile(ctx.path(options.descriptionFile))
    if (text === undefined) throw new UsageError(`Cannot read ${options.descriptionFile}`)
    return text
  }
  if (stdin === '-') return ctx.io.readStdin()
  throw new UsageError('A description is required: --description, --description-file, or - to read stdin')
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}
