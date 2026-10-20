import { join } from 'node:path'
import { Document, Scalar, YAMLMap, YAMLSeq, isMap, isNode, isScalar, isSeq, visit, type Node } from 'yaml'
import {
  BEHAVIOUR_ID_RE,
  PLATFORM_TAG_RE,
  PREFIX_RE,
  isValidId,
  localNumber,
  parentId,
  parseRef,
  type FieldDefinition,
  type FileKind,
  type SinceValue,
  type StatusValue,
} from '@feature-almanac/schema'
import type { FileChange } from './changes.js'
import { isLive, type BehaviourHandle, type Compilation, type FeatureHandle } from './compile.js'
import { REMOVED, type ResolvedConfig } from './config.js'
import { formatDocument } from './format.js'
import type { FileSystem } from './fs.js'
import { categoryDirName, featureFileName } from './names.js'
import { expandPlatforms } from './platforms.js'
import { InvalidStateError, NotFoundError, UsageError, lookup, resolveId, type Redirect, type Target } from './query.js'
import { CONFIG_FILE, projectDir } from './root.js'
import { CATEGORY_FILE, type SourceFile } from './workspace.js'
import { parseYaml, schemaHeader, serialize } from './yaml.js'

export interface Mutation {
  changes: FileChange[]
  /** ID of the created or edited entity (a variant ref for variants; the new ID after a move). */
  id: string
  /** Absolute path of the file holding the entity afterwards. */
  file: string
  redirects: Redirect[]
  /** Changelog entries the edit records (written to the files unless `changelog: false`). */
  changelog?: ChangelogNote[]
}

/** One changelog entry; `apply` merges these into one entry per touched feature. */
export interface ChangelogNote {
  feature: string
  summary: string
  changes: Record<string, unknown>[]
}

const KNOWN_PLATFORM_NAMES: Record<string, string> = {
  ios: 'iOS',
  ipados: 'iPadOS',
  macos: 'macOS',
  watchos: 'watchOS',
  tvos: 'tvOS',
  visionos: 'visionOS',
  android: 'Android',
  web: 'Web',
  windows: 'Windows',
  linux: 'Linux',
}

export function isoDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// init

export interface InitInput {
  fs: FileSystem
  root: string
  product: string
  prefix?: string
  platforms: string[]
}

/** `almanac init`: almanac.yaml plus a `.gitignore` entry for the build output. */
export function planInit(input: InitInput): FileChange[] {
  if (input.prefix !== undefined && PREFIX_RE.test(input.prefix) === false) {
    throw new UsageError(`Prefix "${input.prefix}" must match ${PREFIX_RE.source}`)
  }
  if (input.platforms.length === 0) throw new UsageError('At least one platform is required (--platforms ios,android)')
  for (const platform of input.platforms) {
    if (PLATFORM_TAG_RE.test(platform) === false) throw new UsageError(`Platform tag "${platform}" must match ${PLATFORM_TAG_RE.source}`)
  }
  const configPath = join(input.root, CONFIG_FILE)
  if (input.fs.exists(configPath)) throw new InvalidStateError(`${configPath} already exists`)

  const product: Record<string, string> = { name: input.product }
  if (input.prefix !== undefined) product.prefix = input.prefix
  const platforms = Object.fromEntries(input.platforms.map((tag) => [tag, { name: KNOWN_PLATFORM_NAMES[tag] ?? capitalise(tag) }]))
  const doc = new Document({ almanac: 1, next_category: 1, product, platforms })
  const platformMap = doc.get('platforms', true)
  if (isMap(platformMap)) for (const pair of platformMap.items) if (isMap(pair.value)) pair.value.flow = true
  const changes: FileChange[] = [{ kind: 'write', path: configPath, content: finish(doc, 'config', true) }]

  const ignorePath = join(projectDir(input.root), '.gitignore')
  const existing = input.fs.readFile(ignorePath)
  const lines = (existing ?? '').split('\n').map((line) => line.trim())
  // Anchored, so only the project's own build output is ignored, not every `dist/` below it. An
  // existing pattern that already covers it (`dist/`, `/dist`, …) is left as it is.
  const covered = ['/dist/', '/dist', 'dist/', 'dist'].some((pattern) => lines.includes(pattern))
  if (covered === false) {
    const separator = existing === undefined || existing === '' || existing.endsWith('\n') ? '' : '\n'
    const change: FileChange = { kind: 'write', path: ignorePath, content: `${existing ?? ''}${separator}/dist/\n` }
    if (existing !== undefined) change.previous = existing
    changes.push(change)
  }
  return changes
}

// add category

export interface AddCategoryInput {
  name: string
  description: string
  owner?: string
}

export function addCategory(compilation: Compilation, input: AddCategoryInput): Mutation {
  const cfg = requireConfig(compilation)
  const configFile = compilation.workspace.config as SourceFile
  const number = nextNumber(compilation, cfg.data.next_category, undefined)
  const absDir = join(compilation.workspace.root, categoryDirName(number, input.name))
  if (compilation.workspace.fs.exists(absDir)) throw new InvalidStateError(`${absDir} already exists`)

  const category: Record<string, unknown> = { id: number, name: input.name, description: input.description }
  if (input.owner !== undefined) category.owner = input.owner
  category.next_feature = 1
  const file = join(absDir, CATEGORY_FILE)

  const configDoc = reparse(configFile)
  configDoc.set('next_category', number + 1)
  return {
    changes: [
      write(configFile, finish(configDoc, 'config')),
      { kind: 'write', path: file, content: finish(new Document(category), 'category', true) },
    ],
    id: String(number),
    file,
    redirects: [],
  }
}

// add feature

