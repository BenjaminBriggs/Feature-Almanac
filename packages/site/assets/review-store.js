/* Feature Almanac site: which review decisions saved in the browser still need sending. Loaded before site.js. */
var almanacReviewStore = (function () {
  'use strict'

  /**
   * Sorts the decisions saved in this browser against the behaviours on the page (`items`, by ID, each with the
   * `hash` of its text and the review the almanac records). A decision on changed text, or on a behaviour no longer
   * on the page, is dropped and counted. One the almanac already records, by this reviewer (`name`) with the same
   * reason, is done and dropped silently. The rest are kept.
   */
  function settle(stored, items, name) {
    var decisions = {}
    var changed = 0
    var gone = 0
    Object.keys(stored).forEach(function (id) {
      var item = items[id]
      var decision = stored[id]
      if (item === undefined) gone++
      else if (item.hash !== decision.hash) changed++
      else if (recorded(item, decision, name) === false) decisions[id] = decision
    })
    return { decisions: decisions, changed: changed, gone: gone }
  }

  function recorded(item, decision, name) {
    return item.review === decision.state && name !== '' && item.reviewBy === name && item.reviewNote === (decision.note || '')
  }

  return { settle: settle }
})()
