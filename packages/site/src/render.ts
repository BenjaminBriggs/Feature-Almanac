import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Behaviour, Category, Feature, Almanac, Variant } from '@feature-almanac/schema'
import { embedJson, escapeHtml, plainText, renderMarkdown } from './html.js'
import { groupByValue, isLive, platformList, platformName } from './model.js'
import { statusLabel, type SiteOptions } from './options.js'
import { SEARCH_OPTIONS, buildSearchIndex, searchDocuments } from './search.js'
import { pixelGridDataUri } from './texture.js'

const ASSETS = fileURLToPath(new URL('../assets/', import.meta.url))
/** Runs before the first paint: the reader's saved choice, else their system setting. */
const THEME_SCRIPT =
  "(function(){var t;try{t=localStorage.getItem('almanac-theme')}catch(e){}if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',t)})()"
const FONTS =
  'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&amp;family=Jacquard+24&amp;family=JetBrains+Mono:wght@400;600&amp;display=swap'

let assetCache: { css: string; js: string; minisearch: string; grid: string } | undefined

function assets(): { css: string; js: string; minisearch: string; grid: string } {
  if (assetCache !== undefined) return assetCache
  const require = createRequire(import.meta.url)
  const umd = join(dirname(require.resolve('minisearch')), '..', 'umd', 'index.js')
  assetCache = {
    css: readFileSync(join(ASSETS, 'site.css'), 'utf8'),
    js: readFileSync(join(ASSETS, 'site.js'), 'utf8'),
    minisearch: readFileSync(umd, 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, ''),
    grid: pixelGridDataUri(),
  }
  return assetCache
}

/** Files of a built site, keyed by path relative to the output folder. */
export function buildSite(model: Almanac, options: SiteOptions): Record<string, string> {
  return {
    'index.html': renderSite(model, options),
    'almanac.json': `${JSON.stringify(model, null, 2)}\n`,
  }
}

/**
 * One self-contained page: every category, feature card and feature panel is pre-rendered, so it
 * reads (and find-in-page works) without JavaScript. The script adds search, unfolding panels and deep links.
 */