export interface AddFeatureInput {
  category: string
  name: string
  description: string
  owner: string
  platforms?: string[]
  status?: StatusValue
  since?: SinceValue
  tags?: string[]
  /** false: leave the changelog to the caller (apply writes one entry per feature). */
  changelog?: boolean
  now: Date
}

export function addFeature(compilation: Compilation, input: AddFeatureInput): Mutation {
  const cfg = requireConfig(compilation)
  const { id: categoryId } = resolveId(compilation, input.category, 'category')
  const category = compilation.categories.get(categoryId)
  if (category === undefined) throw new NotFoundError(`Category ${categoryId} not found`)
  if (category.model.status === 'removed') throw new InvalidStateError(`Category ${categoryId} is removed`)

  const number = nextNumber(compilation, category.data.next_feature, categoryId)
  const id = `${categoryId}.${number}`
  const file = join(category.dir.absDir, featureFileName(id, input.name))
  if (compilation.workspace.fs.exists(file)) throw new InvalidStateError(`${file} already exists`)

  const feature: Record<string, unknown> = {
    id,
    name: input.name,
    description: input.description,
    owner: input.owner,
    status: input.status ?? cfg.statuses[0],
  }
  if (input.platforms !== undefined) feature.platforms = input.platforms
  if (input.since !== undefined) feature.since = input.since
  if (input.tags !== undefined && input.tags.length > 0) feature.tags = input.tags
  feature.next_behaviour = 1
  feature.behaviours = []
  feature.changelog = input.changelog === false ? [] : [{ date: isoDate(input.now), summary: `Added ${input.name}.`, changes: [{ feature: 'added' }] }]
  const doc = new Document(feature)
  flowScalarLists(doc.contents)

  const categoryDoc = reparse(category.file)
  categoryDoc.set('next_feature', number + 1)
  return {
    changes: [write(category.file, finish(categoryDoc, 'category')), { kind: 'write', path: file, content: finish(doc, 'feature', true) }],
    id,
    file,
    redirects: [],
  }
}

// add behaviour

export interface AddBehaviourInput {
  feature: string
  name: string
  description: string
  platforms?: string[]
  format?: string
  source?: string[]
  status?: StatusValue
  since?: SinceValue
  tags?: string[]
  flag?: string
  changelog?: boolean
  now: Date
}

export function addBehaviour(compilation: Compilation, input: AddBehaviourInput): Mutation {
  requireConfig(compilation)
  const { id: featureId, redirects } = resolveId(compilation, input.feature, 'feature')
  const feature = compilation.features.get(featureId)
  if (feature === undefined) throw new NotFoundError(`Feature ${featureId} not found`)
  if (feature.model.platforms.every((platform) => feature.model.status[platform] === 'removed')) {
    throw new InvalidStateError(`Feature ${featureId} is removed`)
  }

  const number = nextNumber(compilation, feature.data.next_behaviour, featureId)
  const id = `${featureId}.${number}`
  const behaviour: Record<string, unknown> = { id, name: input.name, description: input.description }
  if (input.format !== undefined) behaviour.format = input.format
  if (input.platforms !== undefined) behaviour.platforms = input.platforms
  if (input.status !== undefined) behaviour.status = input.status
  if (input.since !== undefined) behaviour.since = input.since
  if (input.source !== undefined && input.source.length > 0) behaviour.source = input.source
  if (input.tags !== undefined && input.tags.length > 0) behaviour.tags = input.tags
  if (input.flag !== undefined) behaviour.flag = input.flag

  const doc = reparse(feature.file)
  const node = doc.createNode(behaviour)
  flowScalarLists(node)
  ensureSeq(doc.contents as YAMLMap, 'behaviours').add(node)
  if (input.changelog !== false) prependChangelog(doc, { date: isoDate(input.now), summary: `Added ${input.name}.`, changes: [{ added: id }] })
  doc.set('next_behaviour', number + 1)
  return { changes: [write(feature.file, finish(doc, 'feature'))], id, file: feature.file.absPath, redirects }
}

// add variant

export interface AddVariantInput {
  behaviour: string
  platforms: string[]
  mode?: 'append' | 'replace'
  description: string
  status?: StatusValue
  since?: SinceValue
  source?: string[]
  changelog?: boolean
  now: Date
}

export function addVariant(compilation: Compilation, input: AddVariantInput): Mutation {
  const cfg = requireConfig(compilation)
  const { id: behaviourId, redirects } = resolveId(compilation, input.behaviour, 'behaviour')
  const behaviour = compilation.behaviours.get(behaviourId)
  if (behaviour === undefined) throw new NotFoundError(`Behaviour ${behaviourId} not found`)

  // The ref names the variant by its first platform in config order (§7).
  const platforms = expandPlatforms(input.platforms, cfg.platforms, cfg, false).platforms
  const first = platforms[0]
  if (first === undefined) throw new UsageError(`No known platform in ${input.platforms.join(', ')}`)
  const ref = `${behaviourId}@${first}`

  const variant: Record<string, unknown> = { platforms: input.platforms, description: input.description }
  if (input.mode !== undefined) variant.mode = input.mode
  if (input.status !== undefined) variant.status = input.status
  if (input.since !== undefined) variant.since = input.since
  if (input.source !== undefined && input.source.length > 0) variant.source = input.source

  const doc = reparse(behaviour.feature.file)
  const target = behaviourNode(doc, behaviourId)
  const node = doc.createNode(variant)
  flowScalarLists(node)
  ensureSeq(target, 'variants').add(node)
  const names = platforms.map((platform) => cfg.platformNames[platform] ?? platform).join(', ')
  if (input.changelog !== false) {
    prependChangelog(doc, {
      date: isoDate(input.now),
      summary: `Added ${names} variant of ${behaviour.model.name}.`,
      changes: [{ added: ref }],
    })
  }
  return { changes: [write(behaviour.feature.file, finish(doc, 'feature'))], id: ref, file: behaviour.feature.file.absPath, redirects }
}

