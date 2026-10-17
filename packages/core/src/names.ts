import { localNumber } from '@feature-almanac/schema'

const MAX_SLUG = 48

/** §2: lowercase kebab-case, ASCII, at most 48 characters. */
export function slugify(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const trimmed = slug.slice(0, MAX_SLUG).replace(/-+$/, '')
  return trimmed === '' ? 'untitled' : trimmed
}

/** §2: zero-padded to 2 digits, 3 when ≥ 100. */
export function padNumber(n: number): string {
  return String(n).padStart(n >= 100 ? 3 : 2, '0')
}

export function categoryDirName(id: number, name: string): string {
  return `${padNumber(id)}-${slugify(name)}`
}

export function featureFileName(id: string, name: string): string {
  return `${padNumber(localNumber(id))}-${slugify(name)}.yaml`
}
