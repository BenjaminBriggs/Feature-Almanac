import { z } from 'zod'
import { ABSOLUTE_URL_RE, DATE_RE, PLATFORM_TAG_RE, PREFIX_RE, TAG_RE } from './refs.js'

/*
 * Structural schemas for the three file kinds (§4–§7). Vocabularies that come from
 * almanac.yaml (statuses, platforms, formats, link types, owners, custom fields) and every
 * cross-file rule are checked by `almanac lint`, not here.
 */

const platformTag = z.string().regex(PLATFORM_TAG_RE)
const lintLevel = z.enum(['off', 'warn', 'error'])
const tag = z.string().regex(TAG_RE)
const absoluteUrl = z.string().regex(ABSOLUTE_URL_RE)
const version = z.string()
const counter = z.number().int().min(1)

export const fieldDefinitionSchema = z.strictObject({
  type: z.enum(['string', 'enum', 'list', 'bool', 'number']),
  values: z.array(z.string()).optional(),
})

export const configSchema = z.strictObject({
  almanac: z.literal(1),
  // Counters are required, but enforced by lint (ALM-E006, fixable) so a file missing one still compiles.
  next_category: counter.optional(),
  product: z.strictObject({
    name: z.string().min(1),
    prefix: z.string().regex(PREFIX_RE).optional(),
    description: z.string().optional(),
  }),
  code: z
    .strictObject({
      repo: absoluteUrl.optional(),
      ref: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
    })
    .optional(),
  platforms: z.record(platformTag, z.strictObject({ name: z.string().min(1) })),
  platform_groups: z.record(platformTag, z.array(z.string())).optional(),
  statuses: z.array(z.string().min(1)).min(1).optional(),
  formats: z
    .strictObject({
      default: z.string().optional(),
      allowed: z.array(z.string()).min(1).optional(),
    })
    .optional(),
  link_types: z.array(z.string()).min(1).optional(),
  owners: z.record(z.string(), z.strictObject({ name: z.string() })).optional(),
  tickets: z.strictObject({ url: z.string().regex(/\{id\}/) }).optional(),
  fields: z
    .strictObject({
      feature: z.record(z.string(), fieldDefinitionSchema).optional(),
      behaviour: z.record(z.string(), fieldDefinitionSchema).optional(),
    })
    .optional(),
  lint: z
    .strictObject({
      require_source: lintLevel.optional(),
      require_owner: lintLevel.optional(),
      max_behaviours_per_feature: z.number().int().min(1).optional(),
    })
    .optional(),
  // §14, consumed from v0.4; accepted now so configs written against the full spec stay valid.
  site: z.record(z.string(), z.unknown()).optional(),
})

export const categorySchema = z.strictObject({
  id: z.number().int().min(1),
  name: z.string().min(1).max(60),
  description: z.string(),
  owner: z.string().optional(),
  status: z.string().optional(),
  removed_reason: z.string().optional(),
  next_feature: counter.optional(),
})

const statusValue = z.union([z.string(), z.record(z.string(), z.string())])
const sinceValue = z.union([version, z.record(z.string(), version)])
const customFields = z.record(z.string(), z.unknown())

export const variantSchema = z.strictObject({
  platforms: z.array(z.string()).min(1),
  description: z.string(),
  mode: z.enum(['append', 'replace']).optional(),
  status: statusValue.optional(),
  since: sinceValue.optional(),
  source: z.array(z.string().min(1)).optional(),
  removed_reason: z.string().optional(),
})

export const behaviourSchema = z.strictObject({
  id: z.string(),
  name: z.string().min(1).max(80),
  description: z.string(),
  format: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  status: statusValue.optional(),
  since: sinceValue.optional(),
  source: z.array(z.string().min(1)).optional(),
  tags: z.array(tag).optional(),
  flag: z.string().optional(),
  fields: customFields.optional(),
  formerly: z.array(z.string()).optional(),
  removed_reason: z.string().optional(),
  variants: z.array(variantSchema).optional(),
})

export const changeSchema = z.strictObject({
  added: z.string().optional(),
  modified: z.string().optional(),
  removed: z.string().optional(),
  moved: z.strictObject({ from: z.string(), to: z.string() }).optional(),
  feature: z.enum(['added', 'modified', 'removed']).optional(),
  detail: z.string().optional(),
})

export const changelogEntrySchema = z.strictObject({
  date: z.string().regex(DATE_RE),
  summary: z.string().min(1),
  changes: z.array(changeSchema),
  version: version.optional(),
  platforms: z.array(z.string()).optional(),
  ticket: z.string().optional(),
  author: z.string().optional(),
})

export const linkSchema = z.strictObject({
  type: z.string(),
  title: z.string(),
  url: absoluteUrl,
})

export const featureSchema = z.strictObject({
  id: z.string(),
  name: z.string().min(1).max(60),
  description: z.string().max(280),
  owner: z.string(),
  status: statusValue,
  platforms: z.array(z.string()).optional(),
  since: sinceValue.optional(),
  tags: z.array(tag).optional(),
  depends_on: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  links: z.array(linkSchema).optional(),
  code: z.array(z.string().min(1)).optional(),
  assets: z.array(z.string().min(1)).optional(),
  fields: customFields.optional(),
  overview: z.string().optional(),
  formerly: z.array(z.string()).optional(),
  removed_reason: z.string().optional(),
  next_behaviour: counter.optional(),
  behaviours: z.array(behaviourSchema),
  changelog: z.array(changelogEntrySchema),
})

