import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import {
  BEHAVIOUR_ID_RE,
  CHANGE_KINDS,
  FEATURE_ID_RE,
  RULES,
  categorySchema,
  compareIds,
  configSchema,
  featureSchema,
  isValidId,
  localNumber,
  parentId,
  parseRef,
  type Behaviour,
  type BehaviourEntry,
  type Category,
  type CategoryFile,
  type Change,
  type ChangeEntry,
  type ChangelogEntry,
  type ChangelogEntryFile,
  type Diagnostic,
  type Feature,
  type FeatureFile,
  type FieldDefinition,
  type LintLevel,
  type RuleCode,
  type SinceValue,
  type SourceRef,
  type StatusValue,
  type Almanac,
  type Variant,
} from '@feature-almanac/schema'
import type { z } from 'zod'
import { REMOVED, resolveConfig, type ResolvedConfig } from './config.js'
import { parseGherkin } from './gherkin.js'
import { categoryDirName, featureFileName } from './names.js'
import { expandPlatforms } from './platforms.js'
import { validate } from './schema-check.js'
import { CATEGORY_FILE, type CategoryDir, type SourceFile, type Workspace } from './workspace.js'
import { formatPath, lineAt, plainValue, type Path } from './yaml.js'

export interface CompileOptions {
  /** `lint --require-source`: enables ALM-W011 as a warning when the config leaves it off. */
  requireSource?: boolean
  now?: Date
  gitRef?: string
}

export interface CategoryHandle {
  dir: CategoryDir
  file: SourceFile
  data: CategoryFile
  model: Category
}

export interface FeatureHandle {
  file: SourceFile
  data: FeatureFile
  category: CategoryHandle
  model: Feature
}

export interface BehaviourHandle {
  feature: FeatureHandle
  index: number
  data: BehaviourEntry
  model: Behaviour
}

export type CounterKey = 'next_category' | 'next_feature' | 'next_behaviour'

export interface CounterFix {
  file: SourceFile
  key: CounterKey
  value: number
}

export interface Compilation {
  workspace: Workspace
  config?: ResolvedConfig
  /** Undefined when almanac.yaml is missing or invalid. */
  model?: Almanac
  diagnostics: Diagnostic[]
  categories: Map<string, CategoryHandle>
  features: Map<string, FeatureHandle>
  behaviours: Map<string, BehaviourHandle>
  /** Former ID → current ID. */
  formerly: Map<string, string>
  /** Every ID on record: live, tombstoned, former, and IDs in files that failed validation. */
  usedIds: Set<string>
  /** Counter values that `lint --fix` writes; raising a counter can never cause reuse. */
  counterFixes: CounterFix[]
}

export function compile(workspace: Workspace, options: CompileOptions = {}): Compilation {
  return new Compiler(workspace, options).run()
}

export function countDiagnostics(diagnostics: readonly Diagnostic[]): { errors: number; warnings: number } {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
  return { errors, warnings: diagnostics.length - errors }
}

interface ReportOptions {
  id?: string
  path?: Path
  line?: number
  fixable?: boolean
}

class Sink {
  readonly diagnostics: Diagnostic[] = []
  overrides: Partial<Record<RuleCode, LintLevel>> = {}

  report(code: RuleCode, file: SourceFile | string, message: string, options: ReportOptions = {}): void {
    const level = this.overrides[code] ?? RULES[code].severity
    if (level === 'off') return
    const diagnostic = { code, severity: level, message } as Diagnostic
    if (options.id !== undefined) diagnostic.id = options.id
    diagnostic.file = typeof file === 'string' ? file : file.path
    if (options.path !== undefined && options.path.length > 0) diagnostic.path = formatPath(options.path)
    const line = options.line ?? (typeof file === 'string' ? undefined : lineAt(file.parsed, options.path ?? []))
    if (line !== undefined) diagnostic.line = line
    diagnostic.fixable = options.fixable ?? false
    this.diagnostics.push(diagnostic)
  }
}

interface LoadedFeature {
  file: SourceFile
  data?: FeatureFile
  raw?: unknown
}

interface LoadedCategory {
  dir: CategoryDir
  category?: { file: SourceFile; data: CategoryFile }
  raw?: unknown
  features: LoadedFeature[]
}

type PlatMap = Record<string, string>

const byId = (a: { id: string }, b: { id: string }) => compareIds(a.id, b.id)

class Compiler {
  private readonly sink = new Sink()
  private readonly result: Compilation
  private readonly registry = new Map<string, string>()
  private cfg!: ResolvedConfig
  private codeRoot: string | undefined
  private gitRoot: string | undefined

  constructor(
    private readonly ws: Workspace,
    private readonly options: CompileOptions,
  ) {
    this.result = {
      workspace: ws,
      diagnostics: this.sink.diagnostics,
      categories: new Map(),
      features: new Map(),
      behaviours: new Map(),
      formerly: new Map(),
      usedIds: new Set(),
      counterFixes: [],
    }
  }

