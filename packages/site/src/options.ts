import type { Almanac } from '@feature-almanac/schema'

export const DEFAULT_LABELS: Record<string, string> = {
  planned: 'Coming soon',
  'in-progress': 'In progress',
  shipped: 'Available',
  deprecated: 'Being retired',
  removed: 'Removed',
}

export interface SiteOptions {
  title: string
  tagline?: string
  labels: Record<string, string>
  /** Injects the dev server's reload listener. */
  liveReload?: boolean
}

/** §14 `site` block of almanac.yaml, read defensively (it is free-form until v0.4's schema). */
export function siteOptions(model: Almanac, site: Record<string, unknown> | undefined): SiteOptions {
  const text = (key: string) => (typeof site?.[key] === 'string' ? (site[key] as string) : undefined)
  const labels: Record<string, string> = { ...DEFAULT_LABELS }
  const configured = site?.labels
  if (configured !== null && typeof configured === 'object') {
    for (const [status, label] of Object.entries(configured)) if (typeof label === 'string') labels[status] = label
  }
  const options: SiteOptions = { title: text('title') ?? model.product.name, labels }
  const tagline = text('tagline') ?? model.product.description
  if (tagline !== undefined) options.tagline = tagline
  return options
}

export function statusLabel(options: SiteOptions, status: string): string {
  return options.labels[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, ' ')
}