export type ConfigFile = z.infer<typeof configSchema>
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>
export type CategoryFile = z.infer<typeof categorySchema>
export type FeatureFile = z.infer<typeof featureSchema>
export type BehaviourEntry = z.infer<typeof behaviourSchema>
export type VariantEntry = z.infer<typeof variantSchema>
export type ChangelogEntryFile = z.infer<typeof changelogEntrySchema>
export type ChangeEntry = z.infer<typeof changeSchema>
export type StatusValue = z.infer<typeof statusValue>
export type SinceValue = z.infer<typeof sinceValue>

export const CHANGE_KINDS = ['added', 'modified', 'removed', 'moved', 'feature'] as const

export type FileKind = 'config' | 'category' | 'feature'

export const FILE_SCHEMAS = {
  config: configSchema,
  category: categorySchema,
  feature: featureSchema,
} as const

/** JSON Schema for editor validation (`yaml-language-server`). */
export function jsonSchema(kind: FileKind): Record<string, unknown> {
  return z.toJSONSchema(FILE_SCHEMAS[kind]) as Record<string, unknown>
}

/*
 * §11 `apply` patch. Each op is validated on its own (PATCH_OP_SCHEMAS) so errors name the op.
 * `ref`, `parent` and `to` take an ID or a `$name` set by an earlier op's `as`.
 */
const placeholder = z.string().regex(/^\$[A-Za-z_][A-Za-z0-9_-]*$/)

export const patchAddOpSchema = z.strictObject({
  op: z.literal('add'),
  level: z.enum(['category', 'feature', 'behaviour', 'variant']),
  parent: z.string().optional(),
  as: placeholder.optional(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  owner: z.string().optional(),
  platforms: z.array(z.string()).optional(),
  status: statusValue.optional(),
  since: sinceValue.optional(),
  format: z.string().optional(),
  source: z.array(z.string().min(1)).optional(),
  tags: z.array(tag).optional(),
  flag: z.string().optional(),
  mode: z.enum(['append', 'replace']).optional(),
})

/** `values` keys as for `almanac set`: `status`, `status.android`, `fields.team`; null unsets. */
export const patchSetOpSchema = z.strictObject({
  op: z.literal('set'),
  ref: z.string(),
  values: z.record(z.string(), z.unknown()).refine((values) => Object.keys(values).length > 0, 'needs at least one key'),
})

export const patchDescribeOpSchema = z
  .strictObject({
    op: z.literal('describe'),
    ref: z.string(),
    description: z.string().optional(),
    overview: z.string().optional(),
  })
  .refine((op) => (op.description === undefined) !== (op.overview === undefined), 'needs exactly one of description and overview')

export const patchRenameOpSchema = z.strictObject({
  op: z.literal('rename'),
  ref: z.string(),
  name: z.string().min(1),
})

export const patchRemoveOpSchema = z.strictObject({
  op: z.literal('remove'),
  ref: z.string(),
  reason: z.string().min(1),
})

export const patchMoveOpSchema = z.strictObject({
  op: z.literal('move'),
  ref: z.string(),
  to: z.string(),
})

export const PATCH_OP_SCHEMAS = {
  add: patchAddOpSchema,
  set: patchSetOpSchema,
  describe: patchDescribeOpSchema,
  rename: patchRenameOpSchema,
  remove: patchRemoveOpSchema,
  move: patchMoveOpSchema,
} as const

export const patchChangelogEntrySchema = z.strictObject({
  feature: z.string(),
  summary: z.string().min(1),
  changes: z.array(changeSchema).min(1),
  date: z.string().regex(DATE_RE).optional(),
  version: version.optional(),
  platforms: z.array(z.string()).optional(),
  ticket: z.string().optional(),
  author: z.string().optional(),
})

export const patchSchema = z.strictObject({
  almanac: z.literal(1),
  ticket: z.string().optional(),
  version: version.optional(),
  author: z.string().optional(),
  summary: z.string().min(1).optional(),
  ops: z.array(z.looseObject({ op: z.string() })).min(1),
  changelog: z.union([z.literal('auto'), z.literal('none'), z.array(patchChangelogEntrySchema)]).optional(),
})

export type Patch = z.infer<typeof patchSchema>
export type PatchAddOp = z.infer<typeof patchAddOpSchema>
export type PatchSetOp = z.infer<typeof patchSetOpSchema>
export type PatchDescribeOp = z.infer<typeof patchDescribeOpSchema>
export type PatchRenameOp = z.infer<typeof patchRenameOpSchema>
export type PatchRemoveOp = z.infer<typeof patchRemoveOpSchema>
export type PatchMoveOp = z.infer<typeof patchMoveOpSchema>
export type PatchOp = PatchAddOp | PatchSetOp | PatchDescribeOp | PatchRenameOp | PatchRemoveOp | PatchMoveOp
export type PatchChangelogEntry = z.infer<typeof patchChangelogEntrySchema>
