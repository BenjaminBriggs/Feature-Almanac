# CLI reference

## A first almanac by hand

```bash
almanac init --product "Example Notes" --prefix EX --platforms ios,android
almanac add category --name Editing --description "Creating, formatting and saving notes."
almanac add feature --category 1 --name "Markdown editor" \
  --description "Rich editing of notes with live preview." --owner ben --status shipped
almanac add behaviour --feature 1.1 --name "Bold formatting" \
  --source "Sources/Editor/EditorView.swift#toggleBold" - <<'EOF'
Makes the selected text bold, or the text typed next.
Given a note is open for editing
When the user presses ⌘B or taps "Bold"
Then the selected text is bold
But with nothing selected, the text typed next is bold instead
EOF
almanac add variant 1.1.1 --platforms android \
  --description 'On Android, "Bold" is in the formatting bar above the keyboard.'
almanac set EX-1.1.1@android status=in-progress
almanac lint
almanac site serve --open
```

`almanac show EX-1.1.1` then prints:

```markdown
# 1.1.1 Bold formatting

Feature: 1.1 Markdown editor

Makes the selected text bold, or the text typed next.
Given a note is open for editing
When the user presses ⌘B or taps "Bold"
Then the selected text is bold
But with nothing selected, the text typed next is bold instead

- Status: shipped (iOS) · in-progress (Android)
- Format: gherkin
- Source: Sources/Editor/EditorView.swift#toggleBold

**Android** (in-progress): On Android, "Bold" is in the formatting bar above the keyboard.
```

## Finding the almanac

`init` creates `almanac/almanac.yaml` in the current folder (or makes the current folder the almanac with `--standalone`), and adds `/dist/` to `.gitignore`. Every other command finds the almanac by walking up from the current folder, checking `almanac/` folders on the way. You can also point at it with `--root <path>` or the `ALMANAC_ROOT` environment variable; `init` takes `--root` but not `ALMANAC_ROOT`.

## Global options

Global options can go before or after the command: `almanac --json --dry-run apply patch.json`.

| Option | |
|---|---|
| `--root <path>` | The almanac root. The default is `ALMANAC_ROOT`, then a search upwards. |
| `--json` | Machine output on stdout: `{ "almanac": 1, "command", "ok", "data", "diagnostics", "redirects" }`. |
| `--dry-run` | Write commands print the diff they would make and change nothing. With `--json` they list the files instead. |
| `-q, --quiet` | Hides notes and warnings. Results and errors still print. |
| `--no-color` | Plain text. |

## Reading

| Command | |
|---|---|
| `list` | Lists features. `--level category\|feature\|behaviour`, plus the filters `--category N`, `--feature N.M`, `--status`, `--platform`, `--owner`, `--tag` and `--include-removed`. `--review unreviewed\|changed\|approved\|rejected\|needed` lists behaviours by review, with who decided, when and why. |
| `show <ref>` | Prints one entity: `1`, `1.2`, `1.2.3`, `1.2.3@android` or `EX-1.2.3`. `--platform` resolves variants, and `--with-changelog`, `--with-related` and `--format markdown\|yaml\|json` change what's shown. |
| `next-id [parent]` | Prints the ID the next `add` would allocate. |
| `build` | Writes the compiled model to `dist/almanac.json` (or `--out <path>`). With lint errors it still writes the file, leaving out feature files that don't validate, and exits 1. |

## Writing

Writes to features, behaviours and variants record a changelog entry on the feature; writes to a category record none. `set`, `describe`, `rename`, `remove` and `mv` take `--summary` to replace the generated summary.

