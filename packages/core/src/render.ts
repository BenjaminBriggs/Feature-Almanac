import { Document } from 'yaml'
import type { Behaviour, Category, ChangelogEntry, Feature, Almanac, Variant } from '@feature-almanac/schema'
import { REMOVED } from './config.js'
import type { Target } from './query.js'
import { serialize } from './yaml.js'

export interface RenderOptions {
  /** Resolve descriptions and status for one platform (§8 rule 5). */
  platform?: string
  withChangelog?: boolean
  related?: Feature[]
}

/** `almanac show --format markdown` (the default for humans). */
export function renderCategory(model: Almanac, category: Category, options: RenderOptions = {}): string {
  const lines = [`# ${category.id} ${category.name}`, '', category.description, '']
  const meta: string[] = []
  if (category.owner !== undefined) meta.push(`Owner: ${ownerLabel(model, category.owner)}`)
  if (category.status === 'removed') meta.push(`Status: removed${category.removedReason !== undefined ? ` (${category.removedReason})` : ''}`)
  meta.push(`File: ${category.file}`)
  lines.push(...meta.map((line) => `- ${line}`), '', '## Features', '')
  const features = category.features.filter((feature) => options.platform === undefined || feature.platforms.includes(options.platform))
  if (features.length === 0) lines.push('None.')
  for (const feature of features) {
    lines.push(`- **${feature.id} ${feature.name}**: ${feature.description} (${statusLabel(model, feature.status, options.platform)})`)
  }
  return finish(lines)
}

export function renderFeature(model: Almanac, feature: Feature, options: RenderOptions = {}): string {
  const platform = options.platform
  const lines = [`# ${feature.id} ${feature.name}`, '', feature.description, '']
  if (platform !== undefined && feature.platforms.includes(platform) === false) {
    lines.push(`Not available on ${platformName(model, platform)}.`)
    return finish(lines)
  }
  const meta = [`ID: ${feature.ref}`, `Owner: ${ownerLabel(model, feature.owner)}`, `Status: ${statusLabel(model, feature.status, platform)}`]
  if (platform === undefined) meta.push(`Platforms: ${platformList(model, feature.platforms)}`)
  const since = sinceLabel(model, feature.since, platform)
  if (since !== undefined) meta.push(`Since: ${since}`)
  if (feature.tags.length > 0) meta.push(`Tags: ${feature.tags.join(', ')}`)
  if (feature.dependsOn.length > 0) meta.push(`Depends on: ${feature.dependsOn.join(', ')}`)
  if (feature.related.length > 0) meta.push(`Related: ${feature.related.join(', ')}`)
  for (const link of feature.links) meta.push(`${capitalise(link.type)}: [${link.title}](${link.url})`)
  if (feature.formerly.length > 0) meta.push(`Formerly: ${feature.formerly.join(', ')}`)
  if (feature.removedReason !== undefined) meta.push(`Removed: ${feature.removedReason}`)
  meta.push(`File: ${feature.file}`)
  lines.push(...meta.map((line) => `- ${line}`), '')
  if (feature.overview !== undefined) lines.push(feature.overview, '')

  lines.push('## Behaviours', '')
  const behaviours = feature.behaviours.filter((behaviour) => platform === undefined || behaviour.platforms.includes(platform))
  if (behaviours.length === 0) lines.push('None yet.', '')
  for (const behaviour of behaviours) lines.push(...behaviourBody(model, feature, behaviour, platform, 3), '')

  if (options.withChangelog === true) lines.push('## Changelog', '', ...changelogLines(feature.changelog), '')
  if (options.related !== undefined && options.related.length > 0) {
    lines.push('## Related features', '')
    for (const related of options.related) lines.push(`- **${related.id} ${related.name}**: ${related.description}`)
  }
  return finish(lines)
}

export function renderBehaviour(model: Almanac, feature: Feature, behaviour: Behaviour, options: RenderOptions = {}): string {
  const lines = behaviourBody(model, feature, behaviour, options.platform, 1)
  lines.splice(1, 0, '', `Feature: ${feature.id} ${feature.name}`)
  if (options.withChangelog === true) {
    const history = behaviourHistory(feature, behaviour)
    lines.push('', '## History', '', ...(history.length > 0 ? changelogLines(history) : ['No changelog entries mention it.']))
  }
  return finish(lines)
}

