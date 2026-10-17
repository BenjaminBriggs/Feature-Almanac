import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin'
import { IdGenerator } from '@cucumber/messages'
import type { GherkinScenario } from '@feature-almanac/schema'

const SCENARIO_LINE = /^\s*(Scenario Outline|Scenario Template|Scenario|Example|Rule):/m

export type GherkinResult = { ok: true; scenarios: GherkinScenario[] } | { ok: false; message: string }

/**
 * Parses a `format: gherkin` description. Descriptions hold bare steps, which the Gherkin parser
 * rejects, so they are wrapped in a synthetic Feature (and Scenario, unless the text has its own).
 */
export function parseGherkin(description: string): GherkinResult {
  const body = description
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n')
  const source = SCENARIO_LINE.test(description)
    ? `Feature: Behaviour\n${body}\n`
    : `Feature: Behaviour\n  Scenario:\n${body}\n`

  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher())
  let document
  try {
    document = parser.parse(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message: (message.split('\n')[0] ?? message).replace(/^\(\d+:\d+\):\s*/, '') }
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
  return { ok: true, scenarios }
}
