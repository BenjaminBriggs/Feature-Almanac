# Feature Almanac: a living source of truth for how our app behaves

**Proof of concept · Tech doc**

| | |
|---|---|
| **Author** | Ben Briggs |
| **Reviewers** | [Product manager], [Engineering manager] |
| **Status** | Draft for review |
| **Date** | 19 October 2026 |
| **Code** | github.com/BenjaminBriggs/Feature-Almanac |

## 1. Summary

- **The problem:** we have no single, current, trustworthy answer to "what does the app do?". That knowledge sits in code, tickets, designs and people's heads, and it drifts the moment a feature ships.
- **The proof of concept:** Feature Almanac is a small tool that keeps a written record of every user-visible behaviour of an app, per platform, inside the app's own repository. Each behaviour has a stable ID (such as `PD-3.3.2`) and cites the code that implements it. The record is reviewed in pull requests like code, and it publishes as a searchable website and as JSON.
- **How it's created and maintained:** LLM agents, with people reviewing.
  - An agent drafts the first almanac from the code. A person approves the structure.
  - When code changes, the tool lists exactly which behaviours the change touches, and an agent proposes the update in the same pull request.
- **What we've proved:** I ran it end to end on two smaller apps of my own, as a rehearsal for our main codebase. Each produced roughly 570 documented behaviours across 10–11 areas, every one linked to its source code.
- **Why it matters beyond documentation:** behaviours with IDs are the unit we need to measure test coverage against what the app is supposed to do, rather than against lines of code. The next phase uses the almanac to find behaviours that no test protects, then has agents write those tests. Running the tests then confirms the documentation is accurate.
- **The ask:** agree a pilot on one area of our real codebase, with an owner, a CI check and a place to host the site. Details are in section 9.

## 2. The problem

**What the app does is hard to find out.** When Support, QA, Product or a new engineer needs to know exactly how something behaves, the usual route is to ask an engineer, who reads the code. Answers vary with who you ask and when.

**Specs describe intent, not what shipped.** PRDs and design files capture what we planned. After launch, the edge cases, platform differences, bug fixes and follow-up changes are rarely written back. Six months later, the spec and the app disagree and nobody knows which is right.

**There's nothing stable to point at.** Bug reports and tickets describe behaviour in free text ("the thing where autosave waits a bit"). There's no shared ID for "the app saves one second after you stop typing" that a ticket, a test and a support macro can all cite.

**Tests are measured against code, not against behaviour.** Line coverage tells us which code ran during tests. It doesn't tell us which behaviours a user relies on are actually checked. A screen can show 80% coverage while its most important outcome, such as "a purchase restores on a second device", has no assertion at all.

## 3. Goals and non-goals

**Goals**

- One current, versioned record of every user-visible behaviour, per platform, that people outside engineering can read.
- Stable IDs that tickets, tests, support articles and release notes can cite.
- Kept in the same repository as the code and updated in the same pull request, so it can't silently drift.
- Machine-readable, so agents and test tooling can build on it.
- Cheap to create and to keep current, with agents doing the drafting and people doing the reviewing.

**Non-goals**

- Replacing PRDs or design specs. Those describe what we intend to build; the almanac records what the app does now.
- Replacing the test suite. The almanac tells us what should be tested; tests prove it.
- Documenting implementation details. Behaviours describe what a user can observe, not how the code works.

## 4. What the proof of concept built

### The model

An almanac describes an app as a tree:

| Level | Example ID | What it is |
|---|---|---|
| Category | `PD-3` | An area of the product a non-developer would recognise: "Paint rack". |
| Feature | `PD-3.3` | A capability a user would name: "Adding paints". |
| Behaviour | `PD-3.3.2` | One observable outcome: "Search starts after three characters and waits half a second after the last keystroke." |
| Variant | `PD-3.3.2@macos` | A platform difference in how the same outcome is reached. |

Rules that make it trustworthy:

