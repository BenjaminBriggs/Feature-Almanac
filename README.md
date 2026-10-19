<h1 align="center"><img src="logo.png" alt="The Feature Almanac" width="600"></h1>

A Feature Almanac is a specification of everything an app does, kept in git next to the code. It's written for the people who need to know how the product behaves (support, QA, product and the next developer), and it's what your AI coding agent reads and updates when the code changes.

The `almanac` CLI reads, writes, validates and publishes it. Agents use the same commands, so IDs, counters and changelogs stay correct no matter who edits.

```
almanac/
├── almanac.yaml                     product, prefix, platforms, owners
├── 01-editing/
│   ├── category.yaml                category 1: Editing
│   ├── 01-markdown-editor.yaml      feature 1.1, with its behaviours and changelog
│   └── 02-autosave.yaml             feature 1.2
└── 02-sync/
    └── …
```

## The model

| Level | ID | What it is |
|---|---|---|
| **Category** | `1` | An area of the product a non-developer would recognise: Editing, Sync. A folder with `category.yaml`. |
| **Feature** | `1.2` | A user-facing capability you can describe in one line. One YAML file in its category's folder. |
| **Behaviour** | `1.2.3` | One observable outcome of a feature: what the user does, what happens, the limits. Listed inside the feature file. |
| **Variant** | `1.2.3@android` | A platform-specific difference inside a behaviour, such as a different gesture or menu for the same outcome. |

- **IDs are stable.** They are never reused or renumbered. With a product prefix they read `EX-1.2.3`, and you can cite them in tickets, PRs and commits.
- **Moves keep the old ID.** Moving a behaviour or feature records its old ID in `formerly`, so old citations still resolve (`almanac show` prints the new ID).
- **Nothing is deleted.** Removing something leaves a tombstone with `status: removed` and a `removed_reason`.
- **Status is per platform.** Each platform is `planned`, `in-progress`, `shipped`, `deprecated` or `removed`. Everything applies to every platform unless narrowed.
- **Behaviours cite code.** `source: [Sources/Editor/EditorView.swift#toggleBold]`, relative to `code.path` in `almanac.yaml`, so an agent can check the almanac against the code.
- **Behaviours read as Given / When / Then.** Gherkin (cucumber) is the default format: a one-line summary, then the starting state, the one trigger and what the user observes. The schema doesn't enforce it. Prose is still allowed with `format: prose`, and an existing prose behaviour is converted when it's next rewritten. The site shows the summary above the steps, with their keywords.
- **Every write is recorded.** Each feature carries a changelog, which the CLI writes for you.

## Install

Feature Almanac isn't on npm yet. Install it from source (Node 20 or later):

```bash
git clone git@github.com:BenjaminBriggs/Feature-Almanac.git
cd Feature-Almanac
npm install
npm run build
cd packages/cli && npm link
```

`almanac --version` should now work from any folder. To update later, run `git pull && npm install && npm run build`; the link picks up the new build.

## Quick start with an agent

Most almanacs are written by an agent reading the code, with you approving the structure. Install the skill and workflows for your agent from the root of the app's repository:

```bash
almanac agent install --tool claude      # Claude Code (the default)
almanac agent install --tool copilot     # GitHub Copilot
almanac agent install --tool codex       # OpenAI Codex
almanac agent install --tool claude,copilot,codex
```

Add `--global` to install for every project in your home folder, and `--dry-run` (before `agent`) to see the files first. Run the same command again after updating the CLI; files that haven't changed are left alone. With `--tool copilot`, `--ci` also adds checks that run on every pull request (see [Copilot on every pull request](#copilot-on-every-pull-request)).

Each install adds the **`almanac` skill**. It tells the agent how the almanac works, to change it only through the CLI, and to update it in the same change as the code. It also adds four workflows:

