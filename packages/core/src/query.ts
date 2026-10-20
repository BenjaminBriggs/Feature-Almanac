import { compareIds, parseRef, type Behaviour, type Category, type Feature, type IdLevel, type ParsedRef, type Almanac, type Variant } from '@feature-almanac/schema'
import type { BehaviourHandle, CategoryHandle, Compilation, FeatureHandle } from './compile.js'
import { REMOVED } from './config.js'
import { matchesReview, type ReviewFilter } from './review.js'

/** Exit code 3. */
export class NotFoundError extends Error {}
/** Exit code 2. */
export class UsageError extends Error {}
/** Exit code 4. */
export class InvalidStateError extends Error {}

export interface Redirect {
  from: string
  to: string
}

export type Target =
  | { kind: 'category'; category: CategoryHandle }
  | { kind: 'feature'; feature: FeatureHandle }
  | { kind: 'behaviour'; behaviour: BehaviourHandle }
  | { kind: 'variant'; behaviour: BehaviourHandle; variant: Variant; index: number; platform: string }

export interface Lookup {
  target: Target
  redirects: Redirect[]
}

/** Resolves any reference (§3 grammar), following `formerly` (§3 rule 6). */
export function lookup(compilation: Compilation, input: string): Lookup {
  const parsed = parseInput(compilation, input)
  const { id, redirects } = follow(compilation, parsed.id)
  if (parsed.level === 'category') {
    const category = compilation.categories.get(id)
    if (category === undefined) throw new NotFoundError(`Category ${id} not found`)
    return { target: { kind: 'category', category }, redirects }
  }
  if (parsed.level === 'feature') {
    const feature = compilation.features.get(id)
    if (feature === undefined) throw new NotFoundError(`Feature ${id} not found`)
    return { target: { kind: 'feature', feature }, redirects }
  }
  const behaviour = compilation.behaviours.get(id)
  if (behaviour === undefined) throw new NotFoundError(`Behaviour ${id} not found`)
  const platform = parsed.platform
  if (platform === undefined) return { target: { kind: 'behaviour', behaviour }, redirects }
  const index = behaviour.model.variants.findIndex((variant) => variant.platforms.includes(platform))
  const variant = behaviour.model.variants[index]
  if (variant === undefined) throw new NotFoundError(`Behaviour ${id} has no variant for ${platform}`)
  return { target: { kind: 'variant', behaviour, variant, index, platform }, redirects }
}

/** Resolves an ID that must be at `level`, following `formerly`. */
export function resolveId(compilation: Compilation, input: string, level: IdLevel): { id: string; redirects: Redirect[] } {
  const parsed = parseInput(compilation, input)
  if (parsed.level !== level || parsed.platform !== undefined) throw new UsageError(`"${input}" is not a ${level} ID`)
  return follow(compilation, parsed.id)
}

function parseInput(compilation: Compilation, input: string): ParsedRef {
  const parsed = parseRef(input)
  if (parsed === undefined) throw new UsageError(`"${input}" is not a valid reference`)
  if (parsed.prefix !== undefined && parsed.prefix !== compilation.config?.product.prefix) {
    throw new NotFoundError(`${input} belongs to another product (prefix ${parsed.prefix})`)
  }
  return parsed
}

function follow(compilation: Compilation, id: string): { id: string; redirects: Redirect[] } {
  const current = compilation.formerly.get(id)
  if (current === undefined) return { id, redirects: [] }
  return { id: current, redirects: [{ from: id, to: current }] }
}

export type ListLevel = 'category' | 'feature' | 'behaviour'

export interface ListOptions {
  level?: ListLevel
  category?: string
  feature?: string
  status?: string
  platform?: string
  owner?: string
  tag?: string
  /** Behaviours by where they stand with reviewers; implies behaviours. */
  review?: ReviewFilter
  includeRemoved?: boolean
}

export type Listed =
  | { level: 'category'; entity: Category }
  | { level: 'feature'; entity: Feature; category: Category }
  | { level: 'behaviour'; entity: Behaviour; feature: Feature; category: Category }

/** `almanac list`. Without `--level`, lists behaviours when `--feature` is given, features otherwise. */
export function listEntities(model: Almanac, options: ListOptions): Listed[] {
  const level = options.level ?? (options.feature !== undefined || options.review !== undefined ? 'behaviour' : 'feature')
  if (options.review !== undefined && level !== 'behaviour') throw new UsageError('--review lists behaviours; leave out --level or use --level behaviour')
  const platform = options.platform
  const statusOn = (status: Record<string, string>, platforms: readonly string[]) =>
    (platform === undefined ? platforms : platforms.filter((p) => p === platform)).map((p) => status[p])
  const keep = (status: Record<string, string>, platforms: readonly string[]) => {
    if (platform !== undefined && platforms.includes(platform) === false) return false
    const values = statusOn(status, platforms)
    if (options.includeRemoved !== true && values.length > 0 && values.every((value) => value === REMOVED)) return false
    return options.status === undefined || values.includes(options.status)
  }

  const categories = model.categories.filter((category) => options.category === undefined || category.id === options.category)
  if (level === 'category') {
    return categories
      .filter((category) => options.includeRemoved === true || category.status !== 'removed')
      .filter((category) => options.owner === undefined || category.owner === options.owner)
      .filter((category) => options.status === undefined || category.status === options.status)
      .map((entity) => ({ level: 'category', entity }))
  }

  const out: Listed[] = []
  for (const category of categories) {
    for (const feature of category.features) {
      if (options.feature !== undefined && feature.id !== options.feature) continue
      if (options.owner !== undefined && feature.owner !== options.owner) continue
      if (level === 'feature') {
        if (keep(feature.status, feature.platforms) && (options.tag === undefined || feature.tags.includes(options.tag))) {
          out.push({ level: 'feature', entity: feature, category })
        }
        continue
      }
      for (const behaviour of feature.behaviours) {
        if (options.review !== undefined && matchesReview(behaviour, options.review) === false) continue
        if (keep(behaviour.status, behaviour.platforms) && (options.tag === undefined || behaviour.tags.includes(options.tag))) {
          out.push({ level: 'behaviour', entity: behaviour, feature, category })
        }
      }
    }
  }
  return out.sort((a, b) => compareIds(a.entity.id, b.entity.id))
}
