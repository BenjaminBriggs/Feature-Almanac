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
cd packages/cli && npm link   # puts this clone's `almanac` on your PATH
```

The agent files are written once and rendered for each tool. `assets/agent/skill/SKILL.md` is shared by all three. The workflows in `assets/agent/workflows/` use `{{input}}` and `{{verify}}` placeholders, which `almanac agent install` fills in for each tool. `--ci` copies the files in `assets/agent/github/` as they are, keeping the `applyTo` line of an existing instructions file.

## The published package

Only `feature-almanac` goes to npm. `schema`, `core` and `site` stay private: `packages/cli/scripts/bundle.mjs` compiles them and the CLI from source into one file with esbuild, and their third-party dependencies become `feature-almanac`'s. The bundle script fails if those dependencies and their ranges in `packages/cli/package.json` drift from the ones in the other packages, so add a dependency to both.

`npm run build` and `npm pack` both bundle. The package holds:

| Path | |
|---|---|
| `bundle/bin/almanac.js` | The CLI. It sits two folders down so that `agent.ts`'s `../../assets/agent/` still finds `assets/agent/`. |
| `bundle/assets/` | A copy of `packages/site/assets/`, where `render.ts`'s `../assets/` looks. |
| `assets/agent/` | The agent templates. |

If you move either asset folder or the files that read them, `npm run smoke` will tell you. It packs the package, installs the tarball into a temporary prefix the way `npm install -g` and Homebrew do, and runs `--version`, `site build`, `init`, `lint` and `agent install` with the installed command.

## Releasing

1. Set the new version in `packages/cli/package.json` and `VERSION` in `packages/cli/src/program.ts`. A test fails if they differ.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The [release workflow](../.github/workflows/release.yml) checks that the tag matches the version, runs `npm run check` and `npm run smoke`, publishes to npm, creates the GitHub release and writes `Formula/almanac.rb` in [BenjaminBriggs/homebrew-tap](https://github.com/BenjaminBriggs/homebrew-tap). The formula comes from `packages/cli/scripts/homebrew-formula.mjs`. It installs the npm tarball with Homebrew's Node. Every step can be re-run: a version that's already on npm isn't published again, and an existing release or an unchanged formula is left alone.

### Setting up, once

- **Homebrew tap.** Create the public repository `BenjaminBriggs/homebrew-tap`. The workflow pushes to it with a deploy key: add the public key to the tap with write access (`gh repo deploy-key add <key>.pub -R BenjaminBriggs/homebrew-tap --allow-write`), and put the private key in this repository's Actions secrets as `HOMEBREW_TAP_DEPLOY_KEY` (`gh secret set HOMEBREW_TAP_DEPLOY_KEY < <key>`).
- **npm.** Trusted publishing can only be set up for a package that already exists, so publish the first version by hand: `npm login`, then `npm publish -w packages/cli` from the repository root. Then, on npmjs.com, open the package's Settings → Trusted publishing and add GitHub Actions with the repository `BenjaminBriggs/Feature-Almanac` and the workflow `release.yml`. Then push the tag. The workflow sees that the version is on npm already and does the rest.
