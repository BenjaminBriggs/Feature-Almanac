import type { Almanac } from '@feature-almanac/schema'

export function isLive(status: Readonly<Record<string, string>>): boolean {
  return Object.values(status).some((value) => value !== 'removed')
}

export function platformName(model: Almanac, platform: string): string {
  return model.platforms.find(({ id }) => id === platform)?.name ?? platform
}

export function platformList(model: Almanac, platforms: readonly string[]): string {
  return platforms.map((platform) => platformName(model, platform)).join(', ')
}

/** Platforms grouped by their value, in config order: `[["shipped", ["ios", "macos"]], …]`. */
export function groupByValue(model: Almanac, values: Readonly<Record<string, string>>): [string, string[]][] {
  const groups = new Map<string, string[]>()
  for (const { id } of model.platforms) {
    const value = values[id]
    if (value === undefined) continue
    groups.set(value, [...(groups.get(value) ?? []), id])
  }
  return [...groups]
}