// next-id

/** The ID `add` would allocate next: a category with no parent, a feature under a category, a behaviour under a feature. */
export function nextId(compilation: Compilation, parent?: string): { id: string; redirects: Redirect[] } {
  const cfg = requireConfig(compilation)
  if (parent === undefined) return { id: String(nextNumber(compilation, cfg.data.next_category, undefined)), redirects: [] }
  const { target, redirects } = lookup(compilation, parent)
  if (target.kind === 'category') {
    const id = target.category.model.id
    return { id: `${id}.${nextNumber(compilation, target.category.data.next_feature, id)}`, redirects }
  }
  if (target.kind === 'feature') {
    const id = target.feature.model.id
    return { id: `${id}.${nextNumber(compilation, target.feature.data.next_behaviour, id)}`, redirects }
  }
  throw new UsageError(`${parent} is a ${target.kind}; only categories and features have child IDs (variants are named by platform)`)
}

// Edits: set, describe, rename, remove, mv

export interface EditOptions {
  /** Changelog summary instead of the generated one. */
  summary?: string
  /** false: leave the changelog to the caller (apply writes one entry per feature). */
  changelog?: boolean
  now: Date
}

type Level = Target['kind']

/** An entity's node in a freshly parsed copy of its file. */
interface Located {
  level: Level
  target: Target
  redirects: Redirect[]
  file: SourceFile
  doc: Document.Parsed
  node: YAMLMap
  /** A variant's ID is its ref, named by its first platform. */
  id: string
  label: string
  /** The feature whose changelog records the edit; categories have no changelog. */
  feature?: FeatureHandle
}

function locate(compilation: Compilation, ref: string): Located {
  const cfg = requireConfig(compilation)
  const { target, redirects } = lookup(compilation, ref)
  if (target.kind === 'category') {
    const { file, model } = target.category
    const doc = reparse(file)
    return { level: 'category', target, redirects, file, doc, node: doc.contents as YAMLMap, id: model.id, label: model.name }
  }
  if (target.kind === 'feature') {
    const feature = target.feature
    const doc = reparse(feature.file)
    return { level: 'feature', target, redirects, file: feature.file, doc, node: doc.contents as YAMLMap, id: feature.model.id, label: feature.model.name, feature }
  }
  const behaviour = target.behaviour
  const doc = reparse(behaviour.feature.file)
  const node = behaviourNode(doc, behaviour.model.id)
  const located = { target, redirects, file: behaviour.feature.file, doc, feature: behaviour.feature }
  if (target.kind === 'behaviour') return { ...located, level: 'behaviour', node, id: behaviour.model.id, label: behaviour.model.name }
  const variants = node.get('variants', true)
  const variant = isSeq(variants) ? variants.items[target.index] : undefined
  if (isMap(variant) === false) throw new InvalidStateError(`Variant ${target.variant.ref} is not in its feature file`)
  const names = target.variant.platforms.map((platform) => cfg.platformNames[platform] ?? platform).join(', ')
  return { ...located, level: 'variant', node: variant, id: target.variant.ref, label: `${behaviour.model.name} (${names})` }
}

/** The change a changelog entry records for an edit of this entity. */
function changeOf(located: Located, action: 'modified' | 'removed'): Record<string, unknown> {
  return located.level === 'feature' ? { feature: action } : { [action]: located.id }
}

/** Records a changelog entry, and writes it into `doc` unless the caller writes the changelog. */
function note(notes: ChangelogNote[], doc: Document, feature: string, summary: string, changes: Record<string, unknown>[], input: EditOptions): void {
  const entry = { feature, summary: input.summary ?? summary, changes }
  notes.push(entry)
  if (input.changelog !== false) prependChangelog(doc, { date: isoDate(input.now), summary: entry.summary, changes })
}

/** Finishes an edit confined to the entity's own file. */
function edited(located: Located, summary: string, change: Record<string, unknown>, input: EditOptions): Mutation {
  const notes: ChangelogNote[] = []
  if (located.feature !== undefined) note(notes, located.doc, located.feature.model.id, summary, [change], input)
  return {
    changes: [write(located.file, finish(located.doc, located.file.kind))],
    id: located.id,
    file: located.file.absPath,
    redirects: located.redirects,
    changelog: notes,
  }
}

// set

export interface SetInput extends EditOptions {
  ref: string
  /**
   * Keys as in the files, plus `status.<platform>`, `since.<platform>` and `fields.<key>`. null or
   * "" unsets. Strings are typed by key: lists split on commas, `fields.<key>` follows its
   * definition, and `links`, `fields` and `{…}` maps are JSON.
   */
  values: Record<string, unknown>
}

const SETTABLE: Record<Level, readonly string[]> = {
  category: ['owner'],
  feature: ['owner', 'status', 'platforms', 'since', 'tags', 'depends_on', 'related', 'links', 'code', 'assets', 'fields', 'removed_reason'],
  behaviour: ['format', 'platforms', 'status', 'since', 'source', 'tags', 'flag', 'fields', 'removed_reason'],
  variant: ['platforms', 'mode', 'status', 'since', 'source', 'removed_reason'],
}

const MANAGED: Record<string, string> = {
  id: 'IDs never change; almanac mv re-IDs under a new parent',
  formerly: 'almanac mv records former IDs',
  next_category: 'ID counters are managed by almanac',
  next_feature: 'ID counters are managed by almanac',
  next_behaviour: 'ID counters are managed by almanac',
  name: 'use almanac rename',
  description: 'use almanac describe',
  overview: 'use almanac describe --overview',
  behaviours: 'use almanac add behaviour',
  variants: 'use almanac add variant',
  changelog: 'use almanac changelog add',
}