export function renderSite(model: Almanac, options: SiteOptions): string {
  const { css, js, minisearch, grid } = assets()
  const categories = model.categories.filter((category) => category.status !== 'removed')
  const features = categories.flatMap((category) =>
    category.features.filter((feature) => isLive(feature.status)).map((feature) => ({ category, feature })),
  )
  const behaviours = features.reduce((sum, { feature }) => sum + feature.behaviours.filter((behaviour) => isLive(behaviour.status)).length, 0)
  const example = features.flatMap(({ feature }) => feature.behaviours)[0]?.ref ?? features[0]?.feature.ref
  const index = buildSearchIndex(searchDocuments(model, options))
  const generated = new Date(model.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  return `<!doctype html>
<html lang="en" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<script>${THEME_SCRIPT}</script>
<title>${escapeHtml(options.title)} — Feature Almanac</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<style>
${css}
:root { --pixel-grid: url("${grid}"); }
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="top">
<div class="wrap">
<section class="intro" aria-labelledby="page-title">
<div class="bento">
<div class="hero">
<h1 id="page-title"><span class="almanac-of"><span>The</span><span class="almanac-word"><span class="glitch" data-text="Almanac">Almanac</span><span class="of"> of</span></span></span><span class="cond product">${escapeHtml(model.product.name)}</span></h1>
<div class="hero-foot">
<p class="lede">${escapeHtml(options.tagline ?? 'Everything the app does, grouped by area.')}</p>
<div class="hero-meta"><p class="plats">${model.platforms.map(({ name }) => `<span class="plat">${statusIcon('shipped')}${escapeHtml(name)}</span>`).join('')}</p><p class="stamp">Generated ${escapeHtml(generated)}</p></div>
</div>
</div>
<div class="counts">
<div class="count count-main"><span class="count-label">Behaviours on record</span><span class="count-num">${behaviours}</span></div>
<div class="count-pair">
<div class="count count-lime"><span class="count-num">${features.length}</span><span class="count-label">${noun(features.length, 'Feature')}</span></div>
<div class="count count-line"><span class="count-num">${categories.length}</span><span class="count-label">${noun(categories.length, 'Category', 'Categories')}</span></div>
</div>
</div>
</div>
</section>
</div>
</div>

<div class="finder">
<div class="finder-search">
<div class="finder-row">
<div role="search" class="searchbox">
<span class="prompt" aria-hidden="true">&gt;</span>
<label for="q" class="sr">Search features, behaviours or IDs</label>
<input id="q" type="search" placeholder="search features, behaviours or IDs" autocomplete="off" spellcheck="false">
<kbd aria-hidden="true">/</kbd>
<button type="button" class="clear" hidden>Clear</button>
</div>
<button type="button" class="theme-toggle" aria-label="Switch between light and dark"><svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M10 2a8 8 0 0 1 0 16z" fill="currentColor"></path></svg><span class="label"><span class="to-light">Light</span><span class="to-dark">Dark</span></span></button>
</div>
<div class="search-status" role="status" aria-live="polite"></div>
</div>
<nav class="catnav" aria-label="Categories">
<ul>
${categories.map((category) => `<li><a href="#cat-${escapeHtml(category.id)}" data-category="${escapeHtml(category.id)}"><span class="catnav-num">${escapeHtml(pad(category.id))}</span><span class="catnav-name">${escapeHtml(category.name)}</span></a></li>`).join('\n')}
</ul>
</nav>
</div>

<main id="main" class="wrap main">
<section class="no-results" hidden>
<h2 class="cond"><span class="glitch" data-text="No signal">No signal</span></h2>
<p>Nothing matches “<span class="no-results-query"></span>”. Try a feature name, a word from what it does, a platform, or an ID${example === undefined ? '' : ` such as ${escapeHtml(example)}`}.</p>
</section>

${categories.map((category) => renderCategory(model, options, category)).join('\n')}
</main>

<footer class="site-footer">
<div class="wrap">
<span>Generated ${escapeHtml(generated)}${model.gitRef === undefined ? '' : ` from <code>${escapeHtml(model.gitRef.slice(0, 7))}</code>`} · Feature Almanac</span>
${example === undefined ? '' : `<span>Cite anything by its ID — <code>${escapeHtml(example)}</code></span>`}
</div>
</footer>

<script type="application/json" id="almanac-search">${embedJson(index)}</script>
<script type="application/json" id="almanac-search-options">${embedJson(SEARCH_OPTIONS)}</script>
<script type="application/json" id="almanac-prefix">${embedJson(model.product.prefix ?? null)}</script>
<script>${minisearch}</script>
<script>${js}</script>
${options.liveReload === true ? `<script>new EventSource('/__almanac/events').addEventListener('reload', () => location.reload())</script>` : ''}
</body>
</html>
`
}

function ref(model: Almanac, id: string): string {
  return model.product.prefix === undefined ? id : `${model.product.prefix}-${id}`
}

/** Two digits, for the numerals and counts set in the pixel and mono faces: `7` → `07`. */
function pad(value: number | string): string {
  const text = String(value)
  return text.length < 2 ? `0${text}` : text
}

function renderCategory(model: Almanac, options: SiteOptions, category: Category): string {
  const features = category.features.filter((feature) => isLive(feature.status))
  const id = escapeHtml(category.id)
  return `<section class="category" id="cat-${id}" data-category="${id}" aria-labelledby="c-${id}">
<span class="ghost" aria-hidden="true" data-text="${escapeHtml(pad(category.id))}">${escapeHtml(pad(category.id))}</span>
<div class="category-head">
<p class="category-meta"><span class="chip">${escapeHtml(ref(model, category.id))}</span><span>${pad(features.length)} ${noun(features.length, 'feature')}</span></p>
<h2 id="c-${id}" class="cond">${escapeHtml(category.name)}</h2>
<p class="category-desc">${escapeHtml(plainText(category.description))}</p>
</div>
${features.length === 0 ? '<p class="empty">No features yet.</p>' : `<ul class="cards">\n${features.map((feature) => `${renderCard(model, options, feature)}\n${renderPanel(model, options, feature)}`).join('\n')}\n</ul>`}
</section>`
}

function renderCard(model: Almanac, options: SiteOptions, feature: Feature): string {
  const live = feature.behaviours.filter((behaviour) => isLive(behaviour.status)).length
  return `<li class="card" data-feature="${escapeHtml(feature.id)}">
<a class="card-main" href="#${escapeHtml(feature.id)}" aria-expanded="false" aria-controls="${escapeHtml(feature.id)}">
<span class="card-top"><span class="chip">${escapeHtml(feature.ref)}</span><span class="card-count">${pad(live)} ${noun(live, 'behaviour')}</span></span>
<span class="cond card-title">${escapeHtml(feature.name)}</span>
<span class="card-desc">${escapeHtml(plainText(feature.description))}</span>
<span class="plats">${platformBadges(model, options, feature.status, false)}</span>
</a>
<div class="matches" hidden></div>
</li>`
}

/** The card's other side: everything about the feature, unfolded over the cards around it. */
function renderPanel(model: Almanac, options: SiteOptions, feature: Feature): string {
  const live = feature.behaviours.filter((behaviour) => isLive(behaviour.status))
  const removed = feature.behaviours.filter((behaviour) => isLive(behaviour.status) === false)
  const owner = model.owners[feature.owner]?.name ?? feature.owner
  const id = escapeHtml(feature.id)
  return `<li class="unfold" id="${id}" data-feature="${id}" tabindex="-1" aria-labelledby="t-${id}">
<div class="unfold-side">
<p class="card-top"><a class="chip" href="#${id}">${escapeHtml(feature.ref)}</a><span class="card-count">${pad(live.length)} ${noun(live.length, 'behaviour')}</span></p>
<h3 id="t-${id}" class="cond unfold-title">${escapeHtml(feature.name)}</h3>
<div class="md lead">${renderMarkdown(feature.description)}</div>
<p class="plats">${platformBadges(model, options, feature.status, true)}</p>
<p class="meta">Owner ${escapeHtml(owner)}${feature.links.map((link) => ` · <a href="${escapeHtml(link.url)}">${escapeHtml(link.title)}</a>`).join('')}</p>
<p><a class="close" href="#" aria-label="Close ${escapeHtml(feature.name)}">Close <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 10l5-5 5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"></path></svg></a></p>
</div>
<div class="unfold-body">
${feature.overview === undefined ? '' : `<div class="md overview">${renderMarkdown(feature.overview)}</div>`}
<p class="section-label">${pad(live.length)} ${noun(live.length, 'behaviour')}</p>
${live.length === 0 ? '<p class="empty">No behaviours written yet.</p>' : `<ul class="behaviours">\n${live.map((behaviour) => renderBehaviour(model, options, feature, behaviour)).join('\n')}\n</ul>`}
${removed.length === 0 ? '' : `<details class="removed"><summary>${removed.length} removed ${noun(removed.length, 'behaviour')}</summary><ul class="behaviours">\n${removed.map((behaviour) => renderBehaviour(model, options, feature, behaviour)).join('\n')}\n</ul></details>`}
</div>
</li>`
}

function renderBehaviour(model: Almanac, options: SiteOptions, feature: Feature, behaviour: Behaviour): string {
  const removed = isLive(behaviour.status) === false
  const notes = removed ? [] : behaviourNotes(model, options, feature, behaviour)
  const body =
    behaviour.gherkin === undefined
      ? `<div class="md">${renderMarkdown(behaviour.description)}</div>`
      : `${behaviour.summary === undefined ? '' : `<p class="b-summary">${escapeHtml(behaviour.summary)}</p>`}<div class="steps">${behaviour.gherkin
          .map(
            (scenario) =>
              `${scenario.name === undefined ? '' : `<p class="scenario">${escapeHtml(scenario.name)}</p>`}<ol>${scenario.steps
                .map((step) => `<li><span class="kw">${escapeHtml(step.keyword)}</span> ${escapeHtml(step.text)}</li>`)
                .join('')}</ol>`,
          )
          .join('')}</div>`
  const variants = behaviour.variants.filter((variant) => removed || variant.status === undefined || isLive(variant.status))
  return `<li class="behaviour" id="${escapeHtml(behaviour.id)}">
<a class="chip" href="#${escapeHtml(behaviour.id)}">${escapeHtml(behaviour.ref)}</a>
<div class="b-body">
<h4>${escapeHtml(behaviour.name)}</h4>
${removed && behaviour.removedReason !== undefined ? `<p class="removed-reason">Removed: ${escapeHtml(behaviour.removedReason)}</p>` : ''}
${body}
${notes.length === 0 ? '' : `<p class="b-notes">${notes.map((note) => `<span class="b-note">${escapeHtml(note)}</span>`).join('')}</p>`}
${variants.length === 0 ? '' : `<dl class="variants">${variants.map((variant) => renderVariant(model, options, variant)).join('')}</dl>`}
</div>
</li>`
}

function renderVariant(model: Almanac, options: SiteOptions, variant: Variant): string {
  const names = variant.platforms.map((platform) => platformName(model, platform)).join(' & ')
  const groups = variant.status === undefined ? [] : groupByValue(model, variant.status)
  const status = groups.length === 1 ? ` <span class="v-status">(${escapeHtml(statusLabel(options, groups[0]?.[0] ?? '').toLowerCase())})</span>` : ''
  const lead = variant.mode === 'replace' ? '<span class="v-mode">Instead:</span> ' : ''
  return `<div class="variant"><dt>${escapeHtml(names)}${status}</dt><dd>${lead}${renderMarkdown(variant.description).replace(/^<p>|<\/p>$/g, '')}</dd></div>`
}

/** Plain-language notes where a behaviour differs from its feature. */
function behaviourNotes(model: Almanac, options: SiteOptions, feature: Feature, behaviour: Behaviour): string[] {
  const notes: string[] = []
  if (behaviour.platforms.join() !== feature.platforms.join()) notes.push(`Only on ${platformList(model, behaviour.platforms)}`)
  const differs: Record<string, string> = {}
  for (const platform of behaviour.platforms) {
    const variantStatus = behaviour.variants.some((variant) => variant.platforms.includes(platform) && variant.status !== undefined)
    if (behaviour.status[platform] !== feature.status[platform] && variantStatus === false) differs[platform] = behaviour.status[platform] as string
  }
  for (const [status, platforms] of groupByValue(model, differs)) {
    notes.push(`${statusLabel(options, status)} on ${platformList(model, platforms)}`)
  }
  const since = groupByValue(model, behaviour.since)
  const featureSince = groupByValue(model, feature.since)
  if (JSON.stringify(since) !== JSON.stringify(featureSince) && since.length > 0) {
    notes.push(
      since.length === 1
        ? `Since ${since[0]?.[0]}`
        : `Since ${since.map(([version, platforms]) => `${version} on ${platformList(model, platforms)}`).join(', ')}`,
    )
  }
  return notes
}

function platformBadges(model: Almanac, options: SiteOptions, status: Record<string, string>, withLabels: boolean): string {
  return model.platforms
    .filter(({ id }) => status[id] !== undefined)
    .map(({ id, name }) => {
      const value = status[id] as string
      const label = statusLabel(options, value)
      const text = withLabels ? `${escapeHtml(name)} · ${escapeHtml(label)}` : `${escapeHtml(name)}<span class="sr">: ${escapeHtml(label)}</span>`
      return `<span class="plat">${statusIcon(value)}${text}</span>`
    })
    .join('')
}

/** Pixel squares: filled when available, half when in progress, hollow when planned. */
function statusIcon(status: string): string {
  const open = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">'
  switch (status) {
    case 'shipped':
      return `${open}<rect x="0.5" y="0.5" width="9" height="9" fill="var(--lime)" stroke="var(--status-line)"></rect></svg>`
    case 'in-progress':
      return `${open}<rect width="5" height="10" fill="var(--lime)"></rect><rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke="var(--status-line)" stroke-width="1.5"></rect></svg>`
    case 'planned':
      return `${open}<rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke="var(--ink-2)" stroke-width="1.5"></rect></svg>`
    case 'deprecated':
      return `${open}<rect width="10" height="10" fill="var(--red)"></rect></svg>`
    case 'removed':
      return `${open}<rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke="var(--ink-2)" stroke-width="1.5"></rect><path d="M1 9L9 1" stroke="var(--ink-2)" stroke-width="1.5"></path></svg>`
    default:
      return `${open}<rect x="0.75" y="0.75" width="8.5" height="8.5" fill="none" stroke="var(--ink-2)" stroke-width="1.5" stroke-dasharray="2 2"></rect></svg>`
  }
}

function noun(n: number, singular: string, plural = `${singular}s`): string {
  return n === 1 ? singular : plural
}
