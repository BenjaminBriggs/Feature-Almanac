---
description: Update the almanac for a code change: a pull request, a commit, a range or uncommitted work
argument-hint: "[PR number or URL, commit, or range; default: uncommitted changes]"
input: the pull request, commit or range
when: Use when asked to update the almanac for a pull request, a commit or a branch, or when a code change alters what the app does.
---

Input: {{input}}

Bring the almanac in line with the code after the change named in the input. Follow the `almanac` skill's rules throughout. The almanac edits belong in the same change as the code, so write them to the working tree; don't commit, push or switch branches unless the user asks.

## 1. Find the change

Work out what the input names and get two things for it: the list of changed files, run through `almanac affected`, and the diff itself.

| Input | Affected entities | The diff |
|---|---|---|
| A pull request (`123`, `#123` or its URL) | `gh pr diff 123 --name-only \| almanac affected --files - --json` | `gh pr diff 123`, plus `gh pr view 123 --json title,body,url,headRefOid` for its intent |
| A commit | `almanac affected <sha> --json` | `git show <sha>` |
| A range (`main..feature`, `main...HEAD`) | `almanac affected <range> --json` | `git diff <range>` and `git log --oneline <range>` |
| Nothing | `almanac affected --json` (uncommitted work) | `git diff HEAD`. If that's empty, use the branch: `almanac affected --base main --json` and `git diff main...HEAD` |

To read a whole file as the pull request leaves it, without checking it out: `git fetch origin pull/123/head` (GitHub), then `git show FETCH_HEAD:<path>`. Use the title, description and commit messages for intent, but trust the diff.

## 2. Follow moved files

If the change renames or moves files, repoint the almanac at them before anything else: `almanac --dry-run relink <same change>`, then `almanac relink <same change>`. For a pull request, the change is `--files -` fed from `gh pr diff 123 --name-only`. That list holds no renames, so fetch the head first (`git fetch origin pull/123/head`) and use `almanac relink <base>...FETCH_HEAD`. Relink keeps each `#symbol` and writes no changelog. Deal with what it leaves for you (globs, split folders, deleted files) as part of triage.

## 3. Triage

`almanac affected` lists:

- each feature with the behaviours whose `source` names a changed file, the symbol after `#` included;
- the feature's own `code` paths that cover a changed file;
- the changed files nothing cites;
- whether the change already edits the almanac.

For each listed behaviour, read it (`almanac show <ref> --json`) and the diff of its sources, looking hardest at the symbol it names. Decide which of these it is:

- **Unchanged.** A refactor, a rename or an internal change with no difference a user could see. This is the most common case: leave the behaviour alone.
- **Changed.** It's still there but different: timings, limits, wording, platforms or status. Use `describe` or `set`.
- **Moved.** `relink` has already followed renamed files. If a symbol moved to a different file, or was renamed, point `source` at it with `set`.
- **Gone.** The change removes it. Don't remove it yourself: list it for the user with the reason, because removal leaves a tombstone.

For the changed files nothing cites, read their diff. When one adds something a user can observe, add a behaviour to the feature it belongs to, with `source`. When it fits no feature, propose a new feature (or category) and wait for the user before adding it. Tests, build files, tooling and pure refactors need nothing.

If the change already edits the almanac, check those edits against the code instead of redoing them.

## 4. One patch for the change

Write a single `almanac apply` patch covering the whole change:

- `"summary"`: what changed for users, in the almanac's voice ("Paint search waits for three characters."), taken from the pull request title or commit subject.
- `"ticket"`: the pull request URL, or the commit's URL or short SHA.
- `"version"`: only if the change names a release.
- `"changelog": "auto"`.

Run it with `--dry-run`. Show the user a table of ID, name, what changes and the evidence (file and line from the diff). Then apply it. Removals, new features and new categories wait for the user's go-ahead. Changes that need no almanac update are fine: say so and why.

## 5. Finish

- `almanac lint`, fixing every error, then `almanac fmt`.
- Tell the user:
  - what changed;
  - what you looked at and left alone, and why;
  - removals waiting for their decision;
  - the uncited files you judged invisible to users.
