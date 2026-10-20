/**
 * The hash a review records: what a reviewer judges, so an approval lapses when that text changes.
 * Status, platforms and sources are left out; shipping a behaviour elsewhere doesn't change what it does.
 */
export function reviewHash(behaviour: { name: string; description: string; variants: readonly { platforms: readonly string[]; mode: string; description: string }[] }): string {
  const text = JSON.stringify([
    behaviour.name.trim(),
    normalise(behaviour.description),
    behaviour.variants.map((variant) => [variant.platforms, variant.mode, normalise(variant.description)]),
  ])
  // FNV-1a, 32 bits: enough to notice an edit, and the same in the browser and in Node.
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function normalise(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}
