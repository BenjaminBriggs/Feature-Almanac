export type Severity = 'error' | 'warn'
export type LintLevel = Severity | 'off'

/** §10 diagnostic JSON. */
export interface Diagnostic {
  code: RuleCode
  severity: Severity
  message: string
  id?: string
  file: string
  path?: string
  line?: number
  fixable: boolean
}

interface RuleDefinition {
  severity: Severity
  summary: string
}

/**
 * §10 lint rules available without git history. ALM-E020, ALM-E021 and ALM-W020 arrive with
 * `lint --against` in v0.3. ALM-E012, ALM-E013, ALM-W017 and ALM-W018 are additions: counters,
 * category removal, empty features and removal propagation.
 */
export const RULES = {
  'ALM-E001': { severity: 'error', summary: 'File is not valid YAML 1.2' },
  'ALM-E002': { severity: 'error', summary: 'Unknown key' },
  'ALM-E003': { severity: 'error', summary: 'ID is not a quoted string' },
  'ALM-E004': { severity: 'error', summary: 'ID malformed, or not under its parent' },
  'ALM-E005': { severity: 'error', summary: 'Duplicate ID, including against formerly' },
  'ALM-E006': { severity: 'error', summary: 'Required field missing' },
  'ALM-E007': { severity: 'error', summary: 'Value not in vocabulary' },
  'ALM-E008': { severity: 'error', summary: 'Reference does not resolve' },
  'ALM-E009': { severity: 'error', summary: 'Schema violation' },
  'ALM-E010': { severity: 'error', summary: 'Behaviours not in ID order' },
  'ALM-E011': { severity: 'error', summary: 'Removed entity without reason' },
  'ALM-E012': { severity: 'error', summary: 'ID counter is not ahead of every used ID' },
  'ALM-E013': { severity: 'error', summary: 'Removed category still contains live features' },
  'ALM-E030': { severity: 'error', summary: 'Behaviour platforms not within feature platforms' },
  'ALM-E031': { severity: 'error', summary: 'Variant platforms not within behaviour platforms' },
  'ALM-E032': { severity: 'error', summary: 'Variants of one behaviour overlap' },
  'ALM-E033': { severity: 'error', summary: 'Platform map key outside the entity, or incomplete feature status map' },
  'ALM-E034': { severity: 'error', summary: 'Unknown platform or group tag' },
  'ALM-E040': { severity: 'error', summary: 'Changelog not newest-first, or entry with no changes' },
  'ALM-W001': { severity: 'warn', summary: 'File or folder name does not match ID and name' },
  'ALM-W010': { severity: 'warn', summary: 'Owner not in owners registry' },
  'ALM-W011': { severity: 'warn', summary: 'Behaviour has no source' },
  'ALM-W012': { severity: 'warn', summary: 'Behaviour or variant never added in the changelog' },
  'ALM-W013': { severity: 'warn', summary: 'Source, code or asset path not found' },
  'ALM-W014': { severity: 'warn', summary: 'Feature exceeds max_behaviours_per_feature' },
  'ALM-W015': { severity: 'warn', summary: 'Gherkin description does not parse' },
  'ALM-W016': { severity: 'warn', summary: 'Description empty or under 20 characters' },
  'ALM-W017': { severity: 'warn', summary: 'Feature has no behaviours' },
  'ALM-W018': { severity: 'warn', summary: 'Status overridden by a removed parent' },
} as const satisfies Record<string, RuleDefinition>

export type RuleCode = keyof typeof RULES