- **IDs are permanent.** They're never reused or renumbered. Removing something leaves a tombstone with a reason, and moving something records its old ID so old links still resolve.
- **Every behaviour cites its code** (`source: PaintingDesk/Paints/AddPaints/AddPaintsSheet.swift#AddPaintsSheet.search`), so anyone can check it, and tooling can tell when the code changes.
- **Status is per platform:** planned, in progress, shipped, being retired or removed, with the version it shipped in.
- **Every feature keeps a changelog** that links the ticket or pull request behind each change.

### Where it lives

The almanac is a folder of small YAML files in the app's own repository, one file per feature. It's reviewed in pull requests exactly like code. Nobody edits the files by hand. All changes go through the `almanac` command-line tool, which allocates IDs, keeps the changelog, and rejects any change that would break the rules.

### What you get from it

- **A website.** One self-contained page with every category, feature and behaviour. It has instant search across names, descriptions and IDs, and deep links (`…#3.3.2` opens that behaviour). It works in light and dark mode and needs no server. A GitHub Actions workflow publishes it to GitHub Pages on every merge (Appendix C).
- **JSON** of the whole model, for dashboards, scripts and agents.
- **A command line** to list, show, check and change it. For example, `almanac show PD-3.3.2` prints one behaviour, and `almanac lint` validates everything.

### Agent workflows

`almanac agent install` adds a skill and four workflows to Claude Code, GitHub Copilot or OpenAI Codex:

| Workflow | What it does | Human checkpoint |
|---|---|---|
| **Generate** | Reads the codebase, proposes categories and features, then writes every behaviour with its source citations. | Approve the proposed structure before any behaviours are written; review the pull request. |
| **Update** | Takes a pull request, commit or branch, finds the behaviours it touches and proposes the almanac changes. | Removals and new features wait for approval; the change is reviewed with the code. |
| **Verify** | Re-reads the cited code for each behaviour and fixes anything that no longer matches. | Review the pull request. |
| **Ask** | Answers "how does X work?" from the almanac, citing behaviour IDs. | None needed. |

## 5. Keeping it current

A source of truth is only useful while it's true. The proof of concept treats maintenance as the main design problem, not an afterthought.

| Step | What happens | Tool |
|---|---|---|
| 1 | An engineer opens a pull request that changes code. | |
| 2 | The tool lists every feature and behaviour whose cited code the pull request changes, and any changed files no behaviour mentions yet. | `almanac affected` |
| 3 | If files were only moved or renamed, citations are repointed automatically. No judgement is needed, so no agent time is spent. | `almanac relink` |
| 4 | An agent reads the diff for each touched behaviour and decides whether a user would notice a difference. Most refactors change nothing. It updates wording, platforms or status, and adds behaviours for anything new. | `/almanac-update #123` |
| 5 | The almanac change is reviewed in the same pull request as the code. The changelog records the pull request. | Code review |
| 6 | CI fails a pull request that changes code cited by a behaviour but doesn't touch the almanac. That's a prompt to run the update, not a hard block on refactors. | `almanac affected --check` |
| 7 | On merge, the website and JSON are rebuilt and published to GitHub Pages. | `almanac site build` and a Pages workflow |

The important property is step 2. The agent doesn't re-read the whole almanac for every change. It looks only at the handful of behaviours the diff touches, which keeps updates fast, cheap and reviewable.

### Copilot on every pull request

Steps 4 and 6 rely on the engineer running the update. GitHub Copilot can also check the almanac on every pull request without anyone asking, in two ways. `almanac agent install --tool copilot --ci` installs both:

- **Copilot code review** (cheap). An instructions file, `.github/instructions/almanac.instructions.md`, tells Copilot's reviewer to flag code changes that alter a documented behaviour, citing its ID, and almanac edits that don't match the code. It adds no runs of its own, because it rides along with a review Copilot was already doing. But it reads the diff and runs nothing, so treat its comments as prompts.
- **The almanac check** (runs the checks). A GitHub Agentic Workflow runs Copilot CLI in Actions whenever a pull request from the same repository is opened or updated. It runs `almanac affected`, then the verify workflow's checks on only the affected behaviours, against the pull request's code. It posts one comment: a table of ID, name, result (confirmed, corrected, unsupported or missing) and the suggested change. It can't push or change anything; that comment is its only output.