  run(): Compilation {
    const config = this.loadConfig()
    if (config === undefined) return this.finish()
    this.cfg = config
    this.result.config = config
    this.sink.overrides = { 'ALM-W010': config.lint.requireOwner, 'ALM-W011': this.requireSourceLevel() }
    this.locateRoots()

    const loaded = this.ws.categories.map((dir) => this.loadCategory(dir))
    this.registerIds(loaded)

    const categories: CategoryHandle[] = []
    for (const entry of loaded) {
      if (entry.category === undefined) continue
      const category = this.processCategory(entry.dir, entry.category.file, entry.category.data)
      categories.push(category)
      for (const feature of entry.features) {
        if (feature.data === undefined) continue
        category.model.features.push(this.processFeature(category, feature.file, feature.data).model)
      }
      category.model.features.sort(byId)
      this.checkCategoryRemoval(category)
    }
    this.checkChangelogRefs()
    this.checkCounters()
    this.result.model = this.buildModel(categories)
    return this.finish()
  }

  private finish(): Compilation {
    this.sink.diagnostics.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
    return this.result
  }

  private requireSourceLevel(): LintLevel {
    const configured = this.cfg.lint.requireSource
    if (configured !== 'off') return configured
    return this.options.requireSource === true ? 'warn' : 'off'
  }

  private locateRoots(): void {
    const code = this.cfg.code
    if (code !== undefined) {
      const dir = resolve(this.ws.root, code.path)
      if (this.ws.fs.isDirectory(dir)) this.codeRoot = dir
    }
    let dir = this.ws.root
    for (;;) {
      if (this.ws.fs.exists(join(dir, '.git'))) {
        this.gitRoot = dir
        return
      }
      const parent = dirname(dir)
      if (parent === dir) return
      dir = parent
    }
  }

  // Loading and schema validation

