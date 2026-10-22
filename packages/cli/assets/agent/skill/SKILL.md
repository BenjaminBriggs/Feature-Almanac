---
name: almanac
description: Read and maintain this product's almanac, the current-state specification of every category, feature and behaviour, with stable IDs such as PD-1.2.3. Use when asked how part of the app works, when a code change alters what the app does (update the almanac in the same change), when citing behaviour IDs in tickets, PRs or commits, and when generating or verifying the almanac from code.
---

# Feature Almanac

An almanac describes what the app does **now**, per platform, as Category → Feature → Behaviour:

- **Category** `N`: an area of the product (Editing, Sync). Folder `NN-slug/` with `category.yaml`.
- **Feature** `N.M`: a user-facing capability. One file `NN-slug.yaml` in its category folder.
- **Behaviour** `N.M.K`: one observable outcome of a feature, listed inside the feature file.
- **Variant** `N.M.K@platform`: a platform-specific difference inside a behaviour (a different gesture, menu or UI for the same outcome).

The root holds `almanac.yaml` (product, prefix, platforms, statuses). Find it with `almanac lint`; it searches upwards and also checks `almanac/` folders.

## Rules

1. **Never edit almanac YAML by hand.** Every change goes through the CLI: `almanac apply` for batches, or `add`, `set`, `describe`, `rename`, `remove`, `mv` and `changelog add` for one change. They allocate IDs, keep `formerly` and the counters right, move files when names change, and write the changelog. IDs are never reused or renumbered. The one exception is `almanac.yaml` itself (platforms, owners, `code:`), which you edit directly.
2. **Describe what a user can observe, not the implementation.** "The note is saved after 1 second of idle input", not "AutosaveController debounces writes". One outcome per behaviour, written as Given/When/Then (next section).
3. **Cite code.** Every behaviour inferred from code gets `source: ["path/to/File.swift#symbol"]`, with paths relative to `code.path` in almanac.yaml. Don't write behaviours you cannot point at.
4. **Platforms by exception.** Everything applies to every platform unless narrowed. Same outcome, different mechanics → a variant. Different outcome, or only some platforms → a behaviour with `platforms`.
5. **Status is a fact, not a guess.** Code that ships is `shipped`; behind a flag or unfinished is `in-progress`; `planned` only when the user says so.
6. **Lint after every write**: `almanac lint --json`. Fix every error before finishing. A write that would add errors is rejected and nothing is written; the rejection lists the errors it would have added.
7. **Cite IDs** (`PD-1.2.3`) in tickets, PR descriptions and commit messages.
8. **Removing is a tombstone.** `remove` keeps the entity with `status: removed` and a `removed_reason`; nothing is deleted. Remove only what the user confirms is gone, and never to tidy up.
9. **Reviews come from people.** A behaviour's `review:` records a person's approval or rejection, made on the website and recorded with `almanac apply` of the file they download. Never write `review` ops yourself, and never edit a behaviour just to make a review current. Changing a behaviour's text is fine: its review lapses on its own and the behaviour goes back in the queue. Treat a rejection's `note` as the product's view of how the behaviour should work, and raise it with the user rather than resolving it silently.

## Writing behaviours: Given / When / Then

Write each behaviour's description as one plain summary line followed by Gherkin (cucumber) steps. Gherkin is the default format, so these behaviours need no `format` field. Plain prose is still allowed for a behaviour with no trigger at all, such as a fixed fact about a screen, and needs `format: prose`.

- **Summary**: the first line, one sentence saying what the behaviour does, in words a support agent would use. The site shows it above the steps. Don't repeat the `name`, leave the details to the steps, and don't start it with Given, When, Then, And or But, or it's read as a step.

- **Given**: where the user starts. What's on screen, what data exists, what they've already done. Leave it out when nothing needs to be true first.
- **When**: the one thing that happens, such as a tap, click, keystroke, gesture, notification or time passing. Name controls by their visible label, in quotes.
- **Then**: what the user can observe as a result, with the numbers that matter (timings, limits, counts). Add more outcomes with **And**, and use **But** for what deliberately stays the same.
- Write about "the user", not "I", and never about code: no class, method or API names.
- **One scenario per behaviour.** The behaviour's `name` is the scenario's name. A second `Scenario:` block is fine when the same outcome has two distinct triggers or starting points; a different outcome is a different behaviour.
- **Variants stay prose:** one sentence on how the platform differs, for example "On a Mac, the When is ⌘B or Format ▸ Bold".

