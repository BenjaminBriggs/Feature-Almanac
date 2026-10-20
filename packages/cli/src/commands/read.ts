import {
  behaviourHistory,
  listEntities,
  lookup,
  nextId,
  REVIEW_FILTERS,
  renderBehaviour,
  renderCategory,
  renderFeature,
  renderSource,
  renderVariant,
  statusLabel,
  UsageError,
  type Compilation,
  type ListLevel,
  type ReviewFilter,
  type Listed,
  type Target,
} from '@feature-almanac/core'
import type { Feature, Almanac } from '@feature-almanac/schema'
import { Option, type Command } from 'commander'
import { EXIT, type Context } from '../context.js'
import type { Wrap } from '../program.js'

interface ShowOptions {
  platform?: string
  withChangelog?: boolean
  withRelated?: boolean
  format: 'markdown' | 'yaml' | 'json'
}

interface ListOptions {
  level?: ListLevel
  category?: string
  feature?: string
  status?: string
  platform?: string
  owner?: string
  tag?: string
  review?: ReviewFilter
  includeRemoved?: boolean
}

export function registerReadCommands(program: Command, wrap: Wrap): void {
  program
    .command('show')
    .description('Print one category, feature, behaviour or variant')
    .argument('<ref>', 'ID or reference: 1, 1.2, 1.2.3, 1.2.3@android, PD-1.2.3')
    .option('--platform <platform>', 'resolve descriptions and status for one platform')
    .option('--with-changelog', 'include the changelog (history for behaviours)')
    .option('--with-related', 'include depends_on and related features')
    .addOption(new Option('--format <format>', 'output format').choices(['markdown', 'yaml', 'json']).default('markdown'))
    .action(
      wrap('show', (ctx, ref: string, options: ShowOptions) => {
        const compilation = ctx.compile()
        const model = ctx.model(compilation)
        checkPlatform(model, options.platform)
        const { target, redirects } = lookup(compilation, ref)
        ctx.redirects(redirects)
        const data = showData(compilation, model, target, options)
        if (options.format === 'json') ctx.out(JSON.stringify(data.entity, null, 2))
        else if (options.format === 'yaml') ctx.out(renderSource(target))
        else ctx.out(renderTarget(model, target, options, data.related))
        ctx.envelope(true, data, [], redirects)
        return EXIT.ok
      }),
    )

  program
    .command('list')
    .description('Filtered listing of categories, features or behaviours')
    .addOption(new Option('--level <level>', 'what to list').choices(['category', 'feature', 'behaviour']))
    .option('--category <N>', 'only this category')
    .option('--feature <N.M>', 'only this feature (lists its behaviours)')
    .option('--status <status>', 'only entities with this status (on --platform when given)')
    .option('--platform <platform>', 'only entities available on this platform')
    .option('--owner <owner>', 'only this owner (a behaviour has its feature’s owner)')
    .option('--tag <tag>', 'only entities with this tag')
    .addOption(new Option('--review <state>', 'behaviours by review: never reviewed, changed since, approved, rejected, or needed (the first two)').choices([...REVIEW_FILTERS]))
    .option('--include-removed', 'include tombstones')
    .action(
      wrap('list', (ctx, options: ListOptions) => {
        const model = ctx.model(ctx.compile())
        checkPlatform(model, options.platform)
        const listed = listEntities(model, options)
        if (listed.length === 0) ctx.note('Nothing matches.')
        else if (options.review !== undefined) ctx.out(table(listed.map((item) => [item.entity.id, item.entity.name, reviewLine(item)])))
        else ctx.out(table(listed.map((item) => [item.entity.id, item.entity.name, rowStatus(model, item, options.platform)])))
        ctx.envelope(true, listed.map(summary))
        return EXIT.ok
      }),
    )

  program
    .command('next-id')
    .description('Print the ID the next add would allocate: a category with no parent, else a feature or behaviour under <parent>')
    .argument('[parent]', 'category ID (N) for a feature, feature ID (N.M) for a behaviour')
    .action(
      wrap('next-id', (ctx, parent: string | undefined) => {
        const { id, redirects } = nextId(ctx.compile(), parent)
        ctx.redirects(redirects)
        ctx.out(id)
        ctx.envelope(true, { ...(parent !== undefined ? { parent } : {}), id }, [], redirects)
        return EXIT.ok
      }),
    )
}

