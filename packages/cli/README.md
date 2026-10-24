<h1 align="center"><img src="https://raw.githubusercontent.com/BenjaminBriggs/Feature-Almanac/main/logo.png" alt="The Feature Almanac" width="600"></h1>

A Feature Almanac is a specification of everything an app does, kept in git next to the code. It's written for the people who need to know how the product behaves (support, QA, product and the next developer), and it's what your AI coding agent reads and updates when the code changes.

This package is the `almanac` CLI. It writes the almanac, checks it, works out which behaviours a code change touches, and builds a website for reading and reviewing it.

## Install

```bash
npm install -g feature-almanac
```

It needs Node 20 or later. With Homebrew, use `brew install benjaminbriggs/tap/almanac` instead.

## Get started

In your app's repository, install the skill and workflows for your agent, then ask it to write the first almanac:

```bash
almanac agent install --tool claude  # or copilot, codex, or claude,copilot,codex
```

```text
/almanac-generate
```

When it's done, have a look:

```bash
almanac site serve --open
```

## Documentation

See the [repository](https://github.com/BenjaminBriggs/Feature-Almanac#readme) for the concepts, working with agents, the website, product review, GitHub and the [CLI reference](https://github.com/BenjaminBriggs/Feature-Almanac/blob/main/docs/cli.md).

## Licence

[MIT](https://github.com/BenjaminBriggs/Feature-Almanac/blob/main/LICENSE)