export function renderVariant(model: Almanac, feature: Feature, behaviour: Behaviour, variant: Variant, platform: string): string {
  const lines = [
    `# ${behaviour.id}@${platform} ${behaviour.name} (${platformName(model, platform)})`,
    '',
    `Feature: ${feature.id} ${feature.name}`,
    '',
    behaviour.resolved[platform] ?? variant.description,
    '',
    `- Status: ${statusLabel(model, behaviour.status, platform)}`,
    `- Variant covers: ${platformList(model, variant.platforms)} (${variant.mode})`,
  ]
  if (variant.removedReason !== undefined) lines.push(`- Removed: ${variant.removedReason}`)
  for (const source of variant.source) lines.push(`- Source: ${source.path}${source.symbol !== undefined ? `#${source.symbol}` : ''}`)
  return finish(lines)
}

/** `show --format yaml`: the entity as stored, comments included. */
export function renderSource(target: Target): string {
  if (target.kind === 'category') return target.category.file.text
  if (target.kind === 'feature') return target.feature.file.text
  const path: (string | number)[] = ['behaviours', target.behaviour.index]
  if (target.kind === 'variant') path.push('variants', target.index)
  const doc = new Document()
  doc.contents = target.behaviour.feature.file.parsed.doc.getIn(path, true) as Document['contents']
  return serialize(doc)
}

/** Changelog entries of `feature` that mention the behaviour, under its current or a former ID. */
export function behaviourHistory(feature: Feature, behaviour: Behaviour): ChangelogEntry[] {
  const ids = new Set([behaviour.id, ...behaviour.formerly])
  const mentions = (ref: string | undefined) => ref !== undefined && ids.has(ref.split('@')[0] as string)
  return feature.changelog.filter((entry) =>
    entry.changes.some((change) => mentions(change.ref) || mentions(change.from) || mentions(change.to)),
  )
}

function behaviourBody(model: Almanac, feature: Feature, behaviour: Behaviour, platform: string | undefined, depth: number): string[] {
  const heading = `${'#'.repeat(depth)} ${behaviour.id} ${behaviour.name}`
  if (platform !== undefined && behaviour.platforms.includes(platform) === false) {
    return [heading, '', `Not available on ${platformName(model, platform)}.`]
  }
  const removed = Object.values(behaviour.status).every((status) => status === REMOVED)
  const lines = [removed ? `${heading} (removed)` : heading, '']
  lines.push(platform === undefined ? behaviour.description : (behaviour.resolved[platform] ?? behaviour.description), '')
  const meta = [`Status: ${statusLabel(model, behaviour.status, platform)}`]
  if (platform === undefined && behaviour.platforms.join() !== feature.platforms.join()) {
    meta.push(`Platforms: ${platformList(model, behaviour.platforms)}`)
  }
  const since = sinceLabel(model, behaviour.since, platform)
  if (since !== undefined && since !== sinceLabel(model, feature.since, platform)) meta.push(`Since: ${since}`)
  if (behaviour.format !== 'prose') meta.push(`Format: ${behaviour.format}`)
  if (behaviour.flag !== undefined) meta.push(`Flag: ${behaviour.flag}`)
  if (behaviour.tags.length > 0) meta.push(`Tags: ${behaviour.tags.join(', ')}`)
  for (const source of behaviour.source) meta.push(`Source: ${source.path}${source.symbol !== undefined ? `#${source.symbol}` : ''}`)
  if (behaviour.formerly.length > 0) meta.push(`Formerly: ${behaviour.formerly.join(', ')}`)
  if (behaviour.removedReason !== undefined) meta.push(`Removed: ${behaviour.removedReason}`)
  if (behaviour.review !== undefined) {
    const { review } = behaviour
    meta.push(`Review: ${review.state} by ${review.by} on ${review.date}${review.note === undefined ? '' : ` (${review.note})`}${review.stale ? '; changed since, needs reviewing again' : ''}`)
  }
  lines.push(...meta.map((line) => `- ${line}`))
  if (platform === undefined) {
    for (const variant of behaviour.variants) {
      const status = variant.status !== undefined ? ` (${statusLabel(model, variant.status, undefined)})` : ''
      const mode = variant.mode === 'replace' ? ', instead of the above' : ''
      lines.push('', `**${platformList(model, variant.platforms)}**${status}${mode}: ${variant.description}`)
    }
  }
  return lines
}

function changelogLines(entries: readonly ChangelogEntry[]): string[] {
  const lines: string[] = []
  for (const entry of entries) {
    const tags = [entry.version, entry.ticket?.id, entry.platforms.length > 0 ? entry.platforms.join(', ') : undefined].filter(
      (value): value is string => value !== undefined,
    )
    lines.push(`- ${entry.date}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}: ${entry.summary}`)
    for (const change of entry.changes) {
      const subject = change.kind === 'moved' ? `${change.from} → ${change.to}` : change.kind === 'feature' ? `feature ${change.action}` : change.ref
      lines.push(`  - ${change.kind === 'feature' ? '' : `${change.kind} `}${subject}${change.detail !== undefined ? `: ${change.detail}` : ''}`)
    }
  }
  return lines
}

/** `shipped` when uniform, otherwise `shipped (iOS, macOS) · in-progress (Android)`. */
export function statusLabel(model: Almanac, status: Record<string, string>, platform: string | undefined): string {
  if (platform !== undefined) return status[platform] ?? 'not available'
  const groups = new Map<string, string[]>()
  for (const { id } of model.platforms) {
    const value = status[id]
    if (value === undefined) continue
    groups.set(value, [...(groups.get(value) ?? []), id])
  }
  if (groups.size <= 1) return [...groups.keys()][0] ?? 'no platforms'
  return [...groups].map(([value, platforms]) => `${value} (${platformList(model, platforms)})`).join(' · ')
}

function sinceLabel(model: Almanac, since: Record<string, string>, platform: string | undefined): string | undefined {
  if (platform !== undefined) return since[platform]
  const values = new Set(Object.values(since))
  if (values.size === 0) return undefined
  if (values.size === 1) return [...values][0]
  return model.platforms
    .filter(({ id }) => since[id] !== undefined)
    .map(({ id, name }) => `${name} ${since[id]}`)
    .join(', ')
}

function platformList(model: Almanac, platforms: readonly string[]): string {
  return platforms.map((platform) => platformName(model, platform)).join(', ')
}

function platformName(model: Almanac, platform: string): string {
  return model.platforms.find(({ id }) => id === platform)?.name ?? platform
}

function ownerLabel(model: Almanac, owner: string): string {
  const entry = model.owners[owner]
  return entry === undefined ? owner : `${entry.name} (${owner})`
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function finish(lines: string[]): string {
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
