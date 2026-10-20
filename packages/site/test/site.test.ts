import MiniSearch from 'minisearch'
import { describe, expect, it } from 'vitest'
import type { Almanac } from '@feature-almanac/schema'
import { SEARCH_OPTIONS, buildSearchIndex, buildSite, pixelGridPng, renderMarkdown, renderSite, searchDocuments, siteOptions, startDevServer } from '@feature-almanac/site'
import { compileSpecExample } from '../../core/test/spec-example.js'

function fixtureModel(): Almanac {
  const model = compileSpecExample().model
  if (model === undefined) throw new Error('the spec example failed to compile')
  return model
}

describe('renderMarkdown', () => {
  it('renders the description subset and escapes everything else', () => {
    expect(renderMarkdown('Saves **after** 1 s.\n\n- one\n- `two`')).toBe('<p>Saves <strong>after</strong> 1 s.</p><ul><li>one</li><li><code>two</code></li></ul>')
    expect(renderMarkdown('<script>alert(1)</script> [docs](https://example.com)')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt; <a href="https://example.com">docs</a></p>',
    )
    expect(renderMarkdown('[bad](javascript:alert(1))')).toBe('<p>[bad](javascript:alert(1))</p>')
  })
})

describe('renderSite', () => {
  const model = fixtureModel()
  const html = renderSite(model, siteOptions(model, undefined))

  it('pre-renders categories, cards, panels and behaviour anchors', () => {
    expect(html).toContain('<span class="cond product">Example Notes</span></h1>')
    expect(html).toContain('<span class="ghost" aria-hidden="true" data-text="01">01</span>')
    expect(html).toContain('<li><a href="#cat-1" data-category="1"><span class="catnav-num">01</span><span class="catnav-name">Editing</span></a></li>')
    expect(html).toContain('<section class="category" id="cat-1" data-category="1"')
    expect(html).toContain('<a class="card-main" href="#1.1" aria-expanded="false" aria-controls="1.1">')
    expect(html).toContain('</li>\n<li class="unfold" id="1.1" data-feature="1.1" tabindex="-1" aria-labelledby="t-1.1">')
    expect(html).not.toContain('class="sheet"')
    expect(html).toMatch(/<li class="behaviour" id="1\.1\.2" data-hash="[0-9a-f]{8}">\n<a class="chip" href="#1\.1\.2">EX-1\.1\.2<\/a>/)
    expect(html).toContain('<p class="b-summary">Saves the note a second after typing stops.</p><div class="steps"><ol><li><span class="kw">Given</span> a note with unsaved edits')
    expect(html).toContain('<dt>iOS &amp; iPadOS</dt>')
    expect(html).toContain('<span class="v-mode">Instead:</span>')
    expect(html).toContain('<span class="b-note">Only on iOS, iPadOS, macOS</span>')
    expect(html).toContain('<summary>1 removed behaviour</summary>')
    expect(html).toContain('Removed: Replaced by system share sheet export in 2.4')
  })

  it('escapes content and embeds JSON safely', () => {
    const hostile = structuredClone(model)
    const feature = hostile.categories[0]?.features[0]
    if (feature === undefined) throw new Error('no feature')
    feature.name = '</script><img src=x onerror=alert(1)>'
    const page = renderSite(hostile, siteOptions(hostile, undefined))
    expect(page).not.toContain('<img src=x')
    expect(page).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;')
    expect(page).not.toMatch(/"name":"<\/script>/)
  })

  it('starts in the saved or system theme, with a toggle', () => {
    expect(html).toContain("localStorage.getItem('almanac-theme')")
    expect(html).toContain('<button type="button" class="theme-toggle"')
  })

  it('shows reviews, and offers review mode from the bar and each panel', () => {
    const reviewed = structuredClone(model)
    const [bold, autosave] = reviewed.categories[0]?.features[0]?.behaviours ?? []
    if (bold === undefined || autosave === undefined) throw new Error('no 1.1.1 or 1.1.2')
    bold.review = { state: 'approved', by: 'Sam Price', date: '2026-10-19', hash: bold.hash, stale: false }
    autosave.review = { state: 'rejected', by: 'Sam Price', date: '2026-10-19', note: 'Too slow.', hash: '00000000', stale: true }
    const page = renderSite(reviewed, siteOptions(reviewed, undefined))
    expect(page).toContain(`<li class="behaviour" id="1.1.1" data-hash="${bold.hash}" data-review="approved">`)
    expect(page).toContain('<p class="b-review is-approved">Approved by Sam Price, 19 Oct 2026</p>')
    expect(page).toContain('data-review="changed"')
    expect(page).toContain('<p class="b-review is-changed">Changed since Sam Price rejected it on 19 Oct 2026</p>')
    expect(html).toContain('<button type="button" class="review-open" aria-haspopup="dialog">Review')
    expect(html).toContain('<button type="button" class="review-feature" data-feature="1.1">Review these</button>')
    expect(html).toContain('<div class="review" role="dialog" aria-modal="true" aria-labelledby="review-title" hidden>')
  })

  it('counts what is live in the hero', () => {
    expect(html).toContain('<span class="count-label">Behaviours on record</span><span class="count-num">5</span>')
    expect(html).toContain('<span class="count-num">2</span><span class="count-label">Features</span>')
  })

  it('applies site options from almanac.yaml', () => {
    const page = renderSite(model, siteOptions(model, { title: 'PD Guide', labels: { shipped: 'Live' } }))
    expect(page).toContain('<title>PD Guide — Feature Almanac</title>')
    expect(page).toContain('iOS · Live')
  })

  it('writes the page and the model', () => {
    expect(Object.keys(buildSite(model, siteOptions(model, undefined)))).toEqual(['index.html', 'almanac.json'])
  })
})

describe('pixelGridPng', () => {
  it('is a small, reproducible greyscale-and-alpha PNG', () => {
    const png = pixelGridPng()
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    expect(png.readUInt32BE(16)).toBe(64)
    expect(png[25]).toBe(4)
    expect(pixelGridPng().equals(png)).toBe(true)
    expect(pixelGridPng(64, 1).equals(png)).toBe(false)
    expect(png.length).toBeLessThan(8000)
  })
})

describe('search index', () => {
  const model = fixtureModel()
  const docs = searchDocuments(model, siteOptions(model, undefined))
  const index = MiniSearch.loadJSON(JSON.stringify(buildSearchIndex(docs)), { ...SEARCH_OPTIONS, fields: [...SEARCH_OPTIONS.fields], storeFields: [...SEARCH_OPTIONS.storeFields] })
  const search = (query: string) =>
    index.search(query, { ...SEARCH_OPTIONS.searchOptions, fuzzy: (term: string) => (term.length > 7 ? 2 : term.length >= 4 ? 1 : false) })

  it('indexes features and behaviours, including removed ones', () => {
    expect(docs.map((doc) => doc.key)).toEqual(['f:1.1', 'b:1.1.1', 'b:1.1.2', 'b:1.1.3', 'b:1.1.4', 'b:1.1.5', 'f:2.1', 'b:2.1.1'])
    expect(docs.find((doc) => doc.id === '1.1.5')?.removed).toBe(true)
  })

  it('finds a behaviour from words spread across it and its feature', () => {
    expect(search('auto save android').map((result) => result.id)).toEqual(['1.1.2'])
  })

  it('matches prefixes and typos', () => {
    expect(search('handof').map((result) => result.id)).toContain('1.1.4')
    expect(search('autosve').map((result) => result.id)).toContain('1.1.2')
    expect(search('pdf')[0]?.id).toBe('1.1.5')
  })
})

describe('startDevServer', () => {
  it('serves the built files and an event stream', async () => {
    let builds = 0
    const server = await startDevServer({ port: 0, build: () => ({ 'index.html': `<p>${++builds}</p>`, 'almanac.json': '{}' }) })
    try {
      expect(await (await fetch(server.url)).text()).toBe('<p>1</p>')
      expect((await fetch(`${server.url}almanac.json`)).headers.get('content-type')).toContain('application/json')
      expect((await fetch(`${server.url}missing`)).status).toBe(404)
      server.rebuild()
      expect(await (await fetch(server.url)).text()).toBe('<p>2</p>')
      const controller = new AbortController()
      const events = await fetch(`${server.url}__almanac/events`, { signal: controller.signal })
      expect(events.headers.get('content-type')).toBe('text/event-stream')
      controller.abort()
    } finally {
      await server.close()
    }
  })
})
