#!/usr/bin/env node
import { nodeIo } from './io.js'
import { run } from './program.js'

process.exitCode = await run(process.argv.slice(2), nodeIo())
