import type { Behaviour } from './model.js'

export const REVIEW_FILTERS = ['unreviewed', 'changed', 'approved', 'rejected', 'needed'] as const
export type ReviewFilter = (typeof REVIEW_FILTERS)[number]

/**
 * Where a behaviour stands with its reviewers. A verdict on text that has changed since is `changed`,
 * whatever it was, because it no longer applies.
 */
export function reviewState(behaviour: Pick<Behaviour, 'review'>): 'unreviewed' | 'changed' | 'approved' | 'rejected' {
  const review = behaviour.review
  if (review === undefined) return 'unreviewed'
  return review.stale ? 'changed' : review.state
}

/** `needed` is what the review queue shows: never reviewed, or changed since. */
export function matchesReview(behaviour: Pick<Behaviour, 'review'>, filter: ReviewFilter): boolean {
  const state = reviewState(behaviour)
  return filter === 'needed' ? state === 'unreviewed' || state === 'changed' : state === filter
}
