export interface PlatformContext {
  platforms: readonly string[]
  groups: Readonly<Record<string, readonly string[]>>
}

export interface Expansion {
  /** Resulting set, in config order, always within `base`. */
  platforms: string[]
  /** List entries that are neither a platform nor a group. */
  unknown: { tag: string; index: number }[]
  /** Explicitly included platforms that fall outside `base`. */
  outside: string[]
}

/**
 * §8 resolution steps 1–4: groups expand to their platforms, `!x` removes `x`, and a list of only
 * exclusions (or no list) starts from `base`.
 */
export function expandPlatforms(
  list: readonly string[] | undefined,
  base: readonly string[],
  context: PlatformContext,
  allowExclusions: boolean,
): Expansion {
  if (list === undefined) return { platforms: [...base], unknown: [], outside: [] }
  const include = new Set<string>()
  const exclude = new Set<string>()
  const unknown: Expansion['unknown'] = []
  list.forEach((entry, index) => {
    const negated = allowExclusions && entry.startsWith('!')
    const tag = negated ? entry.slice(1) : entry
    const members = context.groups[tag] ?? (context.platforms.includes(tag) ? [tag] : undefined)
    if (members === undefined) {
      unknown.push({ tag: entry, index })
      return
    }
    for (const member of members) (negated ? exclude : include).add(member)
  })
  const start = include.size > 0 ? include : new Set(base)
  const outside = [...include].filter((platform) => base.includes(platform) === false)
  const platforms = context.platforms.filter(
    (platform) => start.has(platform) && exclude.has(platform) === false && base.includes(platform),
  )
  return { platforms, unknown, outside }
}