```gherkin
Saves the note a second after the user stops typing.
Given a note with unsaved edits
When the user stops typing for 1 second
Then the note is saved
But the cursor and selection don't move
```

Avoid "AutosaveController debounces writes", which is implementation, and "The note saves automatically", which has no trigger and no timing.

In a patch, a behaviour's description is one string: `"description": "Saves the note …\nGiven …\nWhen …\nThen …"`. To convert an existing prose behaviour, `set` its format to `gherkin` and `describe` it in the same `apply` patch; two separate commands would leave it half converted. When you rewrite a prose behaviour for any other reason, convert it at the same time, and add a summary line to a Gherkin behaviour that lacks one. `almanac lint` warns (ALM-W015) about a gherkin description with no Given/When/Then steps, which is also what prose without `format: prose` produces.

## Reading

```bash
almanac list --json                        # features (use --level category|behaviour, --category N, --feature N.M)
almanac list --review rejected --json      # behaviours a reviewer rejected, with their note (also unreviewed|changed|approved|needed)
almanac show PD-1.2 --json                 # one entity; --platform android resolves variants
almanac show 1.2.3 --with-changelog        # Markdown, with history
almanac build --out /tmp/almanac.json     # the whole compiled model, for broad questions
almanac next-id 1.2                        # the ID the next behaviour in 1.2 will get (next-id 1: next feature; no argument: next category)
```

Old IDs keep working: after a move, `show 1.2.3` prints the entity's new ID with a `note: 1.2.3 is now 3.1.4`. Cite the new ID.

## Writing

### One change

Each command writes one changelog entry on the feature it touches; `--summary` replaces the generated summary. Add `--dry-run` (before the command) to see the diff first.

```bash
almanac set PD-1.2.3 status.android=in-progress           # one platform's status; status=shipped sets every platform
almanac set 1.2.3 source=Sources/Editor/Bold.swift#toggle tags=formatting,core
almanac set 1.2.3 flag=                                   # an empty value unsets the key
almanac set 1.2.3@android status=shipped                  # variants are edited by their ref
almanac describe 1.2.3 - <<'EOF'
Given text is selected in a note
When the user taps "Bold"
Then the selection becomes bold
And tapping "Bold" again makes it plain
EOF
almanac describe 1.2 --overview --description-file overview.md
almanac rename 1.2 --name "Note editor"                   # the file (or a category's folder) is renamed too
almanac remove 1.2.3 --reason "Replaced by the formatting toolbar in 2.4."
almanac remove 1.2.3@android --reason "Android uses the system text menu."
almanac mv 1.2.3 --to 3.1                                 # behaviour → another feature; the new ID is printed
almanac mv 1.2 --to 3                                     # feature → another category; its behaviours are re-IDed with it
almanac changelog add 1.2 --summary "Verified against code." --change modified:1.2.3 --change modified:1.2.4
```

- `set` keys: `status`, `since`, `platforms`, `source`, `tags`, `owner`, `format`, `flag`, `depends_on`, `related`, `code`, `assets`, `links` (JSON), `removed_reason`, and `fields.<key>`. `status.<platform>` and `since.<platform>` change one platform. Lists are comma-separated. Use `rename` for `name` and `describe` for `description`/`overview`; IDs, counters and `formerly` can't be set.
- A variant's own status wins on its platforms. If `set 1.2.3 status.android=…` is refused for that reason, set the variant: `set 1.2.3@android status=…`.
- To remove a behaviour on one platform only: `set 1.2.3 status.android=removed removed_reason="Dropped on Android."`.
- `mv` records the old ID in `formerly`, writes `moved` in the changelogs of both features, and updates `depends_on`/`related` that point at a moved feature. Categories never move; variants move with their behaviour.
- `changelog add --change` takes `added:REF`, `modified:REF`, `removed:REF`, `moved:FROM:TO` or `feature:added|modified|removed`, plus `--release <version>`, `--ticket`, `--author` and `--platforms`. You only need it for changes that no command records: a behaviour you verified, or several edits you want to describe as one.