| Workflow | What it does |
|---|---|
| **generate** | Builds the first almanac from the code. It proposes categories and features, **stops for your approval**, then writes the behaviours one feature at a time, verifies them and lints. |
| **update** | Brings the almanac in line with a code change: a pull request, a commit, a range or uncommitted work. It finds the behaviours that cite the changed files, reads the diff, and applies one patch that records the PR or commit in the changelog. Removals and new features wait for your approval. See [Keeping it up to date](#keeping-it-up-to-date). |
| **verify** | Checks behaviours (all of them, or the IDs you name) against the code they cite, fixes wording, platforms and status, and adds what's missing. |
| **ask** | Answers "how does X work?" from the almanac, citing behaviour IDs. |

Where the files go and how you run the workflows:

| Tool | In the project | With `--global` | Run a workflow |
|---|---|---|---|
| Claude Code | `.claude/skills/almanac/`, `.claude/commands/almanac-*.md` | `~/.claude/…` | `/almanac-generate`, `/almanac-update #123`, `/almanac-verify 1.2`, `/almanac-ask how does autosave work?` |
| GitHub Copilot | `.github/skills/almanac/`, `.github/prompts/almanac-*.prompt.md` | `~/.copilot/skills/almanac/` (skill only) | In VS Code Copilot Chat: `/almanac-generate`, `/almanac-update`, `/almanac-verify`, `/almanac-ask` |
| OpenAI Codex | `.agents/skills/almanac/`, `.agents/skills/almanac-{generate,update,verify,ask}/` | `~/.agents/skills/…` | `$almanac-generate`, `$almanac-update`, `$almanac-verify`, `$almanac-ask`, or pick one from `/skills` |

Notes:

- **Copilot prompt files are per repository.** VS Code keeps your own prompt files in each profile, so `--global` installs only the skill. Run the install inside a repository to get the `/almanac-*` prompts.
- **Copilot and Codex share some folders.** Copilot also reads skills from `.claude/skills` and `.agents/skills`, so a repository set up for Claude Code or Codex already gives Copilot's agent the skill.
- **Agents can trigger the skills on their own.** They load a skill when a task matches its description, for example when a change alters what the app does, or when you ask how something works.

Commit the installed files so everyone working in the repository gets them.

## Keeping it up to date

An almanac is only useful while it matches the app, so the update belongs in the same pull request as the code. Run the **update** workflow with what changed:

```text
/almanac-update #123                 a pull request (number or URL; needs the GitHub CLI, gh)
/almanac-update 4f2c9e1              one commit
/almanac-update main...HEAD          a range
/almanac-update                      uncommitted work, or the branch since main
```

(`$almanac-update …` in Codex.) The agent:

1. lists what the change touches with `almanac affected`;
2. reads the diff for each behaviour that cites a changed file;
3. decides whether a user would notice the difference: most refactors change nothing;
4. updates descriptions, platforms, status and moved `source` paths;
5. adds behaviours for new things a user can see;
6. writes one patch, with the pull request or commit as the changelog's ticket.

It shows you the dry run first and lints when it's done. Removing a behaviour, or adding a feature or category, waits for your decision.

Renamed and moved files are the one part that needs no judgement, so the workflow starts with `almanac relink`. It repoints every `source` and `code` entry at the new paths, so a reorganisation of folders doesn't leave hundreds of stale citations:

```bash
almanac --dry-run relink main...HEAD     # see the repointing first
almanac relink main...HEAD
```

`almanac affected` is the plain command underneath, and is useful on its own:

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

## Copilot on every pull request

GitHub Copilot can check the almanac on every pull request in two ways. One command installs both:

```bash
almanac agent install --tool copilot --ci
```

- **Copilot code review** reads `.github/instructions/almanac.instructions.md` whenever it reviews a pull request. It comments on code changes that alter a documented behaviour, citing the behaviour ID, and on almanac edits that don't match the code. This is the cheap route: the instructions ride along with a review Copilot was doing anyway. But it only reads the diff; it runs nothing. Replace `YOUR_SOURCE_GLOBS` in the file's `applyTo` with your source globs (such as `src/**`) and keep `almanac/**`. Code review reads only the first 4,000 characters of an instructions file, and the template stays under that. Request Copilot as a reviewer, or add a ruleset that requests it automatically.
- **The almanac check** (`.github/workflows/almanac-verify.md`) is a [GitHub Agentic Workflow](https://github.github.com/gh-aw/): Copilot CLI running in Actions. When a same-repository pull request is opened or pushed to, it installs the `almanac` CLI and runs `almanac affected --base origin/<base>`. It then runs the verify workflow's checks on only the affected behaviours, against the code as the pull request leaves it. It posts one comment with a table: ID, name, result (confirmed, corrected, unsupported or missing) and the suggested change. Each run hides the previous run's comment. It reports and never pushes: that comment is the only thing it can write.

To turn on the almanac check:

1. Install the gh-aw extension: `gh extension install github/gh-aw`.
2. Run `gh aw compile`. It writes `.github/workflows/almanac-verify.lock.yml`, the Actions workflow GitHub actually runs. Commit it with the `.md`, and compile again whenever you edit the `.md`.
3. Add the `COPILOT_GITHUB_TOKEN` secret: a fine-grained personal access token whose owner has a Copilot licence, with Account permissions → Copilot Requests: Read. Set it with `gh aw secrets set COPILOT_GITHUB_TOKEN --value <token>`. If your organisation bills Copilot CLI centrally, add `copilot-requests: write` under the workflow's `permissions` instead.

The workflow installs the CLI with this repository's action, `BenjaminBriggs/Feature-Almanac@main` with `site: "false"`: it builds the tool and puts `almanac` on PATH without building the website (see [the action's inputs](#publishing-with-github-pages)). If your copy of this repository is private, its Actions access setting has to reach the app repository.

**Cost.** Each run that starts the agent uses Copilot premium requests, billed to the token's owner. `affected` keeps that small. A pull request that changes no cited file stops before the agent starts and costs nothing. Otherwise the agent reads only the behaviours the diff touches, not the whole almanac.

## Quick start by hand

```bash
almanac init --product "Example Notes" --prefix EX --platforms ios,android
almanac add category --name Editing --description "Creating, formatting and saving notes."
almanac add feature --category 1 --name "Markdown editor" \
  --description "Rich editing of notes with live preview." --owner ben --status shipped
almanac add behaviour --feature 1.1 --name "Bold formatting" \
  --source "Sources/Editor/EditorView.swift#toggleBold" \
  --description "Toggles bold on the selection. With no selection, bold applies to newly typed text."
almanac add variant 1.1.1 --platforms android \
  --description "Triggered from the formatting bar above the keyboard."
almanac set EX-1.1.1@android status=in-progress
almanac lint
almanac site serve --open
```

`init` creates `almanac/almanac.yaml` in the current folder (or the folder itself with `--standalone`). Commands find the almanac by walking up from the current folder, checking `almanac/` folders on the way. You can also point at it with `--root <path>` or the `ALMANAC_ROOT` environment variable.

`almanac show EX-1.1.1` prints the behaviour above as:

```markdown
# 1.1.1 Bold formatting

Feature: 1.1 Markdown editor

Toggles bold on the selection. With no selection, bold applies to newly typed text.

- Status: shipped (iOS) · in-progress (Android)
- Source: Sources/Editor/EditorView.swift#toggleBold

**Android** (in-progress): Triggered from the formatting bar above the keyboard.
```

## The files

You edit `almanac.yaml` directly; it holds the product, the platforms and the settings:

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
site:                                # optional; see "The website"
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
    format: prose
    description: Toggles bold on the selection. With no selection, bold applies to newly typed text.
    source: [Sources/Editor/EditorView.swift#toggleBold]
    variants:
      - platforms: [android]
        status: in-progress
        description: Triggered from the formatting bar above the keyboard.
  - id: "1.1.2"
    name: Autosave
    description: |
      Saves the note a second after typing stops.
      Given a note with unsaved edits
      When input is idle for 1 second
      Then the note is saved without interrupting typing

changelog:
  - date: "2026-10-12"
    version: "2.4"
    summary: Autosave delay 2 s → 1 s.
    changes:
      - modified: "1.1.2"
```

## Commands

Global options go before the command: `almanac --json --dry-run apply patch.json`.

| Option | |
|---|---|
| `--root <path>` | The almanac root. The default is `ALMANAC_ROOT`, then a search upwards. |
| `--json` | Machine output on stdout: `{ "almanac": 1, "command", "ok", "data", "diagnostics", "redirects" }`. |
| `--dry-run` | Write commands print the diff they would make and change nothing. |
| `-q, --quiet` | Errors only. |
| `--no-color` | Plain text. |

### Reading

| Command | |
|---|---|
| `list` | Lists features. `--level category\|feature\|behaviour`, plus the filters `--category N`, `--feature N.M`, `--status`, `--platform`, `--owner`, `--tag` and `--include-removed`. |
| `show <ref>` | Prints one entity: `1`, `1.2`, `1.2.3`, `1.2.3@android` or `EX-1.2.3`. `--platform` resolves variants, and `--with-changelog`, `--with-related` and `--format markdown\|yaml\|json` change what's shown. |
| `next-id [parent]` | Prints the ID the next `add` would allocate. |
| `build` | Writes the compiled model to `dist/almanac.json` (or `--out <path>`). |

### Writing

Every write records a changelog entry on the feature it touches. `--summary` replaces the generated one.

| Command | |
|---|---|
| `init` | Creates `almanac.yaml`, with `--product`, `--prefix`, `--platforms` and `--standalone`. |
| `add category` | `--name`, `--description` and `--owner`. |
| `add feature` | `--category N`, `--name`, `--description`, `--owner`, `--platforms` and `--status`. |
| `add behaviour` | `--feature N.M`, `--name`, `--description` (or `--description-file`, or `-` for stdin), `--source path#symbol` (repeatable), `--platforms` and `--format`. |
| `add variant <ref>` | `--platforms`, `--mode append\|replace` and `--description`. |
| `set <ref> key=value…` | Sets `status`, `status.<platform>`, `since.<platform>`, `platforms`, `source`, `tags`, `owner`, `flag`, `depends_on`, `related`, `links` (JSON), `removed_reason` or `fields.<key>`. Lists are comma-separated, and an empty value unsets a key. |
| `describe <ref>` | Replaces a description from `--description`, `--description-file` or `-` (stdin). `--overview` replaces a feature's overview instead. |
| `rename <ref> --name` | Renames an entity. Its file or folder is renamed too. |
| `remove <ref> --reason` | Tombstones a behaviour, feature, category or variant. |
| `mv <ref> --to <parent>` | Moves a behaviour to another feature or a feature to another category. The new ID is printed, and the old one goes to `formerly`. |
| `changelog add <feature>` | Adds an entry yourself: `--summary`, `--change added:1.2.3` (repeatable; also `modified`, `removed`, `moved:FROM:TO` and `feature:added`), `--release`, `--ticket`, `--author` and `--platforms`. |
| `relink [change]` | Repoints `source` and `code` entries at files a change renamed or moved, keeping each `#symbol`. It takes the change the way `affected` does. A folder entry follows only when everything in it moved to one place. Globs, split folders and deleted files are listed for you. It writes no changelog entries, because a moved file changes nothing a user sees. |
| `apply <patch>` | Runs a batch of operations from a file or `-` (stdin), atomically. |

`apply` is what agents use for anything bigger than one change. Operations run in order, and `as` names an entity so later operations can refer to it:

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
    { "op": "add", "level": "behaviour", "parent": "$editor", "name": "Bold formatting",
      "source": ["Sources/Editor/EditorView.swift#toggleBold"],
      "description": "Toggles bold on the selection. With no selection, bold applies to newly typed text." },
    { "op": "set", "ref": "$editor", "values": { "tags": ["core"] } }
  ],
  "changelog": "auto"
}
EOF
```

The other operations are `describe`, `rename`, `remove` and `move`. A write that would add lint errors is rejected, nothing is written, and the errors are listed.

### Checking

| Command | |
|---|---|
| `lint` | Validates the almanac. It exits 1 on errors. `--strict` fails on warnings too, `--require-source` warns about behaviours without `source`, and `--fix` applies safe fixes (formatting, file names and ID counters). |
| `fmt` | Normalises key order, quoting, block scalars, behaviour order and file names. `--check` lists the files that would change and exits 1 if any would. |
| `affected [change]` | Lists the features and behaviours a code change touches: a commit, a range, `--base <ref>` for the branch, nothing for uncommitted work, or `--files <path\|->` for a list of changed files. `--check` exits 1 when cited code changed but no almanac file did. |

Diagnostics have codes such as `ALM-E005` (duplicate ID) and `ALM-W011` (behaviour has no source), and come with a file and line.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | Lint errors (or warnings, with `--strict`) |
| 2 | Usage error, or no almanac found |
| 3 | The ID or reference doesn't exist |
| 4 | Conflict: the write is invalid in the current state, or the files changed underneath it |
| 5 | Internal error |

## The website

```bash
almanac site serve --open        # http://localhost:4173, reloads whenever an almanac file changes
almanac site build               # dist/site/index.html beside the almanac (or --out <dir>)
```

The site is one self-contained HTML page you can host anywhere or attach to a ticket:

- **Hero:** counts of behaviours, features and categories.
- **Category cards:** each category's features as cards. A card unfolds into a panel the height of the window, over everything else, listing every behaviour with its platforms, variants and status. The panel scrolls on its own while the page behind it holds still.
- **Sticky search and category bar:** search across names, descriptions and IDs, and jump between categories from the bar as you scroll.
- **Deep links:** `#1.2` opens a feature's panel, and `#1.2.3` (or `#EX-1.2.3`) opens it scrolled to that behaviour.
- **No JavaScript needed to read it:** everything is pre-rendered.

### Publishing with GitHub Pages

Every link in the built page is relative, so it works from a Pages address like `https://<org>.github.io/<repo>/`. In the app repository, set Settings → Pages → Source to "GitHub Actions", then add this workflow as `.github/workflows/almanac-site.yml`:

```yaml
name: Almanac site
on:
  push:
    branches: [main]
    paths: ["almanac/**"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: BenjaminBriggs/Feature-Almanac@main
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

The action (`action.yml` at the root of this repository) sets up Node, builds this tool, puts `almanac` on PATH for later steps in the job and runs `almanac --root <root> site build --out <out>` in the workspace. It only builds the site, so the output can go to another host just as well. With `site: "false"` it skips the site build and only installs the CLI, which is how the [almanac check](#copilot-on-every-pull-request) uses it. Its inputs:

| Input | Default | Meaning |
| --- | --- | --- |
| `site` | `true` | `false` skips the site build, so the action only installs `almanac`. |
| `root` | `almanac` | The almanac folder. |
| `out` | `_site` | Where the site is written. |
| `node-version` | `22` | Node used to build and run the tool. Later steps in the job get it too. |

`@main` follows this repository's main branch. Pin a commit SHA instead if you want builds to stay put.

If you can't use the action (say your copy of this repository is private and its Actions access setting doesn't reach the app repository), build the tool from source instead. Replace the action step with:

```yaml
      - uses: actions/checkout@v4
        with:
          repository: BenjaminBriggs/Feature-Almanac   # add token: for a private copy
          path: .feature-almanac
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci && npm run build
        working-directory: .feature-almanac
      - run: node .feature-almanac/packages/cli/dist/bin.js --root almanac site build --out _site
```

The almanac lists unreleased behaviour, so make the Pages site private to your organisation (GitHub Enterprise Cloud) or host it internally.

Options go under `site:` in `almanac.yaml`:

```yaml
site:
  title: Example Notes               # default: product.name
  tagline: Everything the app does.  # default: product.description
  labels:                            # how statuses read on the site
    shipped: Available
    in-progress: In beta
```

## In CI

```bash
almanac lint --strict --require-source
almanac fmt --check
almanac affected origin/main...HEAD --check    # on pull requests: cited code changed, so the almanac should too
almanac site build --out public/almanac
```

`affected --check` fails a pull request that changes code some behaviour cites without touching the almanac. The failure is a prompt to run the update workflow, not proof that a behaviour changed: a pure refactor can still pass review. Fetch enough history for the merge base (`fetch-depth: 0` in GitHub Actions).

`lint --against <git-ref>` will compare the almanac with another commit, catching reused or vanished IDs. It needs git history support, which arrives in v0.3; until then it exits with a usage error.

## Development

This repository is an npm workspace with four packages:

| Package | |
|---|---|
| `packages/schema` | File schemas, the compiled model's types, ID references and lint rule codes. |
| `packages/core` | Compiling and linting, formatting, every write (mutations, patches, atomic commits) and the file system abstraction. |
| `packages/site` | The website renderer, search index and dev server. |
| `packages/cli` | The `almanac` command (`feature-almanac` on npm) and the agent skill templates in `assets/agent/`. |

```bash
npm install
npm run check      # type-check every package and run the tests
npm run build      # rebuild; a linked `almanac` picks it up
```

The agent files are written once and rendered for each tool. `assets/agent/skill/SKILL.md` is shared by all three. The workflows in `assets/agent/workflows/` use `{{input}}` and `{{verify}}` placeholders, which `almanac agent install` fills in for each tool. `--ci` copies the files in `assets/agent/github/` as they are, keeping the `applyTo` line of an existing instructions file.
