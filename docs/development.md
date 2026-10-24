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

Releases ship one package, `feature-almanac`, as a tarball attached to the GitHub release (which the Homebrew formula installs) and, once it's turned on, on npm. `schema`, `core` and `site` stay private: `packages/cli/scripts/bundle.mjs` compiles them and the CLI from source into one file with esbuild, and their third-party dependencies become `feature-almanac`'s. The bundle script fails if those dependencies and their ranges in `packages/cli/package.json` drift from the ones in the other packages, so add a dependency to both.

`npm run build` and `npm pack` both bundle. The package holds:

| Path | |
|---|---|
| `bundle/bin/almanac.js` | The CLI. It sits two folders down so that `agent.ts`'s `../../assets/agent/` still finds `assets/agent/`. |
| `bundle/assets/` | A copy of `packages/site/assets/`, where `render.ts`'s `../assets/` looks. |
| `assets/agent/` | The agent templates. |

If you move either asset folder or the files that read them, `npm run smoke` will tell you. It packs the package (or takes a tarball: `node packages/cli/scripts/smoke.mjs <tarball>`), installs it into a temporary prefix the way `npm install -g` and Homebrew do, and runs `--version`, `site build`, `init`, `lint` and `agent install` with the installed command.

## Releasing

Versions stay below 1.0 while the file format and commands are still changing.

1. Set the new version in `packages/cli/package.json` and `VERSION` in `packages/cli/src/program.ts`. A test fails if they differ.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin main v0.2.0`.

The [release workflow](../.github/workflows/release.yml) checks that the tag matches the version and runs `npm run check`. It packs the tarball and smoke tests it, then creates the GitHub release with the tarball attached; 0.x versions are marked as pre-releases. Finally it writes `Formula/almanac.rb` in [BenjaminBriggs/homebrew-tap](https://github.com/BenjaminBriggs/homebrew-tap) from `packages/cli/scripts/homebrew-formula.mjs`. The formula installs the release's tarball with Homebrew's Node. Every step can be re-run: an existing release and its tarball, an unchanged formula and a version already on npm are all left alone.

### Setting up, once

- **Homebrew tap.** The public repository `BenjaminBriggs/homebrew-tap` holds the formula. The workflow pushes to it with a deploy key: the public key is added to the tap with write access (`gh repo deploy-key add <key>.pub -R BenjaminBriggs/homebrew-tap --allow-write`), and the private key is in this repository's Actions secrets as `HOMEBREW_TAP_DEPLOY_KEY` (`gh secret set HOMEBREW_TAP_DEPLOY_KEY < <key>`).
- **npm (not on yet).** Trusted publishing can only be set up for a package that already exists, so publish the first version by hand: `npm login`, then `npm publish -w packages/cli` from the repository root at that version's tag. On npmjs.com, open the package's Settings → Trusted publishing and add GitHub Actions with the repository `BenjaminBriggs/Feature-Almanac` and the workflow `release.yml`. Then set the repository variable `NPM_PUBLISH` to `true` (`gh variable set NPM_PUBLISH --body true`), and later releases publish to npm too.