  private validateFile<T>(file: SourceFile, schema: z.ZodType<T>): { data?: T; raw?: unknown } {
    if (file.parsed.problems.length > 0) {
      for (const problem of file.parsed.problems) {
        this.sink.report('ALM-E001', file, problem.message, { line: problem.line })
      }
      return {}
    }
    const raw = plainValue(file.parsed.doc)
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      this.sink.report('ALM-E009', file, 'File must contain a YAML mapping')
      return {}
    }
    const { data, problems } = validate(schema, raw, file.kind)
    for (const problem of problems) this.sink.report(problem.code, file, problem.message, { path: problem.path })
    return data === undefined ? { raw } : { data, raw }
  }

  private loadConfig(): ResolvedConfig | undefined {
    const file = this.ws.config
    if (file === undefined) {
      this.sink.report('ALM-E006', 'almanac.yaml', 'almanac.yaml is missing')
      return undefined
    }
    const { data } = this.validateFile(file, configSchema)
    if (data === undefined) return undefined
    const cfg = resolveConfig(data)

    if (cfg.platforms.length === 0) {
      this.sink.report('ALM-E006', file, 'At least one platform is required', { path: ['platforms'] })
    }
    for (const [group, members] of Object.entries(cfg.groups)) {
      if (cfg.platforms.includes(group)) {
        this.sink.report('ALM-E009', file, `Platform group "${group}" clashes with a platform tag`, {
          path: ['platform_groups', group],
        })
      }
      members.forEach((member, index) => {
        if (cfg.platforms.includes(member) === false) {
          this.sink.report('ALM-E034', file, `Platform group "${group}" contains unknown platform "${member}"`, {
            path: ['platform_groups', group, index],
          })
        }
      })
    }
    if (cfg.statuses.includes(REMOVED) === false) {
      this.sink.report('ALM-E009', file, 'statuses must include "removed"', { path: ['statuses'] })
    }
    if (cfg.formatsAllowed.includes(cfg.formatDefault) === false) {
      this.sink.report('ALM-E007', file, `Default format "${cfg.formatDefault}" is not in formats.allowed`, {
        path: ['formats', 'default'],
      })
    }
    for (const [kind, defs] of Object.entries(cfg.fields)) {
      for (const [key, def] of Object.entries(defs)) {
        if (def.type === 'enum' && (def.values === undefined || def.values.length === 0)) {
          this.sink.report('ALM-E006', file, `Enum field "${key}" needs values`, { path: ['fields', kind, key, 'values'] })
        }
      }
    }
    return cfg
  }

  private loadCategory(dir: CategoryDir): LoadedCategory {
    const entry: LoadedCategory = { dir, features: [] }
    if (dir.file === undefined) {
      this.sink.report('ALM-E006', `${dir.dirName}/${CATEGORY_FILE}`, `Category folder ${dir.dirName} has no ${CATEGORY_FILE}`)
    } else {
      const { data, raw } = this.validateFile(dir.file, categorySchema)
      entry.raw = raw
      if (data !== undefined) entry.category = { file: dir.file, data }
    }
    for (const file of dir.features) {
      const { data, raw } = this.validateFile(file, featureSchema)
      const feature: LoadedFeature = { file }
      if (data !== undefined) feature.data = data
      if (raw !== undefined) feature.raw = raw
      entry.features.push(feature)
    }
    return entry
  }

  // ID registry (ALM-E005)

  private registerIds(loaded: readonly LoadedCategory[]): void {
    for (const entry of loaded) {
      if (entry.category !== undefined) {
        const id = String(entry.category.data.id)
        this.register(id, entry.category.file, ['id'], `category ${id}`)
      } else {
        this.registerLenient(entry.raw)
      }
      for (const feature of entry.features) {
        const data = feature.data
        if (data === undefined) {
          this.registerLenient(feature.raw)
          continue
        }
        this.register(data.id, feature.file, ['id'], `feature ${data.id}`)
        data.formerly?.forEach((old, index) => {
          this.register(old, feature.file, ['formerly', index], `former ID of feature ${data.id}`)
          this.result.formerly.set(old, data.id)
        })
        data.behaviours.forEach((behaviour, index) => {
          this.register(behaviour.id, feature.file, ['behaviours', index, 'id'], `behaviour ${behaviour.id}`)
          behaviour.formerly?.forEach((old, j) => {
            this.register(old, feature.file, ['behaviours', index, 'formerly', j], `former ID of behaviour ${behaviour.id}`)
            this.result.formerly.set(old, behaviour.id)
          })
        })
      }
    }
  }

  private register(id: string, file: SourceFile, path: Path, what: string): void {
    this.result.usedIds.add(id)
    const existing = this.registry.get(id)
    if (existing !== undefined) {
      this.sink.report('ALM-E005', file, `Duplicate ID ${id}: ${what} collides with ${existing}`, { id, path })
      return
    }
    this.registry.set(id, `${what} in ${file.path}`)
  }

  /** IDs in files that failed validation still count as used, so they are never allocated again. */
  private registerLenient(raw: unknown): void {
    if (raw === null || typeof raw !== 'object') return
    const record = raw as Record<string, unknown>
    const add = (value: unknown) => {
      if (typeof value === 'string' || typeof value === 'number') this.result.usedIds.add(String(value))
    }
    add(record.id)
    if (Array.isArray(record.formerly)) record.formerly.forEach(add)
    if (Array.isArray(record.behaviours)) {
      for (const behaviour of record.behaviours) {
        if (behaviour === null || typeof behaviour !== 'object') continue
        const b = behaviour as Record<string, unknown>
        add(b.id)
        if (Array.isArray(b.formerly)) b.formerly.forEach(add)
      }
    }
  }

  // Categories

  private processCategory(dir: CategoryDir, file: SourceFile, data: CategoryFile): CategoryHandle {
    const id = String(data.id)
    const status = data.status ?? 'active'
    if (status !== 'active' && status !== REMOVED) {
      this.sink.report('ALM-E007', file, `Category status must be active or removed, got "${status}"`, { id, path: ['status'] })
    } else if (status === REMOVED && isBlank(data.removed_reason)) {
      this.sink.report('ALM-E011', file, `Category ${id} is removed without removed_reason`, { id, path: ['status'] })
    }
    const expected = categoryDirName(data.id, data.name)
    if (dir.dirName !== expected) {
      this.sink.report('ALM-W001', file, `Folder ${dir.dirName} should be named ${expected}`, { id, fixable: true })
    }
    this.checkOwner(file, data.owner, ['owner'], id)
    this.checkDescription(file, data.description, ['description'], `Category ${id}`, id)

    const model: Category = {
      id,
      name: data.name,
      description: data.description.trimEnd(),
      ...(data.owner !== undefined ? { owner: data.owner } : {}),
      status: status === REMOVED ? 'removed' : 'active',
      ...(data.removed_reason !== undefined ? { removedReason: data.removed_reason } : {}),
      features: [],
      file: file.path,
    }
    const handle: CategoryHandle = { dir, file, data, model }
    this.result.categories.set(id, handle)
    return handle
  }

  private checkCategoryRemoval(category: CategoryHandle): void {
    if (category.model.status !== 'removed') return
    for (const feature of this.result.features.values()) {
      if (feature.category !== category || onlyRemoved(feature.data.status)) continue
      this.sink.report('ALM-E013', category.file, `Category ${category.model.id} is removed but feature ${feature.model.id} is not`, {
        id: category.model.id,
        path: ['status'],
      })
    }
  }

  // Features

  private processFeature(category: CategoryHandle, file: SourceFile, data: FeatureFile): FeatureHandle {
    const cfg = this.cfg
    const id = data.id
    const report = (code: RuleCode, message: string, path: Path, fixable = false) =>
      this.sink.report(code, file, message, { id, path, fixable })

    if (FEATURE_ID_RE.test(id) === false) {
      report('ALM-E004', `Feature ID "${id}" is not of the form N.M`, ['id'])
    } else if (parentId(id) !== category.model.id) {
      report('ALM-E004', `Feature ${id} is not under category ${category.model.id}`, ['id'])
    } else {
      const expected = featureFileName(id, data.name)
      if (basename(file.absPath) !== expected) report('ALM-W001', `File should be named ${expected}`, [], true)
    }
    this.checkFormerly(file, data.formerly, FEATURE_ID_RE, 'feature', id, [])
    this.checkOwner(file, data.owner, ['owner'], id)
    this.checkDescription(file, data.description, ['description'], `Feature ${id}`, id)

    const platforms = this.expand(file, data.platforms, cfg.platforms, ['platforms'], id, undefined, true)
    const ownStatus = this.checkStatus(file, data.status, platforms, ['status'], id, true)
    if (hasRemoved(data.status) && isBlank(data.removed_reason)) {
      report('ALM-E011', `Feature ${id} is removed without removed_reason`, ['status'])
    }
    const categoryRemoved = category.model.status === 'removed'
    const status: PlatMap = {}
    for (const platform of platforms) {
      status[platform] = categoryRemoved ? REMOVED : (ownStatus(platform) ?? (cfg.statuses[0] as string))
    }
    const ownSince = this.checkSince(file, data.since, platforms, ['since'], id)
    const since: PlatMap = {}
    for (const platform of platforms) assignDefined(since, platform, ownSince(platform))

    data.links?.forEach((link, index) => {
      if (cfg.linkTypes.includes(link.type) === false) {
        report('ALM-E007', `Link type "${link.type}" is not one of ${cfg.linkTypes.join(', ')}`, ['links', index, 'type'])
      }
    })
    for (const key of ['depends_on', 'related'] as const) {
      data[key]?.forEach((ref, index) => {
        if (FEATURE_ID_RE.test(ref) === false || this.result.usedIds.has(ref) === false) {
          report('ALM-E008', `${key} ${ref} does not resolve to a feature`, [key, index])
        }
      })
    }
    this.checkFields(file, data.fields, cfg.fields.feature, ['fields'], id)
    data.code?.forEach((path, index) => this.checkCodePath(file, path, ['code', index], id))
    data.assets?.forEach((path, index) => {
      if (this.ws.fs.exists(join(this.ws.root, path)) === false) report('ALM-W013', `Asset ${path} not found`, ['assets', index])
    })

    const model: Feature = {
      id,
      ref: this.ref(id),
      name: data.name,
      description: data.description.trimEnd(),
      ...(data.overview !== undefined ? { overview: data.overview.trimEnd() } : {}),
      owner: data.owner,
      platforms,
      status,
      since,
      tags: data.tags ?? [],
      dependsOn: data.depends_on ?? [],
      related: data.related ?? [],
      links: data.links ?? [],
      code: data.code ?? [],
      assets: data.assets ?? [],
      fields: data.fields ?? {},
      formerly: data.formerly ?? [],
      ...(data.removed_reason !== undefined ? { removedReason: data.removed_reason } : {}),
      changelog: data.changelog.map((entry) => this.changelogModel(entry)),
      behaviours: [],
      file: file.path,
      line: lineAt(file.parsed, ['id']) ?? 1,
    }
    const handle: FeatureHandle = { file, data, category, model }
    this.result.features.set(id, handle)

    const ids = data.behaviours.map((behaviour) => behaviour.id)
    const sorted = [...ids].sort(compareIds)
    if (ids.some((behaviourId, index) => behaviourId !== sorted[index])) {
      report('ALM-E010', `Behaviours of ${id} are not in ID order`, ['behaviours'], true)
    }
    data.behaviours.forEach((behaviour, index) => {
      model.behaviours.push(this.processBehaviour(handle, behaviour, index))
    })
    model.behaviours.sort(byId)

    const featureRemoved = platforms.length > 0 ? platforms.every((p) => status[p] === REMOVED) : hasRemoved(data.status)
    if (data.behaviours.length === 0 && featureRemoved === false) {
      report('ALM-W017', `Feature ${id} has no behaviours yet`, ['behaviours'])
    }
    const live = model.behaviours.filter((behaviour) => isLive(behaviour.status)).length
    if (live > cfg.lint.maxBehaviours) {
      report('ALM-W014', `Feature ${id} has ${live} behaviours, more than ${cfg.lint.maxBehaviours}`, ['behaviours'])
    }
    this.checkChangelogShape(file, data.changelog, id)
    return handle
  }

  // Behaviours and variants

  private processBehaviour(feature: FeatureHandle, data: BehaviourEntry, index: number): Behaviour {
    const cfg = this.cfg
    const file = feature.file
    const id = data.id
    const base: Path = ['behaviours', index]
    const report = (code: RuleCode, message: string, path: Path, entityId = id) =>
      this.sink.report(code, file, message, { id: entityId, path })

    if (BEHAVIOUR_ID_RE.test(id) === false) {
      report('ALM-E004', `Behaviour ID "${id}" is not of the form N.M.K`, [...base, 'id'])
    } else if (parentId(id) !== feature.model.id) {
      report('ALM-E004', `Behaviour ${id} is not under feature ${feature.model.id}`, [...base, 'id'])
    }
    this.checkFormerly(file, data.formerly, BEHAVIOUR_ID_RE, 'behaviour', id, base)
    const format = data.format ?? cfg.formatDefault
    if (cfg.formatsAllowed.includes(format) === false) {
      report('ALM-E007', `Format "${format}" is not one of ${cfg.formatsAllowed.join(', ')}`, [...base, 'format'])
    }

    const featureStatus = feature.model.status
    const platforms = this.expand(file, data.platforms, feature.model.platforms, [...base, 'platforms'], id, 'ALM-E030', true)
    const ownStatus = this.checkStatus(file, data.status, platforms, [...base, 'status'], id, false)
    if (hasRemoved(data.status) && isBlank(data.removed_reason)) {
      report('ALM-E011', `Behaviour ${id} is removed without removed_reason`, [...base, 'status'])
    }
    const status = inheritStatus(platforms, ownStatus, featureStatus)
    if (status.overridden) {
      report('ALM-W018', `Behaviour ${id} declares a status, but its feature is removed so it resolves as removed`, [...base, 'status'])
    }
    const ownSince = this.checkSince(file, data.since, platforms, [...base, 'since'], id)
    const since: PlatMap = {}
    for (const platform of platforms) assignDefined(since, platform, ownSince(platform) ?? feature.model.since[platform])

    if ((data.source === undefined || data.source.length === 0) && isLive(status.map)) {
      report('ALM-W011', `Behaviour ${id} has no source`, base)
    }
    data.source?.forEach((entry, i) => this.checkCodePath(file, entry, [...base, 'source', i], id))
    this.checkFields(file, data.fields, cfg.fields.behaviour, [...base, 'fields'], id)
    this.checkDescription(file, data.description, [...base, 'description'], `Behaviour ${id}`, id)

    let gherkin
    let summary
    if (format === 'gherkin') {
      const parsed = parseGherkin(data.description)
      if (parsed.ok) {
        gherkin = parsed.scenarios
        summary = parsed.summary
      } else {
        const hint = data.format === undefined ? ' (gherkin is the default; set format: prose for plain text)' : ''
        report('ALM-W015', `Behaviour ${id} has format gherkin, but ${parsed.message}${hint}`, [...base, 'description'])
      }
    }

    const finalStatus: PlatMap = { ...status.map }
    const finalSince: PlatMap = { ...since }
    const coveredBy = new Map<string, number>()
    const variants: Variant[] = []
    data.variants?.forEach((entry, j) => {
      const path: Path = [...base, 'variants', j]
      const variantPlatforms = this.expand(file, entry.platforms, platforms, [...path, 'platforms'], id, 'ALM-E031', false)
      const ref = `${id}@${variantPlatforms[0] ?? entry.platforms[0]}`
      const overlap = variantPlatforms.filter((platform) => coveredBy.has(platform))
      if (overlap.length > 0) {
        report('ALM-E032', `Variant ${ref} overlaps another variant of ${id} on ${overlap.join(', ')}`, [...path, 'platforms'], ref)
      }
      for (const platform of variantPlatforms) if (coveredBy.has(platform) === false) coveredBy.set(platform, j)

      const ownVariantStatus = this.checkStatus(file, entry.status, variantPlatforms, [...path, 'status'], ref, false)
      if (hasRemoved(entry.status) && isBlank(entry.removed_reason)) {
        report('ALM-E011', `Variant ${ref} is removed without removed_reason`, [...path, 'status'], ref)
      }
      const variantStatus = inheritStatus(variantPlatforms, ownVariantStatus, status.map)
      if (variantStatus.overridden) {
        report('ALM-W018', `Variant ${ref} declares a status, but its behaviour is removed so it resolves as removed`, [...path, 'status'], ref)
      }
      const ownVariantSince = this.checkSince(file, entry.since, variantPlatforms, [...path, 'since'], ref)
      const variantSince: PlatMap = {}
      for (const platform of variantPlatforms) assignDefined(variantSince, platform, ownVariantSince(platform) ?? since[platform])
      entry.source?.forEach((source, i) => this.checkCodePath(file, source, [...path, 'source', i], ref))
      this.checkDescription(file, entry.description, [...path, 'description'], `Variant ${ref}`, ref)

      for (const platform of variantPlatforms) {
        if (coveredBy.get(platform) !== j) continue
        finalStatus[platform] = variantStatus.map[platform] as string
        assignDefined(finalSince, platform, variantSince[platform])
      }
      variants.push({
        ref,
        platforms: variantPlatforms,
        mode: entry.mode ?? 'append',
        ...(entry.status !== undefined ? { status: variantStatus.map } : {}),
        ...(entry.since !== undefined ? { since: variantSince } : {}),
        description: entry.description.trimEnd(),
        source: (entry.source ?? []).map((source) => this.sourceRef(source)),
        ...(entry.removed_reason !== undefined ? { removedReason: entry.removed_reason } : {}),
        line: lineAt(file.parsed, path) ?? 1,
      })
    })

    const description = data.description.trimEnd()
    const resolved: PlatMap = {}
    for (const platform of platforms) {
      const j = coveredBy.get(platform)
      const variant = j === undefined ? undefined : variants[j]
      if (variant === undefined) resolved[platform] = description
      else resolved[platform] = variant.mode === 'replace' ? variant.description : `${description}\n\n${variant.description}`
    }

    const model: Behaviour = {
      id,
      ref: this.ref(id),
      name: data.name,
      platforms,
      status: finalStatus,
      since: finalSince,
      format,
      description,
      ...(gherkin !== undefined ? { gherkin } : {}),
      ...(summary !== undefined ? { summary } : {}),
      source: (data.source ?? []).map((source) => this.sourceRef(source)),
      tags: data.tags ?? [],
      ...(data.flag !== undefined ? { flag: data.flag } : {}),
      fields: data.fields ?? {},
      formerly: data.formerly ?? [],
      ...(data.removed_reason !== undefined ? { removedReason: data.removed_reason } : {}),
      variants,
      resolved,
      line: lineAt(file.parsed, base) ?? 1,
    }
    this.result.behaviours.set(id, { feature, index, data, model })
    return model
  }

  // Shared checks

  private expand(
    file: SourceFile,
    list: readonly string[] | undefined,
    base: readonly string[],
    path: Path,
    id: string,
    outsideCode: 'ALM-E030' | 'ALM-E031' | undefined,
    allowExclusions: boolean,
  ): string[] {
    const expansion = expandPlatforms(list, base, this.cfg, allowExclusions)
    for (const unknown of expansion.unknown) {
      this.sink.report('ALM-E034', file, `Unknown platform or group "${unknown.tag}"`, { id, path: [...path, unknown.index] })
    }
    if (outsideCode !== undefined && expansion.outside.length > 0) {
      const what = outsideCode === 'ALM-E030' ? `Behaviour ${id}` : `Variant of ${id}`
      const parent = outsideCode === 'ALM-E030' ? 'feature' : 'behaviour'
      const outside = expansion.outside.map((platform) => `@${platform}`).join(', ')
      this.sink.report(outsideCode, file, `${what} includes ${outside}, not in ${parent} platforms [${base.join(', ')}]`, { id, path })
    }
    return expansion.platforms
  }

  /**
   * Validates a status value and returns a per-platform lookup. Only feature status maps must be
   * complete; behaviour and variant maps may be partial and fall through to the parent.
   */
  private checkStatus(
    file: SourceFile,
    value: StatusValue | undefined,
    platforms: readonly string[],
    path: Path,
    id: string,
    complete: boolean,
  ): (platform: string) => string | undefined {
    if (value === undefined) return () => undefined
    const statuses = this.cfg.statuses
    if (typeof value === 'string') {
      if (statuses.includes(value) === false) {
        this.sink.report('ALM-E007', file, `Status "${value}" is not one of ${statuses.join(', ')}`, { id, path })
      }
      return () => value
    }
    this.checkPlatMapKeys(file, value, platforms, path, id)
    for (const [platform, status] of Object.entries(value)) {
      if (statuses.includes(status) === false) {
        this.sink.report('ALM-E007', file, `Status "${status}" is not one of ${statuses.join(', ')}`, { id, path: [...path, platform] })
      }
    }
    if (complete) {
      const missing = platforms.filter((platform) => value[platform] === undefined)
      if (missing.length > 0) {
        this.sink.report('ALM-E033', file, `Status map of ${id} is missing ${missing.join(', ')}`, { id, path })
      }
    }
    return (platform) => value[platform]
  }

  private checkSince(
    file: SourceFile,
    value: SinceValue | undefined,
    platforms: readonly string[],
    path: Path,
    id: string,
  ): (platform: string) => string | undefined {
    if (value === undefined) return () => undefined
    if (typeof value === 'string') return () => value
    this.checkPlatMapKeys(file, value, platforms, path, id)
    return (platform) => value[platform]
  }

  private checkPlatMapKeys(file: SourceFile, value: PlatMap, platforms: readonly string[], path: Path, id: string): void {
    for (const platform of Object.keys(value)) {
      if (this.cfg.platforms.includes(platform) === false) {
        this.sink.report('ALM-E034', file, `Unknown platform "${platform}"`, { id, path: [...path, platform] })
      } else if (platforms.includes(platform) === false) {
        this.sink.report('ALM-E033', file, `${id} has a value for ${platform}, which is not among its platforms [${platforms.join(', ')}]`, {
          id,
          path: [...path, platform],
        })
      }
    }
  }

  private checkFormerly(file: SourceFile, list: readonly string[] | undefined, pattern: RegExp, level: string, id: string, base: Path): void {
    list?.forEach((old, index) => {
      if (pattern.test(old) === false) {
        this.sink.report('ALM-E004', file, `Former ID "${old}" is not a ${level} ID`, { id, path: [...base, 'formerly', index] })
      }
    })
  }

  private checkOwner(file: SourceFile, owner: string | undefined, path: Path, id: string): void {
    const owners = this.cfg.owners
    if (owner === undefined || owners === undefined || Object.hasOwn(owners, owner)) return
    this.sink.report('ALM-W010', file, `Owner "${owner}" is not in the owners registry`, { id, path })
  }

  private checkDescription(file: SourceFile, text: string, path: Path, label: string, id: string): void {
    const length = text.trim().length
    if (length >= 20) return
    this.sink.report('ALM-W016', file, `${label} description is ${length === 0 ? 'empty' : 'under 20 characters'}`, { id, path })
  }

  private checkFields(
    file: SourceFile,
    fields: Record<string, unknown> | undefined,
    definitions: Record<string, FieldDefinition>,
    path: Path,
    id: string,
  ): void {
    if (fields === undefined) return
    for (const [key, value] of Object.entries(fields)) {
      const definition = definitions[key]
      if (definition === undefined) continue
      const report = (code: RuleCode, message: string) => this.sink.report(code, file, message, { id, path: [...path, key] })
      switch (definition.type) {
        case 'string':
          if (typeof value !== 'string') report('ALM-E009', `Field ${key} must be a string`)
          break
        case 'number':
          if (typeof value !== 'number') report('ALM-E009', `Field ${key} must be a number`)
          break
        case 'bool':
          if (typeof value !== 'boolean') report('ALM-E009', `Field ${key} must be true or false`)
          break
        case 'list':
          if (Array.isArray(value) === false) report('ALM-E009', `Field ${key} must be a list`)
          break
        case 'enum': {
          const values = definition.values ?? []
          if (typeof value !== 'string') report('ALM-E009', `Field ${key} must be one of ${values.join(', ')}`)
          else if (values.includes(value) === false) report('ALM-E007', `Field ${key} must be one of ${values.join(', ')}, got "${value}"`)
          break
        }
      }
    }
  }

  /** ALM-W013 for `source` and `code` entries; skipped when the code directory is not present. */
  private checkCodePath(file: SourceFile, entry: string, path: Path, id: string): void {
    if (this.codeRoot === undefined) return
    const target = entry.split('#')[0] as string
    const glob = target.search(/[*?[\]{}]/)
    const literal = glob === -1 ? target : target.slice(0, target.lastIndexOf('/', glob) + 1)
    if (this.ws.fs.exists(join(this.codeRoot, literal))) return
    this.sink.report('ALM-W013', file, `${entry} not found under code path ${this.cfg.code?.path ?? '.'}`, { id, path })
  }

  // Changelog

  private checkChangelogShape(file: SourceFile, changelog: readonly ChangelogEntryFile[], id: string): void {
    if (changelog.length === 0) {
      this.sink.report('ALM-E006', file, `Feature ${id} needs at least one changelog entry`, { id, path: ['changelog'] })
    }
    changelog.forEach((entry, index) => {
      const path: Path = ['changelog', index]
      const previous = changelog[index - 1]
      if (previous !== undefined && entry.date > previous.date) {
        this.sink.report('ALM-E040', file, `Changelog entry ${entry.date} is newer than the entry above it (${previous.date})`, {
          id,
          path: [...path, 'date'],
        })
      }
      if (entry.changes.length === 0) {
        this.sink.report('ALM-E040', file, `Changelog entry ${entry.date} has no changes`, { id, path: [...path, 'changes'] })
      }
      entry.platforms?.forEach((platform, j) => {
        if (this.cfg.platforms.includes(platform) || this.cfg.groups[platform] !== undefined) return
        this.sink.report('ALM-E034', file, `Unknown platform or group "${platform}"`, { id, path: [...path, 'platforms', j] })
      })
      entry.changes.forEach((change, j) => {
        if (changeKinds(change).length !== 1) {
          this.sink.report('ALM-E009', file, 'A change needs exactly one of added, modified, removed, moved, feature', {
            id,
            path: [...path, 'changes', j],
          })
        }
      })
    })
  }

  private checkChangelogRefs(): void {
    const addedBehaviours = new Set<string>()
    const addedVariants = new Set<string>()
    for (const feature of this.result.features.values()) {
      const report = (message: string, path: Path) => this.sink.report('ALM-E008', feature.file, message, { id: feature.model.id, path })
      feature.data.changelog.forEach((entry, i) => {
        entry.changes.forEach((change, j) => {
          const path: Path = ['changelog', i, 'changes', j]
          for (const kind of ['added', 'modified', 'removed'] as const) {
            const ref = change[kind]
            if (ref === undefined) continue
            const target = this.resolveChangeRef(ref)
            if (target === undefined) {
              report(`Changelog ${kind} ${ref} does not resolve to a behaviour or variant`, [...path, kind])
            } else if (kind === 'added') {
              if (target.platform === undefined) addedBehaviours.add(target.id)
              else addedVariants.add(`${target.id}@${target.platform}`)
            }
          }
          if (change.moved !== undefined) {
            const to = this.resolveChangeRef(change.moved.to, true)
            const from = this.resolveChangeRef(change.moved.from, true)
            if (to === undefined) report(`Changelog moved.to ${change.moved.to} does not resolve`, [...path, 'moved', 'to'])
            else if (from === undefined || from.id !== to.id) {
              report(`Changelog moved.from ${change.moved.from} is not a former ID of ${change.moved.to}`, [...path, 'moved', 'from'])
            }
          }
        })
      })
    }

    // A behaviour's `added` covers the variants it shipped with; later variants need their own.
    for (const behaviour of this.result.behaviours.values()) {
      const id = behaviour.model.id
      const covered = addedBehaviours.has(id)
      const base: Path = ['behaviours', behaviour.index]
      if (covered === false) {
        this.sink.report('ALM-W012', behaviour.feature.file, `Behaviour ${id} never appears as added in a changelog`, { id, path: base })
      }
      behaviour.model.variants.forEach((variant, j) => {
        if (covered || variant.platforms.some((platform) => addedVariants.has(`${id}@${platform}`))) return
        this.sink.report('ALM-W012', behaviour.feature.file, `Variant ${variant.ref} never appears as added in a changelog`, {
          id: variant.ref,
          path: [...base, 'variants', j],
        })
      })
    }
  }

  /** `moved` also names features: a feature move records `moved: { from: 1.2, to: 3.5 }`. */
  private resolveChangeRef(ref: string, allowFeature = false): { id: string; platform?: string } | undefined {
    const parsed = parseRef(ref)
    if (parsed === undefined || parsed.prefix !== undefined) return undefined
    if (parsed.level !== 'behaviour' && (allowFeature === false || parsed.level !== 'feature')) return undefined
    if (this.result.usedIds.has(parsed.id) === false) return undefined
    const id = this.result.formerly.get(parsed.id) ?? parsed.id
    const platform = parsed.platform
    if (platform === undefined) return { id }
    const handle = this.result.behaviours.get(id)
    if (handle !== undefined && handle.model.variants.some((variant) => variant.platforms.includes(platform)) === false) return undefined
    return { id, platform }
  }

  // Counters (ALM-E006 / ALM-E012)

  private checkCounters(): void {
    const used = [...this.result.usedIds].filter(isValidId)
    const maxUnder = (parent: string | undefined) =>
      used.filter((id) => parentId(id) === parent).reduce((max, id) => Math.max(max, localNumber(id)), 0)
    const check = (file: SourceFile, key: CounterKey, value: number | undefined, parent: string | undefined, id?: string) => {
      const max = maxUnder(parent)
      const options = { path: [key], fixable: true, ...(id !== undefined ? { id } : {}) }
      if (value === undefined) {
        this.sink.report('ALM-E006', file, `Missing ${key}; IDs are allocated from it`, options)
      } else if (value <= max) {
        const usedId = parent === undefined ? String(max) : `${parent}.${max}`
        this.sink.report('ALM-E012', file, `${key} is ${value} but ${usedId} is already used`, options)
      } else {
        return
      }
      this.result.counterFixes.push({ file, key, value: Math.max(value ?? 0, max + 1) })
    }
    if (this.ws.config !== undefined) check(this.ws.config, 'next_category', this.cfg.data.next_category, undefined)
    for (const category of this.result.categories.values()) {
      check(category.file, 'next_feature', category.data.next_feature, category.model.id, category.model.id)
    }
    for (const feature of this.result.features.values()) {
      check(feature.file, 'next_behaviour', feature.data.next_behaviour, feature.model.id, feature.model.id)
    }
  }

  // Model

  private ref(id: string): string {
    const prefix = this.cfg.product.prefix
    return prefix === undefined ? id : `${prefix}-${id}`
  }

  private sourceRef(entry: string): SourceRef {
    const hash = entry.indexOf('#')
    const path = hash === -1 ? entry : entry.slice(0, hash)
    const out: SourceRef = { path }
    if (hash !== -1) out.symbol = entry.slice(hash + 1)
    const code = this.cfg.code
    if (code?.repo !== undefined && this.gitRoot !== undefined) {
      const repoPath = relative(this.gitRoot, resolve(this.ws.root, code.path, path)).split(sep).join('/')
      if (repoPath.startsWith('..') === false) out.url = `${code.repo.replace(/\/+$/, '')}/blob/${code.ref}/${repoPath}`
    }
    return out
  }

  private changelogModel(entry: ChangelogEntryFile): ChangelogEntry {
    const out: ChangelogEntry = { date: entry.date, summary: entry.summary, platforms: [], changes: [] }
    if (entry.version !== undefined) out.version = entry.version
    out.platforms = entry.platforms ?? []
    if (entry.ticket !== undefined) {
      const ticket: { id: string; url?: string } = { id: entry.ticket }
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(entry.ticket)) ticket.url = entry.ticket
      else if (this.cfg.ticketsUrl !== undefined) ticket.url = this.cfg.ticketsUrl.replace('{id}', entry.ticket)
      out.ticket = ticket
    }
    if (entry.author !== undefined) out.author = entry.author
    out.changes = entry.changes.map(changeModel)
    return out
  }

  private buildModel(categories: readonly CategoryHandle[]): Almanac {
    const cfg = this.cfg
    const product: Almanac['product'] = { name: cfg.product.name }
    if (cfg.product.prefix !== undefined) product.prefix = cfg.product.prefix
    if (cfg.product.description !== undefined) product.description = cfg.product.description
    return {
      almanac: 1,
      generatedAt: (this.options.now ?? new Date()).toISOString(),
      ...(this.options.gitRef !== undefined ? { gitRef: this.options.gitRef } : {}),
      product,
      ...(cfg.code?.repo !== undefined ? { code: { repo: cfg.code.repo, ref: cfg.code.ref, path: cfg.code.path } } : {}),
      platforms: cfg.platforms.map((id) => ({ id, name: cfg.platformNames[id] ?? id })),
      platformGroups: cfg.groups,
      statuses: cfg.statuses,
      owners: cfg.owners ?? {},
      categories: categories.map((category) => category.model).sort(byId),
      diagnostics: this.sink.diagnostics,
    }
  }
}