Setting up the almanac check, once per repository:

1. Install the gh-aw extension (`gh extension install github/gh-aw`), then run `gh aw compile`. It turns `.github/workflows/almanac-verify.md` into `almanac-verify.lock.yml`; commit both.
2. Add a `COPILOT_GITHUB_TOKEN` repository secret: a fine-grained personal access token with Copilot Requests read access, from a user with a Copilot licence. An organisation that bills Copilot CLI centrally can grant the workflow `copilot-requests: write` instead.
3. In the instructions file, replace the `applyTo` placeholder with the app's source folders, and keep `almanac/**`.

**Cost.** Every run that starts the agent uses Copilot premium requests. `almanac affected` keeps that small. A pull request that changes no cited file stops before the agent starts and costs nothing. Otherwise the agent reads only the behaviours the diff touches. The `affected --check` step in CI stays as the free, deterministic backstop.

## 6. Results so far

Before proposing this for our main codebase, I ran the full workflow on two smaller apps of my own. These were trial runs to prove the approach and shake out the tooling. Our real codebase is substantially bigger.

| | Painting Desk | Magic Sudoku |
|---|---|---|
| Platforms | iOS, iPadOS, macOS, visionOS | iPhone and iPad, Mac |
| Categories | 10 | 11 |
| Features | 66 | 76 |
| Behaviours | 566 | 576 |
| Behaviours citing source code | 566 (100%) | 576 (100%) |
| Source citations | 1,346 across 274 files | 1,155 across 160 files |
| Platform-specific variants | 36 | 25 |
| Lint errors | 0 | 0 |

What the trial runs showed:

- **Generation works with light supervision.** The agent proposed the category and feature structure, which I approved before it wrote anything else. It then wrote behaviours one feature at a time, each citing the code it describes. [Note how much the proposed structure needed changing.]
- **The output is readable by non-engineers.** Behaviours read as plain statements of what a user sees, with the limits, timings and platform differences spelled out. They're the kind of detail Support and QA usually have to ask for.
- **Change tracking is precise.** On a real three-commit change to Painting Desk, which touched 167 files including a folder reorganisation that moved 155 of them, `almanac affected` narrowed the review to 47 features and 260 behaviours. It confirmed that none of the 467 affected citations had gone stale. Without it, an agent or reviewer would have had to reason about all 566 behaviours.
- **The tool is tested.** The CLI, website generator and rules engine have 159 automated tests.

[Time and agent cost to generate each almanac: fill in before review.]

## 7. The wider picture: a source of truth for app behaviour

The almanac is meant to be the reference everyone else builds on, not another document to maintain.

| Who | How they use it |
|---|---|
| **Support** | Look up exactly how something works on each platform; cite behaviour IDs in macros and escalations. |
| **QA** | Build test plans from behaviours instead of from memory; know which platforms differ. |
| **Product** | See the current state of a feature and its history; write acceptance criteria as `planned` behaviours that flip to `shipped` when they land. |
| **Engineering** | Onboard faster; jump from a behaviour to the code that implements it; know which behaviours a change affects before merging. |
| **Release management** | Draft release notes from the changelog entries of the features a release touched. |
| **Agents** | Answer behaviour questions accurately, and make changes knowing which documented outcomes they must preserve. |

How it relates to the documents we already have:

- **PRDs and design specs** stay the place for intent and rationale. A PRD's acceptance criteria can be added as `planned` behaviours, so the almanac shows what's coming as well as what's live.
- **Tickets and bug reports** cite behaviour IDs. A bug becomes "PD-3.3.2 doesn't wait half a second on iPad", which is unambiguous to everyone.
- **Tests** reference behaviour IDs, which is the bridge to the next phase.

## 8. Next phase: finding under-tested behaviour and automating tests

This phase isn't built yet. It's the reason the almanac is structured the way it is.

### The idea

Every behaviour is a claim about what the app does. A claim with no test behind it is only as good as the last time someone checked. If tests are linked to behaviour IDs, we can measure coverage in the terms that matter ("which promised outcomes are protected?"), find the gaps, and close them with generated tests. A generated test that fails tells us something important: either the code has a bug or the documentation is wrong. Either way, a person needs to look.

