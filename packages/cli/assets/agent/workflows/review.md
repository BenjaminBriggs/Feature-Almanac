---
description: Record a reviewer's decisions file from the almanac website, then work through the rejections
argument-hint: "[review file, such as review-pd-sam-price-2026-10-20.json]"
input: the review file
when: Use when given a review file downloaded from the almanac website, or asked to deal with rejected behaviours.
---

Input: {{input}}

Someone who knows how the product should behave approved or rejected behaviours on the almanac website and downloaded their decisions. Record them, then work out what each rejection needs. Follow the `almanac` skill's rules throughout. A review is a person's verdict: never write `review` ops of your own, and never change a behaviour just to clear a rejection. Don't commit unless the user asks.

## 1. Record the decisions

If the input names a file:

1. `almanac --dry-run apply <file>`, then `almanac apply <file>`.
2. Note what it reports. It records each decision with the reviewer's name, date and note. It skips any decision on a behaviour whose text changed after the reviewer saw it; those behaviours are back in the reviewer's queue, so list them for the user rather than recording anything yourself.

With no file, work on the rejections already recorded.

## 2. Gather the rejections

`almanac list --review rejected --json` lists every current rejection; each one's `review.note` is the reviewer's own words on what should happen instead. Mark which came from this file (same `by` and `date`); deal with those first, and mention any older ones still open.

## 3. Triage each rejection

Read the behaviour (`almanac show <ref> --json`) and the code its `source` cites. The almanac describes what the app does now, so decide which of these it is:

- **The description is wrong.** The code doesn't do what the behaviour says. Correct the behaviour to match the code: one `almanac apply` patch per feature with `describe` (and `set` where needed), `"summary": "Corrected after review."`. Its review lapses on its own and it returns to the reviewer's queue. Say so, because the reviewer has to look again.
- **The code disagrees with the product.** The behaviour describes the code correctly; the reviewer wants something different. Leave the almanac alone. Draft a ticket: a title; the behaviour ID; what happens now (the behaviour's Given/When/Then); what the reviewer wants (their note); the cited files and symbols. Don't file it unless the user asks (then `gh issue create`, citing the ID). When the code is later changed, the update workflow rewrites the behaviour and the reviewer sees it again.
- **Unclear.** The note is ambiguous, contradicts another behaviour, or asks something the code can't settle (wording, scope, priority). Write the question you'd put to the reviewer.

## 4. Report

- `almanac lint`, fixing every error.
- A table: ID, name, the reviewer's note, verdict (almanac corrected, code change needed, or question), and what you did or propose.
- Then: decisions skipped because the behaviour had changed, the drafted tickets in full, and the questions for the reviewer.
