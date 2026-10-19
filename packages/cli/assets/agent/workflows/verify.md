---
description: Check almanac behaviours against the code they cite
argument-hint: "[feature or behaviour IDs, default: everything]"
input: the feature or behaviour IDs to check
when: Use when asked to verify, audit or refresh the almanac against the code, or after large code changes.
---

Input: {{input}}

Verify the almanac against the code. Scope: the IDs in the input, or every feature if there are none. Follow the `almanac` skill's rules.

For each behaviour in scope (`almanac show <feature> --json` lists them with `source`):

1. Open every `source` path, plus each variant's `source`. If a path or symbol no longer exists, that's a mismatch.
2. Check that the description states what the code actually does: triggers, timings, limits, platform differences and status. Check what is missing as well as what is wrong.
3. Classify each behaviour as **confirmed**, **corrected** (wording, platforms or status were wrong), **unsupported** (no code does this) or **missing** (the code does something observable that no behaviour covers).

Fix corrected behaviours with one `almanac apply` patch per feature, using `set` and `describe` ops (`"summary": "Verified against code."`). Write each corrected description as a one-line summary followed by Given/When/Then; a prose behaviour you correct also gets `format: gherkin` in the same patch. Never edit the YAML by hand. Add missing behaviours with `add` ops in the same patch, written the same way. Don't remove unsupported behaviours: list them for the user, because removal leaves a tombstone and needs a reason.

Run `almanac lint` and finish with a table: ID, name, result, what changed.
