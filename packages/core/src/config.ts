import type { ConfigFile, FieldDefinition, LintLevel } from '@feature-almanac/schema'

export const DEFAULT_STATUSES = ['planned', 'in-progress', 'shipped', 'deprecated', 'removed']
export const DEFAULT_FORMATS = ['prose', 'gherkin', 'ears']
export const DEFAULT_LINK_TYPES = ['design', 'prd', 'ticket', 'docs', 'support', 'analytics', 'code', 'other']
export const DEFAULT_MAX_BEHAVIOURS = 20
export const REMOVED = 'removed'

/** almanac.yaml with every §4 default applied. */
export interface ResolvedConfig {
  data: ConfigFile
  product: ConfigFile['product']
  code?: { repo?: string; ref: string; path: string }
  /** Platform tags in config order; this order is used wherever platforms are listed. */
  platforms: string[]
  platformNames: Record<string, string>
  groups: Record<string, string[]>
  statuses: string[]
  formatDefault: string
  formatsAllowed: string[]
  linkTypes: string[]
  owners?: Record<string, { name: string }>
  ticketsUrl?: string
  fields: { feature: Record<string, FieldDefinition>; behaviour: Record<string, FieldDefinition> }
  lint: { requireSource: LintLevel; requireOwner: LintLevel; maxBehaviours: number }
}

export function resolveConfig(data: ConfigFile): ResolvedConfig {
  const platforms = Object.keys(data.platforms)
  const resolved: ResolvedConfig = {
    data,
    product: data.product,
    platforms,
    platformNames: Object.fromEntries(platforms.map((tag) => [tag, data.platforms[tag]?.name ?? tag])),
    groups: data.platform_groups ?? {},
    statuses: data.statuses ?? DEFAULT_STATUSES,
    formatDefault: data.formats?.default ?? 'prose',
    formatsAllowed: data.formats?.allowed ?? DEFAULT_FORMATS,
    linkTypes: data.link_types ?? DEFAULT_LINK_TYPES,
    fields: { feature: data.fields?.feature ?? {}, behaviour: data.fields?.behaviour ?? {} },
    lint: {
      requireSource: data.lint?.require_source ?? 'off',
      // require_owner sets the severity of ALM-W010 (owner not in the registry).
      requireOwner: data.lint?.require_owner ?? 'warn',
      maxBehaviours: data.lint?.max_behaviours_per_feature ?? DEFAULT_MAX_BEHAVIOURS,
    },
  }
  if (data.code !== undefined) {
    resolved.code = { ref: data.code.ref ?? 'main', path: data.code.path ?? '.' }
    if (data.code.repo !== undefined) resolved.code.repo = data.code.repo
  }
  if (data.owners !== undefined) resolved.owners = data.owners
  if (data.tickets !== undefined) resolved.ticketsUrl = data.tickets.url
  return resolved
}
