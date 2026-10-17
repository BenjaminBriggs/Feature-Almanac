import { Command, CommanderError } from 'commander'
import { registerAffectedCommand } from './commands/affected.js'
import { registerCheckCommands } from './commands/check.js'
import { registerAgentCommands } from './commands/agent.js'
import { registerApplyCommand } from './commands/apply.js'
import { registerReadCommands } from './commands/read.js'
import { registerRelinkCommand } from './commands/relink.js'
import { registerSiteCommands } from './commands/site.js'
import { registerWriteCommands } from './commands/write.js'
import { Context, EXIT, type Globals } from './context.js'
import type { Io } from './io.js'

export const VERSION = '0.1.0'

/** Wraps a command handler: builds its Context, records its exit code and reports thrown errors. */
export type Wrap = <A extends unknown[]>(
  name: string,
  handler: (ctx: Context, ...args: A) => number | void | Promise<number | void>,
) => (...args: unknown[]) => Promise<void>

/** Runs `almanac <argv>` and resolves to the §11 exit code. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let exitCode: number = EXIT.ok
  const wrap: Wrap = (name, handler) => async (...args) => {
    const command = args[args.length - 1] as Command
    const ctx = new Context(io, command.optsWithGlobals<Globals>(), name)
    try {
      // Commander passes the positional arguments, then the options, then the command itself.
      const untyped = handler as (ctx: Context, ...rest: unknown[]) => number | void | Promise<number | void>
      exitCode = (await untyped(ctx, ...args.slice(0, -1))) ?? EXIT.ok
    } catch (error) {
      exitCode = ctx.fail(error)
    }
  }

  const program = new Command('almanac')
    .description('Read, write, validate and publish a Feature Almanac')
    .exitOverride()
    .configureOutput({ writeOut: (text) => io.stdout(text), writeErr: (text) => io.stderr(text) })
    .version(VERSION, '--version', 'print the version')
    .option('--root <path>', 'almanac root (default: ALMANAC_ROOT, then search upwards)')
    .option('--json', 'machine output on stdout (§11 envelope)')
    .option('-q, --quiet', 'errors only')
    .option('--no-color', 'plain text')
    .option('--dry-run', 'write commands print the resulting diff and change nothing')

  registerWriteCommands(program, wrap)
  registerApplyCommand(program, wrap)
  registerReadCommands(program, wrap)
  registerCheckCommands(program, wrap)
  registerAffectedCommand(program, wrap)
  registerRelinkCommand(program, wrap)
  registerSiteCommands(program, wrap)
  registerAgentCommands(program, wrap)

  try {
    await program.parseAsync([...argv], { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? EXIT.ok : EXIT.usage
    throw error
  }
  return exitCode
}
