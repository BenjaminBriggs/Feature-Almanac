<h1 align="center"><img src="logo.png" alt="The Feature Almanac" width="600"></h1>

A Feature Almanac is a specification of everything an app does, kept in git next to the code. It's written for the people who need to know how the product behaves (support, QA, product and the next developer), and it's what your AI coding agent reads and updates when the code changes.

## Why

How an app behaves usually lives in people's heads, old tickets and the code itself. An almanac puts it in one place that:

- **stays true**, because it changes in the same pull request as the code, usually written by the agent that wrote the code;
- **can be cited**, because every behaviour has a stable ID, such as `EX-1.2.3`, for tickets, pull requests and test names;
- **can be checked**, because every behaviour cites the code that implements it, so an agent can verify one against the other;
- **is agreed by product**, whose reviewers approve or reject each behaviour from the website.

The next step is to use it to find behaviours that no test covers, and to generate those tests.

## What it looks like

An almanac is a folder of YAML. Categories hold features, and features hold behaviours. Each behaviour is a one-line summary followed by Given/When/Then steps:

```yaml
- id: "1.1.1"
  name: Bold formatting
  description: |
    Makes the selected text bold, or the text typed next.
    Given a note is open for editing
    When the user presses ⌘B or taps "Bold"
    Then the selected text is bold
    But with nothing selected, the text typed next is bold instead
  source: [Sources/Editor/EditorView.swift#toggleBold]
```

The `almanac` CLI is the only thing that writes it, so IDs, counters and changelogs stay right whether a person or an agent is editing. It also checks it, works out which behaviours a code change touches, and builds a website for reading and reviewing it.

Feature Almanac describes itself: [`almanac/`](almanac/) is this tool's own almanac. Run `almanac site serve --open` in this repository to browse it.

## Get started

Install the `almanac` CLI with Homebrew, or with npm if you have Node 20 or later:

```bash
brew install benjaminbriggs/tap/almanac
```

```bash
npm install -g feature-almanac
```

To run it from a clone of this repository instead, see [Development](docs/development.md).

In your app's repository, install the skill and workflows for your agent, then ask it to write the first almanac:

```bash
almanac agent install --tool claude  # or copilot, codex, or claude,copilot,codex
```

```text
/almanac-generate
```

It proposes categories and features and waits for your approval before writing any behaviours. When it's done, have a look:

```bash
almanac site serve --open
```

Commit `almanac/` and the agent files. From then on, the almanac changes with the code: run `/almanac-update` on each pull request, or let the agent do it as part of the change. To write one without an agent, see [A first almanac by hand](docs/cli.md#a-first-almanac-by-hand).

## Documentation

| Page | What's in it |
|---|---|
| [Concepts](docs/concepts.md) | Categories, features, behaviours and variants; IDs; writing behaviours; the files |
| [Working with agents](docs/agents.md) | Installing for Claude Code, Copilot and Codex, and the five workflows |
| [Keeping it current](docs/keeping-current.md) | Updating with each change, `affected`, `relink` and checks in CI |
| [The website](docs/website.md) | Building, serving and configuring the site |
| [Reviewing behaviours](docs/reviewing.md) | How a product reviewer approves or rejects behaviours, and what happens next |
| [GitHub](docs/github.md) | The GitHub Action, publishing with Pages, and Copilot checks on pull requests |
| [CLI reference](docs/cli.md) | Every command, the patch format, diagnostics and exit codes |
| [Development](docs/development.md) | Working on Feature Almanac itself |

The [proof-of-concept write-up](docs/feature-almanac-poc.md) explains the idea for product and engineering managers.

## Licence

[MIT](LICENSE)
