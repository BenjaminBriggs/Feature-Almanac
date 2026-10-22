# GitHub

## The action

This repository is a GitHub Action (`action.yml` at its root). It sets up Node, builds the tool, puts `almanac` on PATH for later steps in the job and runs `almanac --root <root> site build --out <out>` in the workspace.

```yaml
- uses: BenjaminBriggs/Feature-Almanac@main
```

| Input | Default | Meaning |
| --- | --- | --- |
| `site` | `true` | `false` skips the site build, so the action only installs `almanac` for later steps. |
| `root` | `almanac` | The almanac folder. |
| `out` | `_site` | Where the site is written. |
| `node-version` | `22` | Node used to build and run the tool. Later steps in the job get it too. |

`@main` follows this repository's main branch. Pin a commit SHA instead if you want builds to stay put.

## Publishing with GitHub Pages

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

The almanac lists unreleased behaviour, so make the Pages site private to your organisation (GitHub Enterprise Cloud) or host it internally.

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

## Copilot on every pull request

GitHub Copilot can check the almanac on every pull request in two ways. One command installs both:

```bash
almanac agent install --tool copilot --ci
```

- **Copilot code review** reads `.github/instructions/almanac.instructions.md` whenever it reviews a pull request. It comments on code changes that alter a documented behaviour, citing the behaviour ID, and on almanac edits that don't match the code. This is the cheap route, because the instructions ride along with a review Copilot was doing anyway, but it only reads the diff and runs nothing. Replace `YOUR_SOURCE_GLOBS` in the file's `applyTo` with your source globs (such as `src/**`) and keep `almanac/**`. Code review reads only the first 4,000 characters of an instructions file, and the template stays under that. Request Copilot as a reviewer, or add a ruleset that requests it automatically.
- **The almanac check** (`.github/workflows/almanac-verify.md`) is a [GitHub Agentic Workflow](https://github.github.com/gh-aw/): Copilot CLI running in Actions. When a same-repository pull request is opened or pushed to, it installs the `almanac` CLI and runs `almanac affected --base origin/<base>`. It then runs the verify workflow's checks on only the affected behaviours, against the code as the pull request leaves it. It posts one comment with a table: ID, name, result (confirmed, corrected, unsupported or missing) and the suggested change. Each run hides the previous run's comment. It reports and never pushes: that comment is the only thing it can write.

To turn on the almanac check:

1. Install the gh-aw extension: `gh extension install github/gh-aw`.
2. Run `gh aw compile`. It writes `.github/workflows/almanac-verify.lock.yml`, the Actions workflow GitHub actually runs. Commit it with the `.md`, and compile again whenever you edit the `.md`.
3. Add the `COPILOT_GITHUB_TOKEN` secret: a fine-grained personal access token whose owner has a Copilot licence, with Account permissions → Copilot Requests: Read. Set it with `gh aw secrets set COPILOT_GITHUB_TOKEN --value <token>`. If your organisation bills Copilot CLI centrally, add `copilot-requests: write` under the workflow's `permissions` instead.

The workflow installs the CLI with [the action](#the-action) and `site: "false"`. If your copy of this repository is private, its Actions access setting has to reach the app repository.

**Cost.** Each run that starts the agent uses Copilot premium requests, billed to the token's owner. `affected` keeps that small. A pull request that changes no cited file stops before the agent starts and costs nothing. Otherwise the agent reads only the behaviours the diff touches, not the whole almanac.
