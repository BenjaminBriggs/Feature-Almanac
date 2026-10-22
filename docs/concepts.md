# Concepts

An almanac describes what an app does **now**, per platform, as a tree of categories, features and behaviours.

## The model

| Level | ID | What it is |
|---|---|---|
| **Category** | `1` | An area of the product a non-developer would recognise, such as Editing or Sync. A folder with a `category.yaml`. |
| **Feature** | `1.2` | A user-facing capability you can describe in one line. One YAML file in its category's folder. |
| **Behaviour** | `1.2.3` | One observable outcome of a feature: what the user does, what happens, and the limits. Listed inside the feature's file. |
| **Variant** | `1.2.3@android` | How a behaviour differs on one platform, such as a different gesture or menu for the same outcome. |

- **IDs are stable.** They are never reused or renumbered. With the product's prefix they read `EX-1.2.3`, and you can cite them in tickets, pull requests and commits.
- **Moves keep the old ID.** Moving a behaviour or feature records its old ID in `formerly`, so old citations still resolve: `almanac show 1.2.3` prints the new ID.
- **Nothing is deleted.** Removing something leaves a tombstone with `status: removed` and a `removed_reason`.
- **Status is per platform.** Each platform is `planned`, `in-progress`, `shipped`, `deprecated` or `removed`. Everything applies to every platform unless narrowed.
- **Behaviours cite code.** `source: [Sources/Editor/EditorView.swift#toggleBold]` is a path relative to `code.path` in `almanac.yaml`, with an optional symbol, so an agent can check the almanac against the code. Lint warns (`ALM-W013`) when a cited file doesn't exist; it doesn't check symbols, and it needs `code:` in `almanac.yaml` to check anything.
- **Every write is recorded.** Each feature has a changelog, which the CLI writes for you.
- **Product people agree it.** A reviewer approves or rejects each behaviour on the website. An approval names who gave it and lapses when the behaviour's text changes. See [Reviewing behaviours](reviewing.md).

## Writing behaviours

A behaviour's description is a one-line summary followed by Gherkin (cucumber) steps:

```gherkin
Saves the note a second after the user stops typing.
Given a note with unsaved edits
When the user stops typing for 1 second
Then the note is saved
But the cursor and selection don't move
```

- **Summary**: one plain sentence saying what the behaviour does, in words a support agent would use. The website shows it above the steps. Don't start it with Given, When, Then, And or But, or it's read as a step.
- **Given**: where the user starts. Leave it out when nothing needs to be true first.
- **When**: the one thing that happens, such as a tap, a keystroke, a notification or time passing. Controls are named by their visible label, in quotes.
- **Then**: what the user can observe, with the numbers that matter. **And** adds outcomes, and **But** says what deliberately stays the same.
- **Scenarios**: a second `Scenario:` block is fine when the same outcome has two distinct triggers or starting points. A different outcome is a different behaviour.
- **Variants** are one sentence of prose on how the platform differs.

Gherkin is the default format and the schema doesn't enforce it. A behaviour with no trigger at all, such as a fixed fact about a screen, can be prose with `format: prose`. `almanac lint` warns (`ALM-W015`) when a Gherkin description has no Given/When/Then steps, which is also what prose without `format: prose` produces.

## The files

```
almanac/
├── almanac.yaml                     product, prefix, platforms, owners, settings
├── 01-editing/
│   ├── category.yaml                category 1: Editing
│   ├── 01-markdown-editor.yaml      feature 1.1, with its behaviours and changelog
│   └── 02-autosave.yaml             feature 1.2
└── 02-sync/
    └── …
```

You edit `almanac.yaml` directly:

```yaml
almanac: 1
next_category: 3
product:
  name: Example Notes
  prefix: EX                         # IDs read EX-1.2.3
  description: Write, format and sync notes.
code:                                # where `source` paths point
  repo: https://github.com/example/notes
  ref: main
  path: ..                           # the code root, relative to almanac.yaml
platforms:
  ios: { name: iOS }
  android: { name: Android }
platform_groups:                     # optional shorthands for `platforms`
  mobile: [ios, android]
owners:
  ben: { name: Ben Briggs }
formats:                             # optional; gherkin is the default
  default: gherkin
site:                                # optional; see the website page
  title: Example Notes
```

Change category and feature files **only through the CLI**, so IDs, counters, file names, `formerly` and changelogs stay right. A feature file looks like this:

```yaml
id: "1.1"
name: Markdown editor
description: Rich editing of notes with live preview.
owner: ben
status: { ios: shipped, android: in-progress }
next_behaviour: 3

behaviours:
  - id: "1.1.1"
    name: Bold formatting
    description: |
      Makes the selected text bold, or the text typed next.
      Given a note is open for editing
      When the user presses ⌘B or taps "Bold"
      Then the selected text is bold
      But with nothing selected, the text typed next is bold instead
    source: [Sources/Editor/EditorView.swift#toggleBold]
    variants:
      - platforms: [android]
        status: in-progress
        description: On Android, "Bold" is in the formatting bar above the keyboard.
  - id: "1.1.2"
    name: Word count
    format: prose
    description: The word count in the toolbar counts words in the whole note, not the selection.

changelog:
  - date: "2026-10-12"
    version: "2.4"
    summary: Bold from the keyboard.
    changes:
      - modified: "1.1.1"
```
