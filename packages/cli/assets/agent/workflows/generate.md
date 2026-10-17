---
description: Build the initial almanac for this codebase from its code
argument-hint: "[path to the code, default: this repository]"
input: the path to the code
when: Use when asked to create, generate or bootstrap a Feature Almanac for a codebase that has none yet.
---

Input: {{input}}

Build the initial almanac for the codebase at the path in the input, or this repository if there is none. Follow the `almanac` skill's rules throughout. Work in four stages and stop for the user's approval after stage 1.

## 0. Set up

- Run `almanac lint`. If it says there is no `almanac.yaml`, find the product name, a short reference prefix (2–4 capitals, e.g. `PD`) and the platforms it ships on: Xcode targets and destinations, Android modules, web apps. Run `almanac init --product "<name>" --prefix <PREFIX> --platforms <tags>` from the repository root, which creates `almanac/`. Ask the user only if the product name or prefix is genuinely unclear.
- Set `code:` in `almanac/almanac.yaml` so that `source` paths resolve. For example, `code: { path: .. }` when `almanac/` sits in the repository root; add `repo:` and `ref:` when there is a GitHub remote. If the product spans several repositories, use the folder that contains them all as `code.path`.
- Add the product's owners to `owners:` (ask the user who owns what if it isn't obvious; otherwise use a single owner).

## 1. Inventory: categories and features only

Scan for what a user can do: app targets, scenes and windows, screens and views, navigation, menus and commands, settings, widgets, App Intents and shortcuts, extensions (share, notifications), URL schemes and deep links, background work, entitlements, API endpoints and admin pages.

- **Categories**: 4–10 areas a non-developer would recognise.
- **Features**: user-facing capabilities, each of which can be described in one line. Aim for 3–12 per category.

Write the structure as one `apply` patch (categories and features, no behaviours) and run it with `--dry-run`. Show the user a table of category → features, each with a one-line description and platforms, then **wait for approval**. Apply it once approved.

## 2. Behaviours, one feature at a time

For each feature, read its code and write its behaviours:

- One observable outcome each, typically 3–15 per feature, written for support staff and QA: what the user does, what happens, the limits (timings, counts, what stays unchanged).
- `source` on every behaviour, pointing at the file and symbol that implements it.
- Platform differences as variants. A behaviour that exists only on some platforms gets `platforms`.
- Use `format: gherkin` only for flows that read naturally as Given/When/Then.
- `status: in-progress` for code behind a feature flag or not yet reachable. Record the flag as `flag`.

Apply one patch per feature with `"summary": "Initial almanac."` and `"changelog": "auto"`. Run `almanac lint` after each.

## 3. Verify

Verify every feature with {{verify}}, in a fresh subagent or session if you can, so the check doesn't reuse your own reading of the code. Fix or report every mismatch it finds.

## 4. Finish

- `almanac lint --strict --require-source`, fixing everything it reports.
- `almanac fmt`.
- Tell the user to run `almanac site serve --open` to review it, and summarise what you created: categories, features, behaviour counts, and anything you were unsure about.