const LIST_KEYS = new Set(['platforms', 'tags', 'depends_on', 'related', 'code', 'assets', 'source'])
const PLATFORM_MAP_KEYS = new Set(['status', 'since'])

/** Splits `key=value` arguments; values stay strings for `setValues` to type. */
export function parseAssignments(args: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {}
  for (const arg of args) {
    const eq = arg.indexOf('=')
    if (eq <= 0) throw new UsageError(`"${arg}" is not key=value`)
    const key = arg.slice(0, eq).trim()
    if (Object.hasOwn(values, key)) throw new UsageError(`${key} is given twice`)
    values[key] = arg.slice(eq + 1)
  }
  if (Object.keys(values).length === 0) throw new UsageError('Nothing to set: give at least one key=value')
  return values
}

export function setValues(compilation: Compilation, input: SetInput): Mutation {
  const cfg = requireConfig(compilation)
  const located = locate(compilation, input.ref)
  const { doc, node, level } = located
  const definitions = level === 'feature' ? cfg.fields.feature : level === 'behaviour' ? cfg.fields.behaviour : {}
  const entries = Object.entries(input.values).map(([key, raw]) => {
    const [head, sub] = splitKey(key)
    checkKey(level, key, head, sub)
    const value = typed(definitions, key, head, sub, raw)
    checkValue(key, head, sub, value)
    if (head === 'status' && sub === undefined && value === REMOVED) {
      throw new UsageError(`To remove ${located.id}, use almanac remove ${located.id} --reason <why>`)
    }
    if (located.target.kind === 'behaviour' && sub !== undefined && PLATFORM_MAP_KEYS.has(head)) checkVariantOverride(located.target.behaviour, key, head, sub)
    return { key, head, sub, value }
  })
  if (entries.length === 0) throw new UsageError('Nothing to set: give at least one key=value')
  const before = JSON.stringify(node.toJSON())

  // Platforms first: `status.<platform>` expands over the platforms the entity is about to have.
  let platforms = currentPlatforms(located)
  for (const { value } of entries.filter((entry) => entry.head === 'platforms')) {
    const base = platformBase(cfg, located)
    platforms = value === null ? (level === 'variant' ? [] : base) : expandPlatforms(value as string[], base, cfg, level !== 'variant').platforms
  }
  entries.sort((a, b) => Number(b.head === 'platforms') - Number(a.head === 'platforms'))
  for (const { head, sub, value } of entries) {
    if (sub === undefined) {
      setKey(doc, node, head, value)
    } else if (head === 'fields') {
      const fields: unknown = node.get('fields', true)
      const map = isMap(fields) ? fields : new YAMLMap()
      setKey(doc, map, sub, value)
      if (map.items.length === 0) node.delete('fields')
      else if (isMap(fields) === false) node.set('fields', map)
    } else {
      if (cfg.platforms.includes(sub) === false) throw new UsageError(`Unknown platform "${sub}" in ${head}.${sub}`)
      setKey(doc, node, head, withPlatform(plainOf(node.get(head, true)), sub, value as string | null, platforms))
    }
  }
  if (JSON.stringify(node.toJSON()) === before) throw new InvalidStateError(`Nothing to change: ${located.id} already has these values`)

  if (level === 'variant' && platforms[0] !== undefined) {
    located.id = `${(located.target as Extract<Target, { kind: 'variant' }>).behaviour.model.id}@${platforms[0]}`
  }
  const parts = entries.map(({ key, value }) => describeAssignment(key, value))
  return edited(located, `Set ${parts.join('; ')} on ${located.label}.`, changeOf(located, 'modified'), input)
}

/** A variant's own status or since wins on its platforms, so setting the behaviour's would change nothing there. */
function checkVariantOverride(behaviour: BehaviourHandle, key: string, head: string, platform: string): void {
  const index = behaviour.model.variants.findIndex((variant) => variant.platforms.includes(platform))
  const own = index === -1 ? undefined : behaviour.data.variants?.[index]?.[head as 'status' | 'since']
  if (own === undefined || (typeof own !== 'string' && Object.hasOwn(own, platform) === false)) return
  const ref = behaviour.model.variants[index]?.ref
  throw new UsageError(`Variant ${ref} sets its own ${head} on ${platform}, which overrides the behaviour's; use almanac set ${ref} ${key}=…`)
}

function splitKey(key: string): [string, string | undefined] {
  const dot = key.indexOf('.')
  return dot === -1 ? [key, undefined] : [key.slice(0, dot), key.slice(dot + 1)]
}

function checkKey(level: Level, key: string, head: string, sub: string | undefined): void {
  const managed = MANAGED[head]
  if (managed !== undefined) throw new UsageError(`${key} cannot be set: ${managed}`)
  if (SETTABLE[level].includes(head) === false) throw new UsageError(`${key} is not settable on a ${level}; settable: ${SETTABLE[level].join(', ')}`)
  if (sub !== undefined && (sub === '' || (head !== 'fields' && PLATFORM_MAP_KEYS.has(head) === false))) {
    throw new UsageError(`${key}: only status.<platform>, since.<platform> and fields.<key> take a suffix`)
  }
}

