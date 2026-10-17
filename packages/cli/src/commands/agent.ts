import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyChanges, renderDiff, UsageError, type FileChange } from '@feature-almanac/core'
import type { Command } from 'commander'
import { EXIT } from '../context.js'
import type { Wrap } from '../program.js'

const ASSETS = fileURLToPath(new URL('../../assets/agent/', import.meta.url))

/** A tool-neutral workflow (generate, update, verify, ask) from `assets/agent/workflows/`. */
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
}

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
    note: () => 'In Claude Code: /almanac-generate to build an almanac from this codebase, /almanac-update after a code change, /almanac-ask to query it.',
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
        ? 'Copilot now has the almanac skill in every project. Its prompts (/almanac-generate, /almanac-update, /almanac-verify, /almanac-ask) are per repository: run agent install --tool copilot in one.'
        : 'In Copilot Chat: /almanac-generate to build an almanac from this codebase, /almanac-update after a code change, /almanac-ask to query it.',
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
    note: () => 'In Codex: $almanac-generate to build an almanac from this codebase, $almanac-update after a code change, $almanac-ask to query it.',
  },
}

export function registerAgentCommands(program: Command, wrap: Wrap): void {
  const agent = program.command('agent').description('Agent integration (§13)')
  agent
    .command('install')
    .description('Install the Feature Almanac skill and its generate, update, verify and ask workflows for an agent')
    .option('--tool <tools>', 'claude, copilot or codex; a comma-separated list installs several', 'claude')
    .option('--global', 'install for every project (in your home folder) instead of this one')
    .action(
      wrap('agent install', (ctx, options: { tool: string; global?: boolean }) => {
        const names = [...new Set(options.tool.split(',').map((name) => name.trim()).filter((name) => name !== ''))]
        const unknown = names.filter((name) => TOOLS[name] === undefined)
        if (names.length === 0 || unknown.length > 0) {
          throw new UsageError(`--tool ${unknown.join(',') || options.tool} is not supported; use claude, copilot or codex`)
        }
        const global = options.global === true
        const skill = readFileSync(join(ASSETS, 'skill', 'SKILL.md'), 'utf8')
        const workflows = readdirSync(join(ASSETS, 'workflows'))
          .filter((file) => file.endsWith('.md'))
          .sort()
          .map((file) => parseWorkflow(file.slice(0, -'.md'.length), readFileSync(join(ASSETS, 'workflows', file), 'utf8')))

        const changes: FileChange[] = []
        const changed: string[] = []
        for (const name of names) {
          const tool = TOOLS[name] as Tool
          const base = global ? join(ctx.io.home, tool.global) : join(ctx.io.cwd, tool.project)
          const files: [string, string][] = [['skills/almanac/SKILL.md', skill]]
          for (const workflow of workflows) {
            const target = tool.workflow(workflow, global)
            if (target !== undefined) files.push([target.path, withFrontmatter(target.frontmatter, renderBody(workflow, tool))])
          }
          const before = changes.length
          for (const [file, content] of files) {
            const path = join(base, file)
            const previous = ctx.io.fs.readFile(path)
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
        }
        ctx.envelope(true, { tools: names, files: changes.map((change) => (change.kind === 'rename' ? change.to : change.path)), dryRun: ctx.dryRun })
        return EXIT.ok
      }),
    )
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
