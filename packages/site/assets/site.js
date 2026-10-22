/* Feature Almanac site: search, unfolding feature panels, deep links and review. The page works without this script. */
(function () {
  'use strict'

  var root = document.documentElement
  root.classList.remove('no-js')
  root.classList.add('js')

  var options = JSON.parse(document.getElementById('almanac-search-options').textContent)
  var prefix = JSON.parse(document.getElementById('almanac-prefix').textContent)
  var index = window.MiniSearch.loadJSON(document.getElementById('almanac-search').textContent, options)
  var searchOptions = Object.assign({}, options.searchOptions, {
    fuzzy: function (term) {
      if (term.length > 7) return 2
      return term.length >= 4 ? 1 : false
    },
  })

  var input = document.getElementById('q')
  var clearButton = document.querySelector('.clear')
  var status = document.querySelector('.search-status')
  var noResults = document.querySelector('.no-results')
  var main = document.getElementById('main')
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'))
  var categories = Array.prototype.slice.call(document.querySelectorAll('.category'))
  var finder = document.querySelector('.finder')
  var nav = document.querySelector('.catnav')
  var navList = nav.querySelector('ul')
  var navLinks = Array.prototype.slice.call(nav.querySelectorAll('a'))
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  var OWN_FIELDS = { name: true, text: true }
  var MAX_MATCHES = 5
  var ID_RE = /^(?:[A-Z][A-Z0-9]{0,9}-)?([1-9]\d*(?:\.[1-9]\d*){0,2})(?:@[a-z][a-z0-9-]*)?$/i

  var terms = []
  var hitIds = {}
  var lastTrigger = null

  // Highlighting

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function clearMarks(scope) {
    var marks = scope.querySelectorAll('mark[data-hl]')
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i]
      var parent = mark.parentNode
      parent.replaceChild(document.createTextNode(mark.textContent), mark)
      parent.normalize()
    }
  }

  function highlight(scope, words) {
    clearMarks(scope)
    if (words.length === 0) return
    var pattern = new RegExp('(^|[^\\p{L}\\p{N}])(' + words.map(escapeRegExp).join('|') + ')', 'giu')
    var walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var parent = node.parentElement
        if (parent === null || parent.closest('script, style, svg, .chip, kbd, .sr, mark, .intro, .finder, .glitch, .ghost, .rv, .rv-legend, .card-review, .unfold:not(.open)') !== null) return NodeFilter.FILTER_REJECT
        return node.nodeValue.trim() === '' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      },
    })
    var nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(function (node) {
      var text = node.nodeValue
      pattern.lastIndex = 0
      if (pattern.test(text) === false) return
      pattern.lastIndex = 0
      var fragment = document.createDocumentFragment()
      var cursor = 0
      var match
      while ((match = pattern.exec(text)) !== null) {
        var start = match.index + match[1].length
        var end = start + match[2].length
        // Extend to the end of the word, so a prefix match marks the whole word.
        while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++
        if (start > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, start)))
        var mark = document.createElement('mark')
        mark.setAttribute('data-hl', '')
        mark.textContent = text.slice(start, end)
        fragment.appendChild(mark)
        cursor = end
        pattern.lastIndex = end
      }
      if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)))
      node.parentNode.replaceChild(fragment, node)
    })
  }

  // Search

  function normaliseId(raw) {
    var match = ID_RE.exec(raw.trim())
    if (match === null) return null
    if (prefix !== null && /^[A-Z]/i.test(raw.trim()) && raw.trim().toUpperCase().indexOf(prefix.toUpperCase() + '-') !== 0) return null
    return match[1]
  }

  function element(tag, className, text) {
    var node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  function renderMatches(card, behaviours) {
    var box = card.querySelector('.matches')
    box.textContent = ''
    box.hidden = behaviours.length === 0
    behaviours.slice(0, MAX_MATCHES).forEach(function (hit) {
      var link = element('a', 'match')
      link.href = '#' + hit.id
      var title = element('span', 'match-title')
      title.appendChild(element('span', 'chip', (prefix ? prefix + '-' : '') + hit.id))
      title.appendChild(element('span', '', hit.name))
      if (hit.removed) title.appendChild(element('span', 'tag-removed', 'Removed'))
      link.appendChild(title)
      link.appendChild(element('span', 'match-snippet', hit.snippet))
      box.appendChild(link)
    })
    if (behaviours.length > MAX_MATCHES) {
      box.appendChild(element('div', 'match-more', 'and ' + (behaviours.length - MAX_MATCHES) + ' more in this feature'))
    }
  }

  function setStatus(text, jump) {
    status.textContent = ''
    if (text) status.appendChild(element('span', '', text))
    if (jump) {
      var link = element('a', 'jump', 'Go to ' + jump.label)
      link.href = '#' + jump.id
      status.appendChild(link)
    }
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's')
  }

  /** "2 features · 3 behaviours match “clock” — Enter opens the first" */
  function summary(found, query) {
    var parts = []
    if (found.features > 0) parts.push(plural(found.features, 'feature'))
    if (found.behaviours > 0) parts.push(plural(found.behaviours, 'behaviour'))
    var single = found.features + found.behaviours === 1
    return parts.join(' · ') + (single ? ' matches' : ' match') + ' “' + query + '” — Enter opens the first'
  }

  function jumpTarget(query) {
    var id = normaliseId(query)
    if (id === null) return null
    var target = document.getElementById(id)
    if (target === null) return null
    var name = target.querySelector('h3, h4')
    return { id: id, label: (prefix ? prefix + '-' : '') + id + (name ? ' ' + name.textContent : '') }
  }

  function search(query) {
    var q = query.trim()
    clearButton.hidden = q === ''
    if (q === '') {
      terms = []
      hitIds = {}
      cards.forEach(function (card) {
        card.hidden = false
        renderMatches(card, [])
      })
      categories.forEach(function (category) {
        category.hidden = false
      })
      noResults.hidden = true
      setStatus('', null)
      highlight(main, [])
      syncNav()
      settleOpenPanel()
      revealResults()
      return
    }

    var results = index.search(q, searchOptions)
    var byFeature = {}
    var found = { features: 0, behaviours: 0 }
    var matched = {}
    hitIds = {}
    results.forEach(function (result) {
      var own = result.kind === 'feature' || Object.keys(result.match).some(function (term) {
        return result.match[term].some(function (field) {
          return OWN_FIELDS[field] === true
        })
      })
      if (own === false) return
      var entry = byFeature[result.featureId] || (byFeature[result.featureId] = { own: false, behaviours: [] })
      if (result.kind === 'feature') {
        entry.own = true
        found.features++
      } else {
        entry.behaviours.push(result)
        hitIds[result.id] = true
        found.behaviours++
      }
      result.terms.forEach(function (term) {
        matched[term] = true
      })
    })
    terms = Object.keys(matched)

    cards.forEach(function (card) {
      var entry = byFeature[card.dataset.feature]
      card.hidden = entry === undefined
      renderMatches(card, entry === undefined ? [] : entry.behaviours)
    })
    categories.forEach(function (category) {
      category.hidden = category.querySelector('.card:not([hidden])') === null
    })

    var jump = jumpTarget(q)
    var none = found.features + found.behaviours === 0
    noResults.hidden = none === false || jump !== null
    noResults.querySelector('.no-results-query').textContent = q
    setStatus(none ? '' : summary(found, q), jump)
    highlight(main, terms)
    syncNav()
    settleOpenPanel()
    revealResults()
  }

  /** Typing in the stuck search bar scrolls back up to the first result. */
  function revealResults() {
    var top = document.querySelector('.top').getBoundingClientRect().bottom + window.scrollY
    if (window.scrollY > top) window.scrollTo({ top: top, behavior: 'instant' })
  }

  // Category bar

  var current = null

  /** The bar lists only the categories a search leaves on the page. */
  function syncNav() {
    var any = false
    navLinks.forEach(function (link) {
      var category = document.getElementById('cat-' + link.dataset.category)
      link.parentElement.hidden = category.hidden
      if (category.hidden === false) any = true
    })
    nav.hidden = any === false
    current = undefined
    updateCurrent()
  }

  /** Marks the category under the bar, and scrolls the bar to keep it in view. */
  function updateCurrent() {
    var line = finder.getBoundingClientRect().bottom + 120
    var visible = categories.filter(function (category) {
      return category.hidden === false
    })
    var found = null
    visible.forEach(function (category) {
      if (category.getBoundingClientRect().top <= line) found = category
    })
    var atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    if (atEnd && found !== null) found = visible[visible.length - 1]
    // An open panel covers the categories below it, so the bar keeps to the panel's own category.
    if (openPanel !== null) {
      var panel = openPanel.getBoundingClientRect()
      if (panel.top <= line && panel.bottom > line) found = openPanel.closest('.category')
    }
    var id = found === null ? null : found.dataset.category
    if (id === current) return
    current = id
    navLinks.forEach(function (link) {
      var on = link.dataset.category === id
      link.classList.toggle('current', on)
      if (on) {
        var offset = link.getBoundingClientRect().left - navList.getBoundingClientRect().left
        navList.scrollBy({ left: offset - (navList.clientWidth - link.offsetWidth) / 2, behavior: reducedMotion.matches ? 'auto' : 'smooth' })
      }
    })
  }

  function syncFinderHeight() {
    root.style.setProperty('--finder-h', Math.round(finder.getBoundingClientRect().height) + 'px')
  }

  function firstResult() {
    var jump = jumpTarget(input.value)
    if (jump !== null) return '#' + jump.id
    var card = cards.filter(function (c) {
      return c.hidden === false
    })[0]
    if (card === undefined) return null
    var match = card.querySelector('.match')
    return (match || card.querySelector('.card-main')).getAttribute('href')
  }

  function syncUrl() {
    var params = new URLSearchParams(location.search)
    if (input.value.trim() === '') params.delete('q')
    else params.set('q', input.value)
    var query = params.toString()
    history.replaceState(history.state, '', location.pathname + (query ? '?' + query : '') + location.hash)
  }

  // Feature panels and deep links. A card unfolds into its panel over the cards around it; the URL names the open one.

  var openPanel = null
  var UNFOLD_MS = 260

  /** The element a fragment names (accepting `PD-1.2.3` and `1.2.3@android`), when it is a panel or inside one. */
  function panelTarget(fragment) {
    if (fragment === '') return null
    var target = document.getElementById(normaliseId(fragment) || fragment)
    if (target === null) return null
    var panel = target.classList.contains('unfold') ? target : target.closest('.unfold')
    return panel === null ? null : { target: target, panel: panel }
  }

  function cardOf(panel) {
    return panel.previousElementSibling
  }

  /** The transform that shrinks the panel back onto its card. */
  function ontoCard(panel) {
    var from = cardOf(panel).getBoundingClientRect()
    var to = panel.getBoundingClientRect()
    return 'translate(' + (from.left - to.left) + 'px, ' + (from.top - to.top) + 'px) scale(' + from.width / to.width + ', ' + from.height / to.height + ')'
  }

  /** Spreads the open panel across the whole grid; the stylesheet holds it the full height of the window. */
  function place(panel) {
    var list = panel.parentElement.getBoundingClientRect()
    panel.style.left = Math.round(list.left - 6) + 'px'
    panel.style.width = Math.round(list.width + 12) + 'px'
  }

  function show(panel, animate) {
    clearTimeout(panel.foldTimer)
    if (openPanel === panel) return
    if (openPanel !== null) hide(openPanel, false)
    var card = cardOf(panel)
    if (card.hidden) return
    openPanel = panel
    panel.classList.add('open')
    card.classList.add('open')
    card.querySelector('.card-main').setAttribute('aria-expanded', 'true')
    panel.closest('.category').classList.add('has-open')
    root.classList.add('panel-open')
    place(panel)
    panel.scrollTop = 0
    current = undefined
    if (animate === false || reducedMotion.matches) return
    panel.style.transition = 'none'
    panel.style.transform = ontoCard(panel)
    void panel.offsetWidth
    panel.style.transition = ''
    panel.style.transform = ''
  }

  function hide(panel, animate) {
    var card = cardOf(panel)
    if (openPanel === panel) openPanel = null
    root.classList.remove('panel-open')
    card.classList.remove('open')
    card.querySelector('.card-main').setAttribute('aria-expanded', 'false')
    function fold() {
      panel.classList.remove('open')
      panel.style.transform = ''
      var category = panel.closest('.category')
      if (category.querySelector('.unfold.open') === null) category.classList.remove('has-open')
      current = undefined
      updateCurrent()
    }
    if (animate === false || reducedMotion.matches || card.hidden) {
      fold()
      return
    }
    panel.style.transform = ontoCard(panel)
    panel.foldTimer = setTimeout(fold, UNFOLD_MS)
  }

  /** After a search: fold the open panel away if its card was filtered out, else move it with its card. */
  function settleOpenPanel() {
    if (openPanel === null) return
    if (cardOf(openPanel).hidden) hide(openPanel, false)
    else place(openPanel)
  }

  function route(animate) {
    var found = panelTarget(decodeURIComponent(location.hash.slice(1)))
    if (found === null) {
      if (openPanel !== null) hide(openPanel, animate !== false)
      if (lastTrigger !== null) lastTrigger.focus({ preventScroll: true })
      lastTrigger = null
      return
    }
    var panel = found.panel
    var target = found.target
    // Unfold from the card only when the panel itself was asked for; a behaviour link lands straight on its row.
    show(panel, animate !== false && target === panel)
    if (openPanel !== panel) return
    highlight(panel, terms)
    Array.prototype.forEach.call(panel.querySelectorAll('.behaviour'), function (item) {
      item.classList.toggle('hit', hitIds[item.id] === true)
    })
    panel.focus({ preventScroll: true })
    if (target !== panel) {
      var details = target.closest('details')
      if (details !== null) details.open = true
      target.scrollIntoView({ block: 'start' })
      target.classList.remove('flash')
      void target.offsetWidth
      target.classList.add('flash')
    }
  }

  function navigate(hash) {
    history.pushState(null, '', location.pathname + location.search + hash)
    route()
  }

  function close() {
    if (openPanel === null) return
    history.pushState(null, '', location.pathname + location.search)
    route()
  }

  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    var link = event.target.closest('a')
    if (link !== null) {
      if (link.classList.contains('close')) {
        event.preventDefault()
        close()
        return
      }
      var href = link.getAttribute('href') || ''
      if (href.charAt(0) === '#' && panelTarget(decodeURIComponent(href.slice(1))) !== null) {
        event.preventDefault()
        // A second click on the open card folds it away again.
        if (openPanel !== null && link.classList.contains('card-main') && link.closest('.card') === cardOf(openPanel)) {
          close()
          return
        }
        if (link.closest('.unfold') === null) lastTrigger = link
        navigate(href)
        return
      }
    }
    // A click anywhere else on the page, outside the search bar and review, folds the open panel away.
    if (openPanel !== null && openPanel.contains(event.target) === false && finder.contains(event.target) === false && reviewBox.contains(event.target) === false) close()
  })
  window.addEventListener('popstate', function () {
    route()
  })
  window.addEventListener('hashchange', function () {
    route()
  })

  document.addEventListener('keydown', function (event) {
    if (reviewBox.hidden === false) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (whyForm.hidden === false) cancelReject()
        else closeReview()
      }
      return
    }
    if (event.key === 'Escape' && openPanel !== null) {
      event.preventDefault()
      close()
      return
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable
    if (event.key === '/' && typing === false) {
      event.preventDefault()
      input.focus()
      input.select()
    }
  })

  input.addEventListener('input', function () {
    search(input.value)
    syncUrl()
  })
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && input.value !== '') {
      event.preventDefault()
      event.stopPropagation()
      input.value = ''
      search('')
      syncUrl()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      var href = firstResult()
      if (href !== null) navigate(href)
    }
  })
  clearButton.addEventListener('click', function () {
    input.value = ''
    search('')
    syncUrl()
    input.focus()
  })

  var ticking = false
  window.addEventListener(
    'scroll',
    function () {
      if (ticking) return
      ticking = true
      requestAnimationFrame(function () {
        ticking = false
        updateCurrent()
      })
    },
    { passive: true },
  )
  window.addEventListener('resize', function () {
    updateCurrent()
    if (openPanel !== null) place(openPanel)
  })
  if (window.ResizeObserver) new ResizeObserver(syncFinderHeight).observe(finder)
  syncFinderHeight()
  updateCurrent()

  // Light and dark. The head script picked the starting theme; the toggle remembers the reader's choice.
  document.querySelector('.theme-toggle').addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
    root.setAttribute('data-theme', next)
    try {
      localStorage.setItem('almanac-theme', next)
    } catch (error) {
      // Private windows can refuse storage; the choice then lasts for this page only.
    }
  })

  // Review: a reviewer approves or rejects behaviours one at a time. Decisions stay in this browser
  // until they download them as an `almanac apply` patch, which records each with the hash of the
  // text they judged, so a behaviour that has changed since isn't approved by mistake.

  var reviewBox = document.querySelector('.review')
  var reviewTrigger = document.querySelector('.review-open')
  var reviewBadge = reviewTrigger.querySelector('.review-badge')
  var scopeSelect = reviewBox.querySelector('.review-scope')
  var pendingOnly = reviewBox.querySelector('.review-pending')
  var progress = reviewBox.querySelector('.review-progress')
  var article = reviewBox.querySelector('.review-item')
  var done = reviewBox.querySelector('.review-done')
  var actions = reviewBox.querySelector('.review-actions')
  var whyForm = reviewBox.querySelector('.review-why')
  var whyText = whyForm.querySelector('textarea')
  var nameInput = reviewBox.querySelector('.review-name')
  var downloadButton = reviewBox.querySelector('.review-download')
  var clearReviewButton = reviewBox.querySelector('.review-clear')
  var REVIEW_KEY = 'almanac-review:' + (prefix || document.title)
  var NAME_KEY = 'almanac-reviewer'

  var reviewItems = Array.prototype.slice.call(document.querySelectorAll('.unfold .behaviour'))
    .filter(function (row) {
      return row.closest('.removed') === null
    })
    .map(function (row) {
      var panel = row.closest('.unfold')
      return {
        row: row,
        id: row.id,
        ref: row.querySelector('.chip').textContent,
        hash: row.dataset.hash,
        review: row.dataset.review || '',
        reviewBy: row.dataset.reviewBy || '',
        reviewNote: row.dataset.reviewNote || '',
        panel: panel,
        feature: panel.dataset.feature,
        category: row.closest('.category').dataset.category,
      }
    })
  var byId = {}
  reviewItems.forEach(function (item) {
    byId[item.id] = item
  })

  function readStore(key, fallback) {
    try {
      var value = localStorage.getItem(key)
      return value === null ? fallback : JSON.parse(value)
    } catch (error) {
      return fallback
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch (error) {
      // Without storage, decisions last until the page closes; downloading still works.
    }
  }

  // A decision on text that has changed since no longer applies; one the almanac already records is done.
  nameInput.value = readStore(NAME_KEY, '')
  var settled = window.almanacReviewStore.settle(readStore(REVIEW_KEY, {}), byId, nameInput.value)
  var decisions = settled.decisions
  var dropped = { changed: settled.changed, gone: settled.gone }
  writeStore(REVIEW_KEY, decisions)

  var queue = []
  var position = 0

  function today() {
    var now = new Date()
    var pad2 = function (n) {
      return (n < 10 ? '0' : '') + n
    }
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate())
  }

  function decidedCount() {
    return Object.keys(decisions).length
  }

  function needsDecision(item) {
    return item.review === '' || item.review === 'changed' || decisions[item.id] !== undefined
  }

  function buildQueue() {
    var scope = scopeSelect.value
    queue = reviewItems.filter(function (item) {
      if (scope.indexOf('feature:') === 0) {
        if (item.feature !== scope.slice(8)) return false
      } else if (scope !== '' && item.category !== scope) return false
      return pendingOnly.checked === false || needsDecision(item)
    })
    position = 0
    while (position < queue.length && decisions[queue[position].id] !== undefined) position++
    if (position === queue.length && queue.length > 0 && pendingOnly.checked === false) position = 0
  }

  function syncCounts() {
    var count = decidedCount()
    reviewBadge.hidden = count === 0
    reviewBadge.textContent = count
    reviewBox.querySelector('.review-count').textContent = count === 0 ? 'No decisions yet' : plural(count, 'decision')
    downloadButton.disabled = count === 0
    clearReviewButton.disabled = count === 0
  }

  function describeDecision(item) {
    var decision = decisions[item.id]
    if (decision === undefined) return ''
    return decision.state === 'approved' ? 'You approved this.' : 'You rejected this: ' + decision.note
  }

  function showItem() {
    whyForm.hidden = true
    var item = queue[position]
    var decided = queue.filter(function (entry) {
      return decisions[entry.id] !== undefined
    }).length
    article.hidden = item === undefined
    done.hidden = item !== undefined
    reviewBox.querySelector('.review-approve').disabled = item === undefined
    reviewBox.querySelector('.review-reject').disabled = item === undefined
    reviewBox.querySelector('.review-back').disabled = position === 0
    reviewBox.querySelector('.review-next').disabled = item === undefined
    var lead =
      (dropped.changed > 0 ? plural(dropped.changed, 'earlier decision') + ' dropped because the behaviour changed. ' : '') +
      (dropped.gone > 0 ? plural(dropped.gone, 'earlier decision') + ' dropped because the behaviour is no longer on the site. ' : '')
    progress.textContent = lead + (queue.length === 0 ? 'Nothing to show' : (item === undefined ? 'End' : 'Behaviour ' + (position + 1)) + ' of ' + queue.length + ' · ' + decided + ' decided')
    syncCounts()
    if (item === undefined) return
    reviewBox.querySelector('.review-context').textContent =
      document.getElementById('c-' + item.category).textContent + ' › ' + item.panel.querySelector('.unfold-title').textContent
    reviewBox.querySelector('.review-feature-desc').textContent = item.panel.querySelector('.lead').textContent.trim()
    var holder = reviewBox.querySelector('.review-behaviour')
    holder.textContent = ''
    Array.prototype.forEach.call(item.row.children, function (child) {
      var copy = child.cloneNode(true)
      clearMarks(copy)
      if (copy.tagName === 'A') copy.removeAttribute('href')
      holder.appendChild(copy)
    })
    var decision = decisions[item.id]
    reviewBox.querySelector('.review-decision').textContent = describeDecision(item)
    reviewBox.querySelector('.review-approve').setAttribute('aria-pressed', String(decision !== undefined && decision.state === 'approved'))
    reviewBox.querySelector('.review-reject').setAttribute('aria-pressed', String(decision !== undefined && decision.state === 'rejected'))
  }

  /** On to the next behaviour without a decision, or the end. */
  function advance() {
    var next = position + 1
    while (next < queue.length && decisions[queue[next].id] !== undefined) next++
    position = Math.min(next, queue.length)
    showItem()
  }

  function decide(state, note) {
    var item = queue[position]
    if (item === undefined) return
    decisions[item.id] = { state: state, hash: item.hash, date: today() }
    if (note) decisions[item.id].note = note
    writeStore(REVIEW_KEY, decisions)
    advance()
  }

  function startReject() {
    var item = queue[position]
    if (item === undefined) return
    var decision = decisions[item.id]
    whyText.value = decision !== undefined && decision.note ? decision.note : ''
    whyForm.hidden = false
    actions.hidden = true
    whyText.focus()
  }

  function cancelReject() {
    whyForm.hidden = true
    actions.hidden = false
    reviewBox.querySelector('.review-reject').focus()
  }

  function openReview(scope) {
    if (scope !== undefined) scopeSelect.value = scope
    reviewBox.hidden = false
    root.classList.add('reviewing')
    actions.hidden = false
    buildQueue()
    showItem()
    reviewBox.querySelector(queue.length > 0 ? '.review-approve' : '.review-close').focus()
  }

  function closeReview() {
    reviewBox.hidden = true
    root.classList.remove('reviewing')
    reviewTrigger.focus({ preventScroll: true })
  }

  function slug(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reviewer'
  }

  /** The decisions as an `almanac apply` patch, in page order. */
  function downloadDecisions() {
    var name = nameInput.value.trim()
    if (name === '') {
      progress.textContent = 'Add your name first, so the file says who decided.'
      nameInput.focus()
      return
    }
    var ops = reviewItems
      .filter(function (item) {
        return decisions[item.id] !== undefined
      })
      .map(function (item) {
        var decision = decisions[item.id]
        var op = { op: 'review', ref: item.ref, state: decision.state, by: name, date: decision.date, hash: decision.hash }
        if (decision.note) op.note = decision.note
        return op
      })
    if (ops.length === 0) return
    var patch = { almanac: 1, summary: 'Review by ' + name + '.', changelog: 'none', ops: ops }
    var url = URL.createObjectURL(new Blob([JSON.stringify(patch, null, 2) + '\n'], { type: 'application/json' }))
    var link = element('a')
    link.href = url
    link.download = 'review-' + slug(prefix || document.title) + '-' + slug(name) + '-' + today() + '.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(function () {
      URL.revokeObjectURL(url)
    }, 1000)
    progress.textContent = 'Downloaded ' + plural(ops.length, 'decision') + '. Send the file on, then clear them here.'
  }

  reviewTrigger.addEventListener('click', function () {
    openReview()
  })
  Array.prototype.forEach.call(document.querySelectorAll('.review-feature'), function (button) {
    button.addEventListener('click', function () {
      var id = button.dataset.feature
      var value = 'feature:' + id
      if (scopeSelect.querySelector('option[value="' + value + '"]') === null) {
        var option = element('option', '', 'Feature ' + (prefix ? prefix + '-' : '') + id + ' ' + document.getElementById('t-' + id).textContent)
        option.value = value
        scopeSelect.appendChild(option)
      }
      openReview(value)
    })
  })
  reviewBox.querySelector('.review-close').addEventListener('click', closeReview)
  reviewBox.querySelector('.review-approve').addEventListener('click', function () {
    decide('approved')
  })
  actions.querySelector('.review-reject').addEventListener('click', startReject)
  reviewBox.querySelector('.review-cancel').addEventListener('click', cancelReject)
  whyForm.addEventListener('submit', function (event) {
    event.preventDefault()
    var note = whyText.value.trim()
    if (note === '') {
      whyText.focus()
      return
    }
    actions.hidden = false
    decide('rejected', note)
    reviewBox.querySelector('.review-approve').focus()
  })
  reviewBox.querySelector('.review-back').addEventListener('click', function () {
    position = Math.max(0, position - 1)
    showItem()
  })
  reviewBox.querySelector('.review-next').addEventListener('click', function () {
    position = Math.min(position + 1, queue.length)
    showItem()
  })
  scopeSelect.addEventListener('change', function () {
    buildQueue()
    showItem()
  })
  pendingOnly.addEventListener('change', function () {
    buildQueue()
    showItem()
  })
  nameInput.addEventListener('input', function () {
    writeStore(NAME_KEY, nameInput.value.trim())
  })
  downloadButton.addEventListener('click', downloadDecisions)
  clearReviewButton.addEventListener('click', function () {
    if (window.confirm('Clear ' + plural(decidedCount(), 'decision') + '? Download them first if you haven’t sent them.') === false) return
    decisions = {}
    dropped = { changed: 0, gone: 0 }
    writeStore(REVIEW_KEY, decisions)
    buildQueue()
    showItem()
  })
  syncCounts()

  var initial = new URLSearchParams(location.search).get('q')
  if (initial) {
    input.value = initial
    search(initial)
  }
  route(false)
})()