function typed(definitions: Record<string, FieldDefinition>, key: string, head: string, sub: string | undefined, value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (text === '') return null
  if (head === 'fields' && sub !== undefined) {
    switch (definitions[sub]?.type) {
      case 'number': {
        const number = Number(text)
        if (Number.isFinite(number) === false) throw new UsageError(`${key} must be a number`)
        return number
      }
      case 'bool':
        if (text !== 'true' && text !== 'false') throw new UsageError(`${key} must be true or false`)
        return text === 'true'
      case 'list':
        return splitList(text)
      default:
        return text
    }
  }
  if (sub !== undefined) return text
  if (LIST_KEYS.has(head)) return text.startsWith('[') ? json(key, text) : splitList(text)
  if (head === 'links' || head === 'fields' || (PLATFORM_MAP_KEYS.has(head) && text.startsWith('{'))) return json(key, text)
  return head === 'removed_reason' ? value : text
}

function checkValue(key: string, head: string, sub: string | undefined, value: unknown): void {
  if (value === null || (head === 'fields' && sub !== undefined)) return
  const fail = (what: string) => {
    throw new UsageError(`${key} must be ${what}`)
  }
  const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string')
  const record = (map: unknown): map is Record<string, unknown> => map !== null && typeof map === 'object' && Array.isArray(map) === false
  if (head === 'fields') {
    if (record(value) === false) fail('a mapping')
  } else if (sub !== undefined) {
    if (typeof value !== 'string') fail('a string')
  } else if (LIST_KEYS.has(head)) {
    if (strings(value) === false) fail('a list of strings')
  } else if (head === 'links') {
    if (Array.isArray(value) === false) fail('a list of { type, title, url }')
  } else if (PLATFORM_MAP_KEYS.has(head)) {
    if (typeof value !== 'string' && (record(value) === false || strings(Object.values(value)) === false)) fail('a string or a platform map')
  } else if (typeof value !== 'string') {
    fail('a string')
  }
}

function currentPlatforms(located: Located): string[] {
  const target = located.target
  switch (target.kind) {
    case 'category':
      return []
    case 'feature':
      return target.feature.model.platforms
    case 'behaviour':
      return target.behaviour.model.platforms
    case 'variant':
      return target.variant.platforms
  }
}

/** The platforms an entity's `platforms` list is expanded against. */
function platformBase(cfg: ResolvedConfig, located: Located): string[] {
  const target = located.target
  if (target.kind === 'behaviour') return target.behaviour.feature.model.platforms
  if (target.kind === 'variant') return target.behaviour.model.platforms
  return cfg.platforms
}

/**
 * Sets one platform in a status or since value. A plain value is first spread over `platforms`;
 * a map that ends up the same on every platform collapses back to a plain value.
 */
function withPlatform(current: unknown, platform: string, value: string | null, platforms: readonly string[]): unknown {
  const map: Record<string, string> = {}
  if (typeof current === 'string') for (const p of platforms) map[p] = current
  else if (current !== null && typeof current === 'object') Object.assign(map, current)
  if (value === null) delete map[platform]
  else map[platform] = value
  const keys = Object.keys(map)
  if (keys.length === 0) return null
  const first = map[keys[0] as string]
  const uniform = keys.length === platforms.length && platforms.every((p) => map[p] === first)
  if (uniform) return first
  const ordered: Record<string, string> = {}
  for (const key of [...platforms.filter((p) => p in map), ...keys.filter((key) => platforms.includes(key) === false)]) ordered[key] = map[key] as string
  return ordered
}

function describeAssignment(key: string, value: unknown): string {
  if (value === null) return `${key} → none`
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return `${key} → ${value}`
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return `${key} → ${value.join(', ')}`
  return `${key} updated`
}

function setKey(doc: Document, map: YAMLMap, key: string, value: unknown): void {
  if (value === null || value === undefined) {
    map.delete(key)
    return
  }
  const node = doc.createNode(value)
  flowScalarLists(node)
  map.set(key, node)
}

function plainOf(node: unknown): unknown {
  return isNode(node) ? node.toJSON() : node
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function json(key: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new UsageError(`${key} must be JSON here, got ${text}`)
  }
}

// describe

export interface DescribeInput extends EditOptions {
  ref: string
  /** Exactly one of description and overview (features only). */
  description?: string
  overview?: string
}

export function describeEntity(compilation: Compilation, input: DescribeInput): Mutation {
  if ((input.description === undefined) === (input.overview === undefined)) throw new UsageError('Give exactly one of a description and an overview')
  const located = locate(compilation, input.ref)
  const key = input.overview !== undefined ? 'overview' : 'description'
  const text = (input.overview ?? input.description) as string
  if (key === 'overview' && located.level !== 'feature') throw new UsageError(`Only features have an overview; ${located.id} is a ${located.level}`)
  const current = plainOf(located.node.get(key, true))
  if (typeof current === 'string' && current.trimEnd() === text.trimEnd()) {
    throw new InvalidStateError(`Nothing to change: ${located.id} already has this ${key}`)
  }
  setKey(located.doc, located.node, key, text)
  return edited(located, `Updated the ${key} of ${located.label}.`, changeOf(located, 'modified'), input)
}

// review

export interface ReviewInput {
  ref: string
  state: 'approved' | 'rejected'
  by: string
  /** The hash of the text the reviewer judged. */
  hash: string
  /** When they decided; today when not given. */
  date?: string
  note?: string
  now: Date
}

/** The behaviour's text changed after the reviewer judged it, so the verdict can't be recorded. */
export class StaleReviewError extends InvalidStateError {}

