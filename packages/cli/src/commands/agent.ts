import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyChanges, renderDiff, UsageError, type FileChange } from '@feature-almanac/core'
import type { Command } from 'commander'
import { EXIT } from '../context.js'
import type { Wrap } from '../program.js'

const ASSETS = fileURLToPath(new URL('../../assets/agent/', import.meta.url))

/** A tool-neutral workflow (generate, update, verify, review, ask) from `assets/agent/workflows/`. */
interface Workflow {
  name: string
  /** Frontmatter: `description`, `argument-hint`, `input` and `when`. */
  meta: Record<string, string>
  /** Markdown with `{{input}}` and `{{verify}}` placeholders. */
  body: string
}

interface Tool {
  /** The tool's folder in a project, relative to the working directory. */
  project: string
  /** The tool's folder for --global, relative to the home folder. */
  global: string
  /** What `{{input}}` becomes: how the workflow receives the user's arguments. */
  input: string
  /** What `{{verify}}` becomes: how one workflow invokes the verify workflow. */
  verify: string
  /** Where a workflow is written, relative to the tool's folder, and its frontmatter; undefined skips it. */
  workflow(workflow: Workflow, global: boolean): { path: string; frontmatter: Record<string, string> } | undefined
  note(global: boolean): string
  /** --ci: pull request checks, as [file in `assets/agent/github/`, path relative to the tool's folder]. */
  ci?: [asset: string, path: string][]
}

/** The `applyTo` value in the Copilot instructions template, until the repository names its source globs. */
const SOURCE_GLOBS = 'YOUR_SOURCE_GLOBS'

const TOOLS: Record<string, Tool> = {
  claude: {
    project: '.claude',
    global: '.claude',
    input: '$ARGUMENTS',
    verify: '`/almanac-verify`',
    workflow: ({ name, meta }) => ({
      path: `commands/almanac-${name}.md`,
      frontmatter: { description: field(meta, 'description'), 'argument-hint': field(meta, 'argument-hint') },
    }),
    note: () => 'In Claude Code: /almanac-generate to build an almanac from this codebase, /almanac-update after a code change, /almanac-verify to check it against the code, /almanac-review with a reviewer\'s decisions file, /almanac-ask to query it.',
  },
  copilot: {
    project: '.github',
    global: '.copilot',
    input: 'the text typed after the command (may be empty)',
    verify: 'the `/almanac-verify` prompt',
    // Prompt files are per repository or per VS Code profile; there is no home folder for them.
    workflow: ({ name, meta }, global) =>
      global
        ? undefined
        : {
            path: `prompts/almanac-${name}.prompt.md`,
            frontmatter: { description: field(meta, 'description'), 'argument-hint': field(meta, 'argument-hint'), agent: 'agent' },
          },
    note: (global) =>
      global
        ? 'Copilot now has the almanac skill in every project. Its prompts (/almanac-generate, /almanac-update, /almanac-verify, /almanac-review, /almanac-ask) are per repository: run agent install --tool copilot in one.'
        : 'In Copilot Chat: /almanac-generate to build an almanac from this codebase, /almanac-update after a code change, /almanac-verify to check it against the code, /almanac-review with a reviewer\'s decisions file, /almanac-ask to query it.',
    ci: [
      ['almanac-verify.md', 'workflows/almanac-verify.md'],
      ['almanac.instructions.md', 'instructions/almanac.instructions.md'],
    ],
  },
  codex: {
    project: '.agents',
    global: '.agents',
    input: 'what the user asked for',
    verify: 'the `$almanac-verify` skill',
    workflow: ({ name, meta }) => ({
      path: `skills/almanac-${name}/SKILL.md`,
      frontmatter: { name: `almanac-${name}`, description: `${field(meta, 'description')}. ${field(meta, 'when')}` },
    }),
    note: () => 'In Codex: $almanac-generate to build an almanac from this codebase, $almanac-update after a code change, $almanac-verify to check it against the code, $almanac-review with a reviewer\'s decisions file, $almanac-ask to query it.',
  },
}

