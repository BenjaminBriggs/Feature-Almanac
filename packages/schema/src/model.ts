import type { Diagnostic } from './diagnostics.js'

/*
 * §12 compiled model (`almanac.json`). Deviations from the spec text:
 * - `ChangelogEntry.changes[].action` carries the value of `feature: added | modified | removed`,
 *   which the spec's change shape had no field for.
 * - `Variant.removedReason` supports variant tombstones.
 * - `Behaviour.status` and `Behaviour.since` include variant overrides (§8 rule 6).
 * - A `moved` change may name features as well as behaviours (`almanac mv` of a feature).
 */

export interface Almanac {
  almanac: 1
  generatedAt: string
  gitRef?: string
  product: { name: string; prefix?: string; description?: string }
  code?: { repo: string; ref: string; path: string }
  platforms: { id: string; name: string }[]
  platformGroups: Record<string, string[]>
  statuses: string[]
  owners: Record<string, { name: string }>
  categories: Category[]
  diagnostics: Diagnostic[]
}

export interface Category {
  id: string
  name: string
  description: string
  owner?: string
  status: 'active' | 'removed'
  removedReason?: string
  features: Feature[]
  file: string
}

export interface Feature {
  id: string
  ref: string
  name: string
  description: string
  overview?: string
  owner: string
  platforms: string[]
  status: Record<string, string>
  since: Record<string, string>
  tags: string[]
  dependsOn: string[]
  related: string[]
  links: { type: string; title: string; url: string }[]
  code: string[]
  assets: string[]
  fields: Record<string, unknown>
  formerly: string[]
  removedReason?: string
  changelog: ChangelogEntry[]
  behaviours: Behaviour[]
  file: string
  line: number
}

export interface SourceRef {
  path: string
  symbol?: string
  url?: string
}

export interface Behaviour {
  id: string
  ref: string
  name: string
  platforms: string[]
  status: Record<string, string>
  since: Record<string, string>
  format: string
  description: string
  gherkin?: GherkinScenario[]
  source: SourceRef[]
  tags: string[]
  flag?: string
  fields: Record<string, unknown>
  formerly: string[]
  removedReason?: string
  variants: Variant[]
  resolved: Record<string, string>
  line: number
}

export interface Variant {
  ref: string
  platforms: string[]
  mode: 'append' | 'replace'
  status?: Record<string, string>
  since?: Record<string, string>
  description: string
  source: SourceRef[]
  removedReason?: string
  line: number
}

export type ChangeKind = 'added' | 'modified' | 'removed' | 'moved' | 'feature'

export interface Change {
  kind: ChangeKind
  ref?: string
  from?: string
  to?: string
  action?: 'added' | 'modified' | 'removed'
  detail?: string
}

export interface ChangelogEntry {
  date: string
  summary: string
  version?: string
  platforms: string[]
  ticket?: { id: string; url?: string }
  author?: string
  changes: Change[]
}

export interface GherkinScenario {
  name?: string
  steps: { keyword: string; text: string }[]
}