function changeKinds(change: ChangeEntry): (typeof CHANGE_KINDS)[number][] {
  return CHANGE_KINDS.filter((kind) => change[kind] !== undefined)
}

function changeModel(change: ChangeEntry): Change {
  const kind = changeKinds(change)[0] ?? 'modified'
  const out: Change = { kind }
  if (kind === 'moved' && change.moved !== undefined) {
    out.from = change.moved.from
    out.to = change.moved.to
  } else if (kind === 'feature' && change.feature !== undefined) {
    out.action = change.feature
  } else if (kind === 'added' || kind === 'modified' || kind === 'removed') {
    const ref = change[kind]
    if (ref !== undefined) out.ref = ref
  }
  if (change.detail !== undefined) out.detail = change.detail
  return out
}

/**
 * §8 rule 6 with removal propagation: a platform removed on the parent is removed on the child,
 * whatever the child declares.
 */
function inheritStatus(
  platforms: readonly string[],
  own: (platform: string) => string | undefined,
  parent: Readonly<PlatMap>,
): { map: PlatMap; overridden: boolean } {
  const map: PlatMap = {}
  let overridden = false
  for (const platform of platforms) {
    const inherited = parent[platform] as string
    const mine = own(platform)
    if (inherited === REMOVED) {
      map[platform] = REMOVED
      if (mine !== undefined && mine !== REMOVED) overridden = true
    } else {
      map[platform] = mine ?? inherited
    }
  }
  return { map, overridden }
}

function hasRemoved(value: StatusValue | undefined): boolean {
  if (value === undefined) return false
  if (typeof value === 'string') return value === REMOVED
  return Object.values(value).includes(REMOVED)
}

function onlyRemoved(value: StatusValue): boolean {
  if (typeof value === 'string') return value === REMOVED
  const values = Object.values(value)
  return values.length > 0 && values.every((status) => status === REMOVED)
}

export function isLive(status: Readonly<PlatMap>): boolean {
  return Object.values(status).some((value) => value !== REMOVED)
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}

function assignDefined(target: PlatMap, key: string, value: string | undefined): void {
  if (value !== undefined) target[key] = value
}
