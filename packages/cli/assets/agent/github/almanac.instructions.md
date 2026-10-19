---
applyTo: "YOUR_SOURCE_GLOBS,almanac/**"
---

# Feature Almanac review

This repository keeps a Feature Almanac in `almanac/`: a spec of everything the app does, as categories, features and behaviours. Each behaviour has a stable ID (for example `PD-3.3.2`), a description of one outcome a user can observe (often Given/When/Then), its platforms and status, and a `source` citing the code that implements it as `path#symbol`, relative to `code.path` in `almanac/almanac.yaml`. The almanac changes in the same pull request as the code it describes.

When reviewing a pull request, check both directions.

## Code changes that alter documented behaviour

For each changed source file, look in `almanac/` for behaviours whose `source` (or a variant's `source`) cites that file, or for features whose `code` covers it. Then:

- If the change alters something a behaviour describes (a trigger, timing, limit, wording a user sees, platform difference or status) and the pull request doesn't update that behaviour, comment on the changed line. Cite the behaviour ID and name, quote the part that's no longer true, and suggest the new wording.
- If the change renames or moves a cited symbol or file and the `source` still points at the old one, flag the stale citation by behaviour ID.
- If the change removes something a behaviour describes, say so and cite the ID. Removing a behaviour leaves a tombstone and is the author's decision, so ask rather than suggesting the YAML.
- If the change adds something a user can observe that no behaviour covers, suggest adding one to the feature it belongs to.
- Don't comment on refactors, renames of internal names or test-only changes that leave every behaviour true.

## Almanac edits that don't match the code

For each changed behaviour in `almanac/`, open the `source` it cites as the pull request leaves it:

- Flag a description that claims something the code doesn't do, or misses a condition, limit or platform difference the code has. Cite the ID and the line of code.
- Flag a `source` path or `#symbol` that doesn't exist.
- Flag a status that contradicts the code, such as `shipped` for something behind a disabled flag.
- Flag an ID that changed or was reused. IDs are permanent: a removed behaviour stays as a tombstone with `status: removed` and a `removed_reason`.

## How to comment

- Always cite behaviour IDs, such as "`PD-3.3.2` (Bold formatting) says … but `Editor.swift#toggleBold` now …".
- Be specific and brief. Suggest the corrected description when you can.
- Almanac files are written by the `almanac` CLI. Suggest the change, and the author can apply it with the update workflow (`/almanac-update`) or `almanac apply` rather than editing the YAML by hand.
