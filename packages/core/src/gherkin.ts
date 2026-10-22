import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import type { GherkinScenario } from '@feature-almanac/schema'

const SCENARIO_LINE = /^\s*(Scenario Outline|Scenario Template|Scenario|Example|Rule):/m

export type GherkinResult = { ok: true; scenarios: GherkinScenario[]; summary?: string } | { ok: false; message: string }

/**
 * Parses a `format: gherkin` description. Descriptions hold bare steps, which the Gherkin parser
 * rejects, so they are wrapped in a synthetic Feature (and Scenario, unless the text has its own).
 * Plain text above the first step or `Scenario:` line is the behaviour's one-line summary.
 */
export function parseGherkin(description: string): GherkinResult {
  const body = description
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  const named = SCENARIO_LINE.test(description)
  const source = named ? `Feature: Behaviour\n${body}\n` : `Feature: Behaviour\n  Scenario:\n${body}\n`

  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher())
  let document
  try {
    document = parser.parse(source)
  } catch (error) {
    return { ok: false, message: parserMessage(error, named ? 1 : 2, description.split('\n').length) }
  }

  const scenarios: GherkinScenario[] = []
  const collect = (scenario: { name: string; steps: readonly { keyword: string; text: string }[] }) => {
    const entry: GherkinScenario = {
      steps: scenario.steps.map((step) => ({ keyword: step.keyword.trim(), text: step.text })),
    }
    if (scenario.name !== '') entry.name = scenario.name
    scenarios.push(entry)
  }
  for (const child of document.feature?.children ?? []) {
    if (child.scenario !== undefined) collect(child.scenario)
    for (const ruleChild of child.rule?.children ?? []) {
      if (ruleChild.scenario !== undefined) collect(ruleChild.scenario)
    }
  }
  if (scenarios.every((scenario) => scenario.steps.length === 0)) {
    return { ok: false, message: 'no Given/When/Then steps found' }
  }
  // Text before the steps is the synthetic Scenario's description, or the Feature's when the text names its scenarios.
  const lead = named ? document.feature?.description : document.feature?.children[0]?.scenario?.description
  const summary = (lead ?? '').split('\n').map((line) => line.trim()).filter((line) => line !== '').join(' ')
  return summary === '' ? { ok: true, scenarios } : { ok: true, scenarios, summary }
}

type ParserError = { message: string; location?: { line?: number } }

/**
 * The parser's first complaint, with its line counted from the top of the description rather than the synthetic
 * wrapper (`offset` lines above it). The parser throws a composite error whose own message is only a heading.
 */
function parserMessage(error: unknown, offset: number, lines: number): string {
  const errors = (error as { errors?: readonly ParserError[] }).errors
  const first: ParserError = errors?.[0] ?? (error instanceof Error ? (error as ParserError) : { message: String(error) })
  const text = first.message.replace(/^\(\d+:\d+\):\s*/, '')
  const line = (first.location?.line ?? 0) - offset
  return line >= 1 && line <= lines ? `the Gherkin parser rejects line ${line}: ${text}` : `the Gherkin parser rejects it: ${text}`
}
