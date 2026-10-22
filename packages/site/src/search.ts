import MiniSearch from 'minisearch'
import type { Behaviour, Feature, Almanac } from '@feature-almanac/schema'
import { plainText } from './html.js'
import { statusLabel, type SiteOptions } from './options.js'
import { isLive, platformName } from './model.js'

export interface SearchDocument {
  key: string
  kind: 'feature' | 'behaviour'
  id: string
  featureId: string
  /** Searched, boosted. */
  name: string
  /** Searched: descriptions, variants, steps. */
  text: string
  /** Searched, lowest weight: the enclosing feature, category and platforms. */
  context: string
  snippet: string
  removed: boolean
}

/**
 * MiniSearch options shared by the build (which indexes) and the page (which loads the index).
 * `fuzzy` is a function, so the page adds it at query time.
 */
export const SEARCH_OPTIONS = {
  idField: 'key',
  fields: ['name', 'text', 'context'],
  storeFields: ['kind', 'id', 'featureId', 'name', 'snippet', 'removed'],
  searchOptions: { boost: { name: 3, text: 1.5, context: 1 }, prefix: true, combineWith: 'AND' },
} as const

export function searchDocuments(model: Almanac, options: SiteOptions): SearchDocument[] {
  const docs: SearchDocument[] = []
  for (const category of model.categories) {
    if (category.status === 'removed') continue
    for (const feature of category.features) {
      if (isLive(feature.status) === false) continue
      const platforms = statusWords(model, options, feature.status)
      docs.push({
        key: `f:${feature.id}`,
        kind: 'feature',
        id: feature.id,
        featureId: feature.id,
        name: feature.name,
        text: [feature.description, feature.overview ?? '', feature.tags.join(' ')].join(' '),
        context: [category.name, platforms].join(' '),
        snippet: snippet(feature.description),
        removed: false,
      })
      for (const behaviour of feature.behaviours) docs.push(behaviourDocument(model, options, category.name, feature, behaviour))
    }
  }
  return uniqueKeys(docs)
}

/** Lint reports a duplicate ID (ALM-E005); the index still needs one key per document, so repeats get `~2`, `~3`… */
function uniqueKeys(docs: SearchDocument[]): SearchDocument[] {
  const seen = new Map<string, number>()
  return docs.map((doc) => {
    const count = (seen.get(doc.key) ?? 0) + 1
    seen.set(doc.key, count)
    return count === 1 ? doc : { ...doc, key: `${doc.key}~${count}` }
  })
}

function behaviourDocument(model: Almanac, options: SiteOptions, category: string, feature: Feature, behaviour: Behaviour): SearchDocument {
  const variants = behaviour.variants.map((variant) => `${variant.platforms.map((p) => platformName(model, p)).join(' ')} ${variant.description}`)
  return {
    key: `b:${behaviour.id}`,
    kind: 'behaviour',
    id: behaviour.id,
    featureId: feature.id,
    name: behaviour.name,
    text: [plainText(behaviour.description), ...variants, behaviour.tags.join(' ')].join(' '),
    context: [feature.name, category, statusWords(model, options, behaviour.status)].join(' '),
    snippet: snippet(behaviour.description),
    removed: isLive(behaviour.status) === false,
  }
}

function statusWords(model: Almanac, options: SiteOptions, status: Record<string, string>): string {
  return Object.entries(status)
    .map(([platform, value]) => `${platformName(model, platform)} ${statusLabel(options, value)}`)
    .join(' ')
}

function snippet(text: string): string {
  const plain = plainText(text)
  return plain.length > 160 ? `${plain.slice(0, 157).trimEnd()}…` : plain
}

/** Serialised MiniSearch index, loaded in the page with `MiniSearch.loadJSON`. */
export function buildSearchIndex(docs: readonly SearchDocument[]): unknown {
  const index = new MiniSearch<SearchDocument>({ ...SEARCH_OPTIONS, fields: [...SEARCH_OPTIONS.fields], storeFields: [...SEARCH_OPTIONS.storeFields] })
  index.addAll(docs)
  return index.toJSON()
}