### Batches

Use `apply` for anything bigger than one or two changes, reading the patch from stdin. It runs the ops in order, so later ops see earlier results, and writes one changelog entry per touched feature. Use `--dry-run` first to see the diff:

```bash
almanac --dry-run apply - <<'EOF'
{
  "almanac": 1,
  "summary": "Initial almanac.",
  "ops": [
    { "op": "add", "level": "category", "as": "$editing", "name": "Editing",
      "description": "Creating, formatting and saving notes." },
    { "op": "add", "level": "feature", "parent": "$editing", "as": "$editor", "name": "Markdown editor",
      "description": "Rich editing of notes with live preview.", "owner": "ben", "status": "shipped" },
    { "op": "add", "level": "behaviour", "parent": "$editor", "as": "$bold", "name": "Bold formatting",
      "source": ["Sources/Editor/EditorView.swift#toggleBold"], "format": "gherkin",
      "description": "Given text is selected in a note\nWhen the user taps \"Bold\"\nThen the selection becomes bold\nAnd tapping \"Bold\" again makes it plain" },
    { "op": "add", "level": "variant", "parent": "$bold", "platforms": ["android"], "status": "in-progress",
      "description": "Triggered from the formatting bar above the keyboard." }
  ],
  "changelog": "auto"
}
EOF
```

Then run the same command without `--dry-run`.

- `add` ops: `level` and `parent`. `parent` is a category ID for features, a feature ID for behaviours, a behaviour ID for variants, or a `$name` set by an earlier op's `as`. Required fields are `name` and `description`, plus `owner` for features. Optional fields are `platforms` (tags, groups, `"!tag"` to exclude), `status` (a string or a per-platform map), `since`, `source`, `tags`, `format` (`gherkin` for Given/When/Then text), `flag`, and `mode` (`append` or `replace`, variants only).
- Edit ops name their entity with `ref`, which takes an ID, a variant ref or a `$name`:
  - `{ "op": "set", "ref": "1.2.3", "values": { "status.android": "shipped", "tags": ["core"], "flag": null } }`. `null` unsets a key.
  - `{ "op": "describe", "ref": "1.2.3", "description": "…" }`, or `"overview": "…"` for a feature.
  - `{ "op": "rename", "ref": "1.2", "name": "Note editor" }`
  - `{ "op": "remove", "ref": "1.2.3@android", "reason": "…" }`
  - `{ "op": "move", "ref": "1.2.3", "to": "3.1" }`
- `"changelog": "auto"` (the default) writes one entry per touched feature, using the patch's `summary`, `version` and `ticket`; without a `summary` it joins the ops' own summaries. `"changelog": [{ "feature": "1.2", "summary": "…", "changes": [{ "modified": "1.2.3" }] }]` writes exactly the entries you give, and `"none"` writes none.

## Keeping it current

When code changes what the app does, update the almanac in the same change. `almanac affected` shows where to start: the features and behaviours whose `source` (or a feature's `code`) cites a file the change touched, and the changed files nothing cites yet.

```bash
almanac affected --json                     # uncommitted work
almanac affected --base main --json         # everything on this branch since it left main
almanac affected abc123 --json              # one commit
almanac affected main...HEAD --json         # a range
gh pr diff 123 --name-only | almanac affected --files - --json   # a pull request
```

When the change renames or moves files, run `almanac relink` with the same change first: it repoints `source` and `code` entries at the new paths, keeping each `#symbol`, and writes no changelog. A cited file changing doesn't mean the behaviour changed: read the diff and update only what a user would notice. Record the pull request or commit as the patch's `ticket`. `almanac affected --check` exits 1 when cited code changed but no almanac file did, for CI.

## Viewing

`almanac site serve --open` serves the site with search and live reload. `almanac site build` writes `dist/site/index.html`, one self-contained page.