### Proposed steps

1. **Link tests to behaviours.** Tests name the behaviour they check, either through a tag or naming convention (for example, a test tagged `PD-3.3.2`) or a `tests` field on the behaviour. The tool builds a map from behaviours to tests.
2. **Measure behaviour coverage.** For each behaviour, report one of three states:
   - **Explicitly tested:** a test names it.
   - **Incidentally exercised:** its cited code runs under some test, according to the coverage report, but nothing asserts the outcome.
   - **Untested.**

   Roll this up per feature and category, show it on the website, and track it in CI over time.
3. **Prioritise the gaps.** Rank untested behaviours by risk. Signals:
   - shipped on several platforms;
   - in high-stakes areas (purchases, data, sync);
   - recently changed (from `almanac affected` history);
   - cited in bug reports.
4. **Generate tests.** A new agent workflow (`/almanac-test PD-3.3.2`) reads the behaviour and its cited code. It writes a unit or UI test that asserts the documented outcome, runs it, and opens a pull request. Behaviours already written as Given/When/Then map directly onto UI tests.
5. **Treat failures as disagreements, not just bugs.** A failing generated test goes to a person. They decide whether the code is wrong (file a bug and cite the ID) or the almanac is wrong (fix the behaviour). Either way, the source of truth gets more accurate.
6. **Use the map for faster CI.** Because a pull request's affected behaviours are known (step 2 of section 5), CI can run the tests for those behaviours first.

The result is a loop: code changes update the almanac, the almanac shows what's untested, agents write the missing tests, and the tests keep the almanac honest.

## 9. Proposal

### Pilot on our main codebase

- **Scope:** one area of the real app, owned by one team. [Choose the area: ideally high-traffic, with known support questions and some existing tests.]
- **Duration:** [6 weeks].
- **Work:**
  1. Generate the almanac for that area with the generate workflow, reviewed by the owning team.
  2. Add `almanac affected --check` to CI for that area.
  3. Use the update workflow on every pull request that touches it.
  4. Publish the website internally.
- **Measures:**
  - the share of relevant pull requests that update the almanac in the same change;
  - support and QA questions answered from the site instead of by engineers;
  - review time added per pull request;
  - agent cost per update.

### Then the test-gap phase

Build steps 1–3 of section 8 against the pilot area, measure the baseline behaviour coverage, and trial generated tests on the highest-risk gaps.

### Scaling to the full codebase

The real codebase is substantially bigger than the trial apps, so the pilot should answer these questions before a wider rollout:

- **Generation:** works area by area rather than in one pass. Each team generates and owns its categories, with the feature `owner` field naming who approves changes.
- **Review load:** a few thousand behaviours means each team reviews only its own. CI flags only behaviours whose code changed.
- **Repositories and platforms:** one almanac can span several repositories and platforms (`code.path`, platform tags). This is proven so far only on Apple platforms.
- **Hosting:** the site is a single static page, published with GitHub Pages from the app's repository (Appendix C). Pages must be private to the organisation, because the almanac lists unreleased (`planned`, `in-progress`) behaviour.

### Decisions needed

| Decision | Owner |
|---|---|
| Pilot area and owning team | [PM / EM] |
| Engineer time for the pilot | [EM] |
| CI integration, and turning on private GitHub Pages for the repository | [EM] |
| Budget for agent usage during the pilot | [PM / EM] |
| Whether behaviour IDs go into ticket and bug templates | [PM] |

## 10. Risks and open questions

