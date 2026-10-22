# Keeping it current

An almanac is only useful while it matches the app, so the update belongs in the same pull request as the code.

## The update workflow

Run it with what changed:

```text
/almanac-update #123                 a pull request (number or URL; needs the GitHub CLI, gh)
/almanac-update 4f2c9e1              one commit
/almanac-update main...HEAD          a range
/almanac-update                      uncommitted work, or the branch since main
```

(`$almanac-update …` in Codex.) The agent:

1. lists what the change touches with `almanac affected`;
2. follows renamed files with `almanac relink`;
3. reads the diff for each behaviour that cites a changed file;
4. decides whether a user would notice the difference: most refactors change nothing;
5. updates descriptions, platforms, status and moved `source` paths;
6. adds behaviours for new things a user can see;
7. writes one patch, with the pull request or commit as the changelog's ticket.

It shows you the dry run first and lints when it's done. Removing a behaviour, or adding a feature or category, waits for your decision.

## Renamed files: `relink`

Renamed and moved files are the one part that needs no judgement. `relink` repoints every `source` and `code` entry at the new paths, keeping each `#symbol`, so reorganising folders doesn't leave hundreds of stale citations:

```bash
almanac --dry-run relink main...HEAD     # see the repointing first
almanac relink main...HEAD
```

A folder entry follows only when everything in it moved to one place. Globs, split folders and deleted files are listed for you to fix. It writes no changelog entries, because a moved file changes nothing a user sees.

## What a change touches: `affected`

`affected` is the plain command underneath the update workflow, and is useful on its own:

```bash
almanac affected                     # uncommitted work (untracked files included)
almanac affected --base main         # everything on this branch since it left main
almanac affected 4f2c9e1             # one commit (a merge commit: everything it brought in)
almanac affected main...HEAD         # a range
gh pr diff 123 --name-only | almanac affected --files -   # a pull request, without checking it out
```

It matches the changed files against every live behaviour's `source` (variants included) and every feature's `code`, accepting folders and globs. It prints:

- each affected feature, with its behaviours and the file and symbol each one cites;
- the changed files nothing cites;
- whether the change also edits the almanac.

Paths come from git relative to the repository and are matched relative to `code.path`. `--json` gives the same as data for agents and scripts.

## In CI

```bash
almanac lint --strict --require-source
almanac fmt --check
almanac affected origin/main...HEAD --check    # on pull requests: cited code changed, so the almanac should too
```

`affected --check` fails a pull request that changes code a behaviour's `source` or a feature's `code` points at without touching the almanac. The failure is a prompt to run the update workflow, not proof that a behaviour changed: a pure refactor can still pass review. Fetch enough history for the merge base (`fetch-depth: 0` in GitHub Actions).

On GitHub, Copilot can also check the affected behaviours against the code on every pull request: see [Copilot on every pull request](github.md#copilot-on-every-pull-request).