/** Records a reviewer's verdict, replacing any earlier one. It changes no behaviour, so it writes no changelog entry. */
export function reviewBehaviour(compilation: Compilation, input: ReviewInput): Mutation {
  const located = locate(compilation, input.ref)
  if (located.target.kind !== 'behaviour') throw new UsageError(`Only behaviours are reviewed; ${located.id} is a ${located.level}`)
  const behaviour = located.target.behaviour.model
  if (behaviour.hash !== input.hash) throw new StaleReviewError(`${behaviour.ref} changed after it was reviewed; review it again`)
  const note = input.note?.trim() ?? ''
  if (input.state === 'rejected' && note === '') throw new UsageError(`Rejecting ${behaviour.ref} needs a note saying why`)
  const by = input.by.trim()
  if (by === '') throw new UsageError('A review needs the name of the person who made it')
  setKey(located.doc, located.node, 'review', { state: input.state, by, date: input.date ?? isoDate(input.now), ...(note === '' ? {} : { note }), hash: input.hash })
  return { changes: [write(located.file, finish(located.doc, located.file.kind))], id: located.id, file: located.file.absPath, redirects: located.redirects, changelog: [] }
}

// rename

export interface RenameInput extends EditOptions {
  ref: string
  name: string
}

/** Renames an entity; a category's folder and a feature's file follow the new name (§2). */
export function renameEntity(compilation: Compilation, input: RenameInput): Mutation {
  const located = locate(compilation, input.ref)
  const target = located.target
  if (target.kind === 'variant') throw new UsageError(`Variants have no name; rename behaviour ${target.behaviour.model.id} instead`)
  const name = input.name.trim()
  if (name === '') throw new UsageError('A name is required (--name)')
  const old = located.label
  if (old === name) throw new InvalidStateError(`Nothing to change: ${located.id} is already named ${name}`)
  located.node.set('name', name)

  if (target.kind === 'category') {
    const dir = target.category.dir
    const to = join(compilation.workspace.root, categoryDirName(target.category.data.id, name))
    const changes: FileChange[] = [write(located.file, finish(located.doc, 'category'))]
    if (to !== dir.absDir) {
      if (compilation.workspace.fs.exists(to)) throw new InvalidStateError(`${to} already exists`)
      changes.push({ kind: 'rename', from: dir.absDir, to })
    }
    return { changes, id: located.id, file: join(to, CATEGORY_FILE), redirects: located.redirects, changelog: [] }
  }
  const summary = `Renamed ${old} to ${name}.`
  if (target.kind === 'behaviour') return edited(located, summary, changeOf(located, 'modified'), input)

  const notes: ChangelogNote[] = []
  note(notes, located.doc, located.id, summary, [changeOf(located, 'modified')], input)
  const path = join(target.feature.category.dir.absDir, featureFileName(located.id, name))
  return {
    changes: moveFile(compilation, located.file, path, finish(located.doc, 'feature')),
    id: located.id,
    file: path,
    redirects: located.redirects,
    changelog: notes,
  }
}

// remove

export interface RemoveInput extends EditOptions {
  ref: string
  reason: string
}

/** Tombstones an entity: `status: removed` plus `removed_reason`. Nothing is deleted (§3). */
export function removeEntity(compilation: Compilation, input: RemoveInput): Mutation {
  const located = locate(compilation, input.ref)
  const target = located.target
  const reason = input.reason.trim()
  if (reason === '') throw new UsageError('A reason is required (--reason)')
  if (isRemoved(target)) throw new InvalidStateError(`${located.id} is already removed`)
  if (target.kind === 'category') {
    const live = [...compilation.features.values()].filter((feature) => feature.category === target.category && isLive(feature.model.status))
    if (live.length > 0) {
      throw new InvalidStateError(`Category ${located.id} still has live features (${live.map((feature) => feature.model.id).join(', ')}); remove or move them first`)
    }
  }
  located.node.set('status', REMOVED)
  located.node.set('removed_reason', reason)
  if (target.kind === 'category') {
    return { changes: [write(located.file, finish(located.doc, 'category'))], id: located.id, file: located.file.absPath, redirects: located.redirects, changelog: [] }
  }
  return edited(located, `Removed ${located.label}.`, { ...changeOf(located, 'removed'), detail: reason }, input)
}

function isRemoved(target: Target): boolean {
  switch (target.kind) {
    case 'category':
      return target.category.model.status === 'removed'
    case 'feature':
      return target.feature.model.platforms.every((platform) => target.feature.model.status[platform] === REMOVED)
    case 'behaviour':
      return isLive(target.behaviour.model.status) === false
    case 'variant':
      return target.variant.platforms.every((platform) => target.behaviour.model.status[platform] === REMOVED)
  }
}

// mv

export interface MoveInput extends EditOptions {
  ref: string
  /** The new parent: a category for a feature, a feature for a behaviour. */
  to: string
}

/**
 * Re-IDs a feature under another category, or a behaviour under another feature, recording the
 * old ID in `formerly` (§3). A feature's behaviours are re-IDed with it, and `depends_on` and
 * `related` elsewhere follow it. Categories never move; variants move with their behaviour.
 */
export function moveEntity(compilation: Compilation, input: MoveInput): Mutation {
  requireConfig(compilation)
  const { target, redirects } = lookup(compilation, input.ref)
  if (target.kind === 'category') throw new UsageError('Categories never move; move their features instead')
  if (target.kind === 'variant') throw new UsageError(`Variants move with their behaviour; move ${target.behaviour.model.id} instead`)
  return target.kind === 'feature' ? moveFeature(compilation, target.feature, input, redirects) : moveBehaviour(compilation, target.behaviour, input, redirects)
}