| Risk | Mitigation |
|---|---|
| **Drift:** teams skip updates and the almanac goes stale. | CI check on cited code; an update workflow that makes the update a few minutes' review, not an afternoon's writing; `almanac lint` flags citations whose files no longer exist. |
| **Accuracy:** an agent writes a plausible but wrong behaviour. | Every behaviour must cite code; the verify workflow re-checks against the code; people review in pull requests; tests (section 8) are the durable proof. |
| **Granularity:** too fine and it's noise, too coarse and it's useless. | The workflows enforce "one observable outcome per behaviour", and the pilot will calibrate this for our codebase. |
| **Ownership:** nobody feels responsible for the almanac. | Owners per feature; changes ride along with the code their team already owns. |
| **Cost:** agent usage across many pull requests. | Updates only read the behaviours a diff touches, and moved files are handled without an agent. The pilot will measure the real cost. |
| **Exposure:** the published site lists unreleased behaviour. | Publish with GitHub Pages set to private, so only signed-in members of the organisation can open it. Private Pages needs GitHub Enterprise Cloud; without it, host the page internally instead. |
| **Tool maturity:** this is a proof of concept. | It's small, tested (159 tests) and needs only Node.js to run. Comparing against a git history (`lint --against`) is still to come. |

## Appendix A. Example behaviour

Behaviour `PD-3.3.2` from the Painting Desk trial, as stored in `almanac/03-paint-rack/03-adding-paints.yaml`:

```yaml
- id: "3.3.2"
  name: Search from three characters, after a half-second pause
  description: Nothing is searched until three characters are typed, and then only once typing has paused for 500 ms; each new keystroke restarts the wait. The clear button (an x in the field) empties it.
  source:
    - PaintingDesk/Paints/AddPaints/AddPaintsSheet.swift#AddPaintsSheet.search
    - PaintingDesk/Paints/AddPaints/AddPaintsSearchBar.swift#AddPaintsSearchBar
```

## Appendix B. Commands at a glance

| Command | Purpose |
|---|---|
| `almanac agent install --tool claude,copilot,codex` | Add the skill and workflows to a repository. |
| `almanac agent install --tool copilot --ci` | Also add Copilot's pull request checks (section 5). |
| `almanac list`, `almanac show PD-3.3.2` | Read the almanac. |
| `almanac affected --base main` | What does this branch touch? |
| `almanac relink main...HEAD` | Follow renamed files. |
| `almanac lint`, `almanac fmt --check` | Validate and format, for example in CI. |
| `almanac site build` | Build the website. |

## Appendix C. Publishing with GitHub Pages

The site build writes two files: `index.html`, a self-contained page, and `almanac.json`. Every link in the page is relative, so it works from a Pages address such as `https://<org>.github.io/<repo>/`, and deep links such as `…/#3.3.2` work too.

**Set up, once per repository:**

1. In the repository's Settings → Pages, set the source to "GitHub Actions" and the visibility to "Private" (organisation members only). Private visibility needs GitHub Enterprise Cloud.
2. Add the workflow below as `.github/workflows/almanac-site.yml`.
3. Merge it. From then on, every merge that changes `almanac/` republishes the site, usually within a couple of minutes.

The workflow uses the Feature Almanac action (`BenjaminBriggs/Feature-Almanac@main`). It sets up Node, builds the `almanac` tool, puts `almanac` on PATH for later steps in the job and writes the site to `_site`. It only builds: the upload and deploy steps stay in the workflow, so the same action could feed another host. Its inputs are `site` (default `true`), `root` (the almanac folder, default `almanac`), `out` (default `_site`) and `node-version` (default `22`). With `site: "false"` the action skips the site build and only installs the CLI; the almanac check on pull requests (§5) installs it this way.

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

`@main` tracks the tool's main branch. To keep builds stable, pin a commit SHA.

**Fallback: build the tool from source.** If the action can't be used, for example because our copy of the tool's repository is private and its Actions access setting doesn't reach the app repository, replace the action step with these four steps. For a private repository, give the second checkout a read token.

```yaml
      - uses: actions/checkout@v4
        with:
          repository: BenjaminBriggs/Feature-Almanac
          path: .feature-almanac
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci && npm run build
        working-directory: .feature-almanac
      - run: node .feature-almanac/packages/cli/dist/bin.js --root almanac site build --out _site
```

## Appendix D. Glossary

- **Almanac:** the record of every behaviour of one app.
- **Behaviour:** one outcome a user can observe, with a permanent ID.
- **Citation (source):** the file and symbol that implement a behaviour.
- **Tombstone:** a removed behaviour, kept with its reason so its ID is never reused.
- **Variant:** a platform difference in how a behaviour is reached.
