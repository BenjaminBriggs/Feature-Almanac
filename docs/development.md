# Development

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