function moveFeature(compilation: Compilation, feature: FeatureHandle, input: MoveInput, redirects: Redirect[]): Mutation {
  const resolved = resolveId(compilation, input.to, 'category')
  const category = compilation.categories.get(resolved.id)
  if (category === undefined) throw new NotFoundError(`Category ${resolved.id} not found`)
  if (category.model.status === 'removed') throw new InvalidStateError(`Category ${resolved.id} is removed`)
  const from = feature.model.id
  if (category === feature.category) throw new InvalidStateError(`Feature ${from} is already in category ${resolved.id}`)

  const number = nextNumber(compilation, category.data.next_feature, resolved.id)
  const id = `${resolved.id}.${number}`
  const doc = reparse(feature.file)
  const root = doc.contents as YAMLMap
  reId(root, from, id)
  const behaviours = root.get('behaviours', true)
  if (isSeq(behaviours)) {
    for (const item of behaviours.items) {
      if (isMap(item) === false) continue
      const old = String(item.get('id'))
      if (BEHAVIOUR_ID_RE.test(old) === false) throw new InvalidStateError(`Behaviour ID "${old}" in ${feature.file.path} is malformed; fix it before moving ${from}`)
      reId(item, old, `${id}.${localNumber(old)}`)
    }
  }
  const notes: ChangelogNote[] = []
  const summary = `Moved ${feature.model.name} from ${feature.category.model.name} to ${category.model.name}.`
  note(notes, doc, id, summary, [{ moved: { from, to: id } }], input)

  const categoryDoc = reparse(category.file)
  categoryDoc.set('next_feature', number + 1)
  const path = join(category.dir.absDir, featureFileName(id, feature.model.name))
  return {
    changes: [
      write(category.file, finish(categoryDoc, 'category')),
      ...moveFile(compilation, feature.file, path, finish(doc, 'feature')),
      ...followFeature(compilation, feature, id),
    ],
    id,
    file: path,
    redirects: [...redirects, ...resolved.redirects],
    changelog: notes,
  }
}

function moveBehaviour(compilation: Compilation, behaviour: BehaviourHandle, input: MoveInput, redirects: Redirect[]): Mutation {
  const resolved = resolveId(compilation, input.to, 'feature')
  const target = compilation.features.get(resolved.id)
  if (target === undefined) throw new NotFoundError(`Feature ${resolved.id} not found`)
  if (target.model.platforms.every((platform) => target.model.status[platform] === REMOVED)) throw new InvalidStateError(`Feature ${resolved.id} is removed`)
  const source = behaviour.feature
  const from = behaviour.model.id
  if (target === source) throw new InvalidStateError(`Behaviour ${from} is already in feature ${resolved.id}`)

  const number = nextNumber(compilation, target.data.next_behaviour, resolved.id)
  const id = `${resolved.id}.${number}`
  const sourceDoc = reparse(source.file)
  const node = behaviourNode(sourceDoc, from)
  const list = sourceDoc.get('behaviours', true) as YAMLSeq
  list.items.splice(list.items.indexOf(node), 1)
  reId(node, from, id)
  const targetDoc = reparse(target.file)
  ensureSeq(targetDoc.contents as YAMLMap, 'behaviours').add(node)
  targetDoc.set('next_behaviour', number + 1)

  // Both features record the move: the source's history says where it went, the destination's
  // (which `show --with-changelog` reads for the new ID) where it came from.
  const notes: ChangelogNote[] = []
  const name = behaviour.model.name
  note(notes, sourceDoc, source.model.id, `Moved ${name} to ${target.model.name}.`, [{ moved: { from, to: id } }], input)
  note(notes, targetDoc, target.model.id, `Moved ${name} from ${source.model.name}.`, [{ moved: { from, to: id } }], input)
  return {
    changes: [write(source.file, finish(sourceDoc, 'feature')), write(target.file, finish(targetDoc, 'feature'))],
    id,
    file: target.file.absPath,
    redirects: [...redirects, ...resolved.redirects],
    changelog: notes,
  }
}

function reId(map: YAMLMap, from: string, to: string): void {
  map.set('id', new Scalar(to))
  const formerly = ensureSeq(map, 'formerly')
  if (formerly.items.length === 0) formerly.flow = true
  formerly.add(new Scalar(from))
}

/** `depends_on` and `related` in other features follow a moved feature to its new ID. */
function followFeature(compilation: Compilation, moved: FeatureHandle, to: string): FileChange[] {
  const from = moved.model.id
  const changes: FileChange[] = []
  for (const feature of compilation.features.values()) {
    if (feature === moved) continue
    const doc = reparse(feature.file)
    let changed = false
    for (const key of ['depends_on', 'related']) {
      const list = doc.get(key, true)
      if (isSeq(list) === false) continue
      list.items.forEach((item, index) => {
        const ref = String(plainOf(item))
        if ((compilation.formerly.get(ref) ?? ref) !== from) return
        list.items[index] = new Scalar(to)
        changed = true
      })
    }
    if (changed) changes.push(write(feature.file, finish(doc, 'feature')))
  }
  return changes
}

/** Renames the file to `to` (when the path changes) and writes `content` there. */
function moveFile(compilation: Compilation, file: SourceFile, to: string, content: string): FileChange[] {
  if (to === file.absPath) return [write(file, content)]
  if (compilation.workspace.fs.exists(to)) throw new InvalidStateError(`${to} already exists`)
  return [
    { kind: 'rename', from: file.absPath, to },
    { kind: 'write', path: to, content, previous: file.text },
  ]
}

// changelog add

export interface ChangelogInput {
  feature: string
  summary: string
  changes: Record<string, unknown>[]
  version?: string
  ticket?: string
  author?: string
  platforms?: string[]
  now: Date
}