| Command | |
|---|---|
| `init` | Creates `almanac.yaml`, with `--platforms` (required), `--product`, `--prefix` and `--standalone`. |
| `add category` | `--name`, `--description` and `--owner`. |
| `add feature` | `--category N`, `--name`, `--description`, `--owner`, `--platforms` and `--status`. |
| `add behaviour` | `--feature N.M`, `--name`, `--description` (or `--description-file`, or `-` for stdin), `--source path#symbol` (repeatable), `--platforms` and `--format`. |
| `add variant <ref>` | `--platforms`, `--mode append\|replace` and `--description` (or `--description-file`, or `-` for stdin). |
| `set <ref> key=value…` | Sets `status`, `status.<platform>`, `since.<platform>`, `platforms`, `source`, `tags`, `owner`, `format`, `flag`, `depends_on`, `related`, `links` (JSON), `removed_reason` or `fields.<key>`; on a feature also `code` and `assets`, and on a variant `mode`. Lists are comma-separated, and an empty value unsets a key. |
| `describe <ref>` | Replaces a description from `--description`, `--description-file` or `-` (stdin). `--overview` replaces a feature's overview instead. |
| `rename <ref> --name` | Renames a category, feature or behaviour. A category's folder and a feature's file are renamed with it. Variants have no name. |
| `remove <ref> --reason` | Tombstones a behaviour, feature, category or variant. A category can be removed only once none of its features is live; a removed feature takes its behaviours with it. |
| `mv <ref> --to <parent>` | Moves a behaviour to another feature or a feature to another category. The new ID is printed, and the old one goes to `formerly`. |
| `changelog add <feature>` | Adds an entry yourself: `--summary`, `--change added:1.2.3` (repeatable; also `modified`, `removed`, `moved:FROM:TO` and `feature:added`), `--release`, `--ticket`, `--author` and `--platforms`. |
| `relink [change]` | Repoints `source` and `code` entries at files a change renamed or moved. See [Keeping it current](keeping-current.md#renamed-files-relink). |
| `apply <patch>` | Runs a batch of operations from a file or `-` (stdin), atomically. |
| `agent install` | Installs the skill and workflows for `--tool claude\|copilot\|codex`. See [Working with agents](agents.md). |
| `site serve`, `site build` | Serves or builds the website. See [The website](website.md). |

## Patches

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
      "description": "Makes the selected text bold, or the text typed next.\nGiven a note is open for editing\nWhen the user presses ⌘B or taps \"Bold\"\nThen the selected text is bold" },
    { "op": "set", "ref": "$editor", "values": { "tags": ["core"] } }
  ],
  "changelog": "auto"
}
EOF
```

The other operations are `describe`, `rename`, `remove`, `move` and `review`. `"changelog": "auto"` (the default) writes one entry per feature the patch touches, from its `summary`, `version`, `ticket` and `author`; `"none"` writes none, and a list writes exactly the entries you give. A write that would add lint errors is rejected, nothing is written, and the errors are listed.

## Checking

| Command | |
|---|---|
| `lint` | Validates the almanac. It exits 1 on errors. `--strict` fails on warnings too, `--require-source` warns about behaviours without `source`, and `--fix` applies safe fixes (formatting, file names and ID counters). |
| `fmt` | Normalises key order, quoting, block scalars, behaviour order and file names. `--check` lists the files that would change and exits 1 if any would. |
| `affected [change]` | Lists the features and behaviours a code change touches: a commit, a range, `--base <ref>` for the branch, nothing for uncommitted work, or `--files <path\|->` for a list of changed files. `--check` exits 1 when cited code changed but no almanac file did. See [Keeping it current](keeping-current.md#what-a-change-touches-affected). |

Diagnostics have codes such as `ALM-E005` (duplicate ID) and `ALM-W011` (behaviour has no source), and come with a file and line.

`lint --against <git-ref>` will compare the almanac with another commit, catching reused or vanished IDs. It needs git history support, which arrives in v0.3; until then it exits with a usage error.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | Lint errors (or warnings, with `--strict`) |
| 2 | Usage error, or no almanac found |
| 3 | The ID or reference doesn't exist |
| 4 | Conflict: the write is invalid in the current state, or the files changed underneath it |
| 5 | Internal error |