export function registerAgentCommands(program: Command, wrap: Wrap): void {
  const agent = program.command('agent').description('Agent integration (§13)')
  agent
    .command('install')
    .description('Install the Feature Almanac skill and its generate, update, verify, review and ask workflows for an agent')
    .option('--tool <tools>', 'claude, copilot or codex; a comma-separated list installs several', 'claude')
    .option('--global', 'install for every project (in your home folder) instead of this one')
    .option('--ci', 'with --tool copilot, also install the pull request checks: an agentic workflow and Copilot code review instructions')
    .action(
      wrap('agent install', (ctx, options: { tool: string; global?: boolean; ci?: boolean }) => {
        const names = [...new Set(options.tool.split(',').map((name) => name.trim()).filter((name) => name !== ''))]
        const unknown = names.filter((name) => TOOLS[name] === undefined)
        if (names.length === 0) throw new UsageError('--tool needs a tool name; use claude, copilot or codex')
        if (unknown.length > 0) throw new UsageError(`--tool ${unknown.join(',')} is not supported; use claude, copilot or codex`)
        const global = options.global === true
        const ci = options.ci === true
        if (ci && global) throw new UsageError('--ci installs into a repository, so it cannot be combined with --global')
        if (ci && names.every((name) => (TOOLS[name] as Tool).ci === undefined)) throw new UsageError('--ci installs pull request checks for Copilot; add --tool copilot')
        const skill = readFileSync(join(ASSETS, 'skill', 'SKILL.md'), 'utf8')
        const workflows = readdirSync(join(ASSETS, 'workflows'))
          .filter((file) => file.endsWith('.md'))
          .sort()
          .map((file) => parseWorkflow(file.slice(0, -'.md'.length), readFileSync(join(ASSETS, 'workflows', file), 'utf8')))

        const changes: FileChange[] = []
        const changed: string[] = []
        const checks: { path: string; content: string }[] = []
        for (const name of names) {
          const tool = TOOLS[name] as Tool
          const base = global ? join(ctx.io.home, tool.global) : join(ctx.io.cwd, tool.project)
          const files: [string, string][] = [['skills/almanac/SKILL.md', skill]]
          for (const workflow of workflows) {
            const target = tool.workflow(workflow, global)
            if (target !== undefined) files.push([target.path, withFrontmatter(target.frontmatter, renderBody(workflow, tool))])
          }
          const ciFiles = ci ? (tool.ci ?? []).map(([asset, file]): [string, string] => [file, readFileSync(join(ASSETS, 'github', asset), 'utf8')]) : []
          const before = changes.length
          for (const [file, template] of [...files, ...ciFiles]) {
            const path = join(base, file)
            const previous = ctx.io.fs.readFile(path)
            const content = file.endsWith('.instructions.md') ? keepApplyTo(template, previous) : template
            if (ciFiles.some(([ciFile]) => ciFile === file)) checks.push({ path, content })
            if (previous === content) continue
            changes.push(previous === undefined ? { kind: 'write', path, content } : { kind: 'write', path, content, previous })
          }
          if (changes.length > before) changed.push(name)
        }

        const shown = (path: string) => relative(ctx.io.cwd, path).split(sep).join('/')
        if (ctx.dryRun) ctx.out(renderDiff(changes, ctx.io.cwd))
        else {
          applyChanges(ctx.io.fs, changes)
          ctx.out(changes.length === 0 ? 'Already up to date.' : changes.map((change) => `Wrote ${change.kind === 'write' ? shown(change.path) : ''}`).join('\n'))
          for (const name of changed) ctx.note((TOOLS[name] as Tool).note(global))
          if (changes.some((change) => change.kind === 'write' && checks.some((check) => check.path === change.path))) ctx.note(checksNote(checks, shown))
        }
        ctx.envelope(true, { tools: names, files: changes.map((change) => (change.kind === 'rename' ? change.to : change.path)), dryRun: ctx.dryRun })
        return EXIT.ok
      }),
    )
}

/** What the pull request checks need before they run, which `agent install` can't do itself. */
function checksNote(checks: { path: string; content: string }[], shown: (path: string) => string): string {
  const steps = [
    'Before Copilot checks pull requests:',
    '  1. Run gh aw compile (from the gh-aw extension: gh extension install github/gh-aw). It writes .github/workflows/almanac-verify.lock.yml; commit it with the .md.',
    '  2. Add the COPILOT_GITHUB_TOKEN secret: a fine-grained personal access token with Copilot Requests read access (gh aw secrets set COPILOT_GITHUB_TOKEN --value <token>).',
  ]
  const placeholder = checks.find((check) => check.content.includes(SOURCE_GLOBS))
  if (placeholder !== undefined) steps.push(`  3. In ${shown(placeholder.path)}, replace ${SOURCE_GLOBS} with the globs of your app's source, such as src/**.`)
  return steps.join('\n')
}

/** Keeps the `applyTo` globs a repository already set, so installing again doesn't reset them to the placeholder. */
function keepApplyTo(template: string, previous: string | undefined): string {
  const line = previous === undefined ? undefined : /^applyTo:.*$/m.exec(previous)?.[0]
  return line === undefined ? template : template.replace(/^applyTo:.*$/m, line)
}

/** Splits a workflow template into its frontmatter (`key: value`, values optionally JSON-quoted) and body. */
function parseWorkflow(name: string, text: string): Workflow {
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(text)
  if (match === null) throw new Error(`assets/agent/workflows/${name}.md has no frontmatter`)
  const meta: Record<string, string> = {}
  for (const line of (match[1] as string).split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const value = line.slice(colon + 1).trim()
    meta[line.slice(0, colon).trim()] = value.startsWith('"') ? (JSON.parse(value) as string) : value
  }
  return { name, meta, body: match[2] as string }
}

function field(meta: Record<string, string>, key: string): string {
  const value = meta[key]
  if (value === undefined) throw new Error(`a workflow template is missing "${key}"`)
  return value
}

function renderBody(workflow: Workflow, tool: Tool): string {
  const body = workflow.body.replaceAll('{{input}}', tool.input).replaceAll('{{verify}}', tool.verify)
  if (body.includes('{{')) throw new Error(`assets/agent/workflows/${workflow.name}.md has an unknown placeholder`)
  return body
}

/** Values are written as JSON strings, which YAML reads as double-quoted scalars. */
function withFrontmatter(frontmatter: Record<string, string>, body: string): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  return `---\n${lines.join('\n')}\n---\n\n${body}`
}