/** `almanac changelog add`: prepends one entry to a feature's changelog. */
export function addChangelogEntry(compilation: Compilation, input: ChangelogInput): Mutation {
  requireConfig(compilation)
  const { id, redirects } = resolveId(compilation, input.feature, 'feature')
  const feature = compilation.features.get(id)
  if (feature === undefined) throw new NotFoundError(`Feature ${id} not found`)
  if (input.summary.trim() === '') throw new UsageError('A summary is required (--summary)')
  if (input.changes.length === 0) throw new UsageError('At least one change is required (--change modified:N.M.K)')
  const entry: Record<string, unknown> = { date: isoDate(input.now), summary: input.summary, changes: input.changes }
  if (input.version !== undefined) entry.version = input.version
  if (input.platforms !== undefined && input.platforms.length > 0) entry.platforms = input.platforms
  if (input.ticket !== undefined) entry.ticket = input.ticket
  if (input.author !== undefined) entry.author = input.author
  const doc = reparse(feature.file)
  prependChangelog(doc, entry)
  return { changes: [write(feature.file, finish(doc, 'feature'))], id, file: feature.file.absPath, redirects }
}

/** `--change` values: `added:1.2.3`, `modified:1.2.3@android`, `removed:…`, `moved:1.1.2:2.3.4`, `feature:modified`. */
export function parseChange(compilation: Compilation, text: string): Record<string, unknown> {
  const [kind = '', ...refs] = text.split(':').map((part) => part.trim())
  const usage = () => new UsageError(`"${text}" is not kind:ref (added, modified, removed), moved:from:to or feature:added|modified|removed`)
  if (kind === 'feature') {
    const action = refs[0]
    if (refs.length !== 1 || (action !== 'added' && action !== 'modified' && action !== 'removed')) throw usage()
    return { feature: action }
  }
  if (kind === 'moved') {
    if (refs.length !== 2) throw usage()
    return { moved: { from: plainRef(compilation, refs[0] as string), to: plainRef(compilation, refs[1] as string) } }
  }
  if ((kind === 'added' || kind === 'modified' || kind === 'removed') && refs.length === 1) return { [kind]: plainRef(compilation, refs[0] as string) }
  throw usage()
}

/** A reference as changelogs write it: this product's prefix dropped. */
function plainRef(compilation: Compilation, ref: string): string {
  const parsed = parseRef(ref)
  if (parsed === undefined) throw new UsageError(`"${ref}" is not a valid reference`)
  if (parsed.prefix !== undefined && parsed.prefix !== compilation.config?.product.prefix) {
    throw new NotFoundError(`${ref} belongs to another product (prefix ${parsed.prefix})`)
  }
  return parsed.platform === undefined ? parsed.id : `${parsed.id}@${parsed.platform}`
}

/** Prepends one changelog entry to a feature file's text and returns the formatted result. */
export function withChangelogEntry(text: string, entry: Record<string, unknown>): string {
  const doc = parseYaml(text).doc
  prependChangelog(doc, entry)
  return finish(doc, 'feature')
}

// helpers

function requireConfig(compilation: Compilation): ResolvedConfig {
  if (compilation.config === undefined || compilation.workspace.config === undefined) {
    throw new InvalidStateError('almanac.yaml is missing or invalid; fix it before writing')
  }
  return compilation.config
}

/** Allocates from the parent's counter, never below the highest number on record plus one. */
function nextNumber(compilation: Compilation, counter: number | undefined, parent: string | undefined): number {
  return Math.max(counter ?? 0, maxUsed(compilation, parent) + 1)
}

/**
 * Highest local number on record under `parent` (live, tombstoned, former or unparseable). A used
 * ID also uses its ancestors' numbers: `3.5.2` on record means `3.5` is never allocated again.
 */
function maxUsed(compilation: Compilation, parent: string | undefined): number {
  let max = 0
  for (const id of compilation.usedIds) {
    if (isValidId(id) === false) continue
    for (let current: string | undefined = id; current !== undefined; current = parentId(current)) {
      if (parentId(current) === parent) max = Math.max(max, localNumber(current))
    }
  }
  return max
}

function reparse(file: SourceFile): Document.Parsed {
  return parseYaml(file.text).doc
}

function write(file: SourceFile, content: string): FileChange {
  return { kind: 'write', path: file.absPath, content, previous: file.text }
}

/** Formats and serialises; files the CLI creates also get the editor-validation header (§9). */
function finish(doc: Document, kind: FileKind, created = false): string {
  formatDocument(doc, kind)
  const root = doc.contents
  if (created && isMap(root)) {
    const first = root.items[0]
    if (first !== undefined && isScalar(first.key) && (first.key.commentBefore ?? '') === '') {
      first.key.commentBefore = schemaHeader(kind)
    }
  }
  return serialize(doc)
}

function ensureSeq(map: YAMLMap, key: string): YAMLSeq {
  const existing = map.get(key, true)
  if (isSeq(existing)) return existing
  const seq = new YAMLSeq()
  map.set(key, seq)
  return seq
}

function prependChangelog(doc: Document, entry: Record<string, unknown>): void {
  const node = doc.createNode(entry)
  flowScalarLists(node)
  ensureSeq(doc.contents as YAMLMap, 'changelog').items.unshift(node)
}

function behaviourNode(doc: Document, id: string): YAMLMap {
  const behaviours = doc.get('behaviours', true)
  if (isSeq(behaviours)) {
    for (const item of behaviours.items) if (isMap(item) && String(item.get('id')) === id) return item
  }
  throw new InvalidStateError(`Behaviour ${id} is not in its feature file`)
}

/** New lists of plain values are written inline: `platforms: [ios, android]`. */
function flowScalarLists(node: Node | null): void {
  if (node === null) return
  visit(node, {
    Seq(_key, seq) {
      if (seq.items.length > 0 && seq.items.every((item) => isScalar(item))) seq.flow = true
    },
  })
}

function capitalise(tag: string): string {
  return tag.charAt(0).toUpperCase() + tag.slice(1)
}
