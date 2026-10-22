# Working with agents

Most almanacs are written by an agent reading the code, with you approving the structure. Install the skill and workflows for your agent from the root of the app's repository:

```bash
almanac agent install --tool claude      # Claude Code (the default)
almanac agent install --tool copilot     # GitHub Copilot
almanac agent install --tool codex       # OpenAI Codex
almanac agent install --tool claude,copilot,codex
```

Add `--global` to install for every project in your home folder, and `--dry-run` (before `agent`) to see the files first. Run the same command again after updating the CLI; files that haven't changed are left alone, and any edits you made to the installed files are overwritten, except the `applyTo` line of the Copilot instructions file. With `--tool copilot`, `--ci` also adds checks that run on every pull request (see [Copilot on every pull request](github.md#copilot-on-every-pull-request)).

Commit the installed files so everyone working in the repository gets them.

## The skill

Each install adds the **`almanac` skill**. It tells the agent how the almanac works, to change it only through the CLI, to write behaviours as a summary and Given/When/Then steps, and to update the almanac in the same change as the code. Agents load it on their own when a task matches, for example when a change alters what the app does, or when you ask how something works.

## The workflows

| Workflow | What it does |
|---|---|
| **generate** | Builds the first almanac from the code. It proposes categories and features, **stops for your approval**, then writes the behaviours one feature at a time, verifies them and lints. |
| **update** | Brings the almanac in line with a code change: a pull request, a commit, a range or uncommitted work. See [Keeping it current](keeping-current.md). |
| **verify** | Checks behaviours (all of them, or the IDs you name) against the code they cite, fixes wording, platforms and status, and adds what's missing. |
| **review** | Records a reviewer's decisions file from the website, then works through the rejections. See [Reviewing behaviours](reviewing.md#acting-on-rejections). |
| **ask** | Answers "how does X work?" from the almanac, citing behaviour IDs. |

## Where the files go

| Tool | In the project | With `--global` | Run a workflow |
|---|---|---|---|
| Claude Code | `.claude/skills/almanac/`, `.claude/commands/almanac-*.md` | `~/.claude/…` | `/almanac-generate`, `/almanac-update #123`, `/almanac-verify 1.2`, `/almanac-review review-ex-sam-price-2026-10-20.json`, `/almanac-ask how does autosave work?` |
| GitHub Copilot | `.github/skills/almanac/`, `.github/prompts/almanac-*.prompt.md` | `~/.copilot/skills/almanac/` (skill only) | In VS Code Copilot Chat: `/almanac-generate`, `/almanac-update`, `/almanac-verify`, `/almanac-review`, `/almanac-ask` |
| OpenAI Codex | `.agents/skills/almanac/`, `.agents/skills/almanac-{generate,update,verify,review,ask}/` | `~/.agents/skills/…` | `$almanac-generate`, `$almanac-update`, `$almanac-verify`, `$almanac-review`, `$almanac-ask`, or pick one from `/skills` |

- **Copilot prompt files are per repository.** VS Code keeps your own prompt files in each profile, so `--global` installs only the skill. Run the install inside a repository to get the `/almanac-*` prompts.
- **Copilot and Codex share some folders.** Copilot also reads skills from `.claude/skills` and `.agents/skills`, so a repository set up for Claude Code or Codex already gives Copilot's agent the skill.