function checkPlatform(model: Almanac, platform: string | undefined): void {
  if (platform !== undefined && model.platforms.some(({ id }) => id === platform) === false) {
    throw new UsageError(`Unknown platform "${platform}"; known: ${model.platforms.map(({ id }) => id).join(', ')}`)
  }
}

interface ShowData {
  kind: Target['kind']
  entity: unknown
  related?: Feature[]
  history?: unknown
}

function showData(compilation: Compilation, model: Almanac, target: Target, options: ShowOptions): ShowData {
  const platform = options.platform
  switch (target.kind) {
    case 'category': {
      const category = target.category.model
      const features = platform === undefined ? category.features : category.features.filter((f) => f.platforms.includes(platform))
      return { kind: 'category', entity: { ...category, features } }
    }
    case 'feature': {
      const feature = target.feature.model
      const behaviours = platform === undefined ? feature.behaviours : feature.behaviours.filter((b) => b.platforms.includes(platform))
      const data: ShowData = { kind: 'feature', entity: { ...feature, behaviours } }
      if (options.withRelated === true) data.related = relatedFeatures(compilation, feature)
      return data
    }
    case 'behaviour': {
      const data: ShowData = { kind: 'behaviour', entity: target.behaviour.model }
      if (options.withChangelog === true) data.history = behaviourHistory(target.behaviour.feature.model, target.behaviour.model)
      return data
    }
    case 'variant':
      return { kind: 'variant', entity: target.variant }
  }
}

function relatedFeatures(compilation: Compilation, feature: Feature): Feature[] {
  const ids = [...feature.dependsOn, ...feature.related].map((id) => compilation.formerly.get(id) ?? id)
  return [...new Set(ids)]
    .map((id) => compilation.features.get(id)?.model)
    .filter((related): related is Feature => related !== undefined)
}

function renderTarget(model: Almanac, target: Target, options: ShowOptions, related: Feature[] | undefined): string {
  const render = {
    ...(options.platform !== undefined ? { platform: options.platform } : {}),
    ...(options.withChangelog === true ? { withChangelog: true } : {}),
    ...(related !== undefined ? { related } : {}),
  }
  switch (target.kind) {
    case 'category':
      return renderCategory(model, target.category.model, render)
    case 'feature':
      return renderFeature(model, target.feature.model, render)
    case 'behaviour':
      return renderBehaviour(model, target.behaviour.feature.model, target.behaviour.model, render)
    case 'variant':
      return renderVariant(model, target.behaviour.feature.model, target.behaviour.model, target.variant, target.platform)
  }
}

/** `list --review`: who decided what, and the rejection's reason. */
function reviewLine(item: Listed): string {
  if (item.level !== 'behaviour' || item.entity.review === undefined) return 'not reviewed'
  const { review } = item.entity
  const verdict = `${review.state} by ${review.by} on ${review.date}`
  if (review.stale) return `changed since ${verdict}`
  return review.note === undefined ? verdict : `${verdict}: ${review.note}`
}

function rowStatus(model: Almanac, item: Listed, platform: string | undefined): string {
  if (item.level === 'category') return item.entity.status
  return statusLabel(model, item.entity.status, platform)
}

/** `list --json` entries: model objects without their nested children. */
function summary(item: Listed): unknown {
  if (item.level === 'category') {
    const { features, ...rest } = item.entity
    return { level: 'category', ...rest, featureCount: features.length }
  }
  if (item.level === 'feature') {
    const { behaviours, changelog, ...rest } = item.entity
    return { level: 'feature', ...rest, category: item.category.id, behaviourCount: behaviours.length }
  }
  return { level: 'behaviour', ...item.entity, feature: item.feature.id }
}

function table(rows: string[][]): string {
  if (rows.length === 0) return ''
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length))) ?? []
  return rows
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
}
