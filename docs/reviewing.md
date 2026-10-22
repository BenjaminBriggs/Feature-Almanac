# Reviewing behaviours

Someone who knows how the product should behave, but doesn't work in the code, can agree the almanac from the website. There's nothing to install: the published site is enough.

Every behaviour carries its review state as a tag beside its name: **Approved**, **Rejected**, **Changed since review** or **Not reviewed**. Below the steps a line says who decided, when, and for a rejection, why. Each feature's card shows a bar of those states and how many are approved, its panel counts each state, and the hero shows the totals, so a reviewer can see what's left and a developer can spot rejections at a glance.

## How a review works

1. **Review.** **Review** in the search bar shows one behaviour at a time: its category and feature for context, the summary, the steps, the platforms and the variants. **Approve** if that's how the product should behave. **Reject** if it isn't, and say what it should do instead (a reason is required). **Skip** and **Back** move without deciding. By default it shows only what needs a decision: behaviours nobody has reviewed, ones that changed after their review, and ones already decided in this browser. Choose a category to work through one area at a time, or start from a feature's **Review these**.
2. **Download.** Decisions are kept in the reviewer's browser. To hand them over, they enter their name and press **Download decisions**, which saves a file such as `review-ex-sam-price-2026-10-20.json` for whoever looks after the almanac. The decisions stay in the browser until the reviewer presses **Clear**.
3. **Record.** The file is an ordinary patch of `review` ops, so recording it is one command, followed by a commit:

   ```bash
   almanac apply review-ex-sam-price-2026-10-20.json
   ```

   ```
   Recorded 41 reviews
   Wrote 6 files
   Skipped: EX-1.2.3 changed after it was reviewed; review it again
   ```

## What's stored

Each verdict is stored on its behaviour with a hash of the text the reviewer saw:

```yaml
  - id: "1.1.2"
    name: Autosave
    description: |
      …
    review:
      state: rejected
      by: Sam Price
      date: "2026-10-20"
      note: It should save on every change, not after a pause.
      hash: "3f9a1c2e"
```

The hash covers the name, the description and each variant's platforms, mode and text, but not status, the behaviour's own platforms or its sources. When the text changes, the review stays in the file but no longer counts: the site shows "Changed since Sam Price approved it" and puts the behaviour back in the review queue. A decision on text that changed between review and `apply` is skipped and reported, as above, rather than recorded against words the reviewer never read.

`almanac show` prints each behaviour's review, and `almanac list --review unreviewed|changed|approved|rejected|needed` lists behaviours by review. Reviews write no changelog entry, because they change nothing about the behaviour; git history keeps the trail.

## Acting on rejections

A rejection changes nothing about the behaviour: the almanac still describes what the app does today, and the rejection records that the product wants something else. `almanac list --review rejected` is the work list.

The **review** workflow (`/almanac-review <file>`) applies the file, then takes each rejection in turn:

- If the behaviour misdescribes the code, it corrects the behaviour, which sends it back to the reviewer.
- If the code is what the reviewer disagrees with, it drafts a ticket citing the ID and the reviewer's note, and leaves the almanac alone.
- If it can't tell, it writes a question for the reviewer.

When the code changes later, the update workflow rewrites the behaviour, and the reviewer sees it again.
