import { basename, join } from 'node:path'
import { Scalar, isMap, isScalar, isSeq, visit, type Document, type Pair, type YAMLMap, type YAMLSeq } from 'yaml'
import { FEATURE_ID_RE, compareIds, type FileKind } from '@feature-almanac/schema'
import type { CounterFix } from './compile.js'
import type { FileChange } from './changes.js'
import { categoryDirName, featureFileName } from './names.js'
import { allFiles, type Workspace } from './workspace.js'
import { parseYaml, plainValue, serialize } from './yaml.js'

// §4–§7: key order follows the field tables.
const CONFIG_KEYS = ['almanac', 'next_category', 'product', 'code', 'platforms', 'platform_groups', 'statuses', 'formats', 'link_types', 'owners', 'tickets', 'fields', 'lint', 'site']
const PRODUCT_KEYS = ['name', 'prefix', 'description']
const CODE_KEYS = ['repo', 'ref', 'path']
const CATEGORY_KEYS = ['id', 'name', 'description', 'owner', 'status', 'removed_reason', 'next_feature']
const FEATURE_KEYS = ['id', 'name', 'description', 'owner', 'status', 'platforms', 'since', 'tags', 'depends_on', 'related', 'links', 'code', 'assets', 'fields', 'overview', 'formerly', 'removed_reason', 'next_behaviour', 'behaviours', 'changelog']
const LINK_KEYS = ['type', 'title', 'url']
const BEHAVIOUR_KEYS = ['id', 'name', 'description', 'format', 'platforms', 'status', 'since', 'source', 'tags', 'flag', 'fields', 'formerly', 'removed_reason', 'variants']
const VARIANT_KEYS = ['platforms', 'description', 'mode', 'status', 'since', 'source', 'removed_reason']
const ENTRY_KEYS = ['date', 'summary', 'changes', 'version', 'platforms', 'ticket', 'author']
const CHANGE_KEYS = ['added', 'modified', 'removed', 'moved', 'feature', 'detail']
const MOVED_KEYS = ['from', 'to']

/**
 * Normalises a document in place: key order, quoting of IDs, refs, versions and dates, literal
 * block scalars for multi-line text, behaviour order, and block style for entity lists. Comments
 * travel with the nodes they are attached to.
 */
export function formatDocument(doc: Document, kind: FileKind): void {
  normaliseScalars(doc)
  const root = doc.contents
  if (isMap(root) === false) return
  if (kind === 'config') {
    orderKeys(root, CONFIG_KEYS)
    orderChild(root, 'product', PRODUCT_KEYS)
    orderChild(root, 'code', CODE_KEYS)
  } else if (kind === 'category') {
    orderKeys(root, CATEGORY_KEYS)
  } else {
    formatFeature(root)
  }
}

function formatFeature(root: YAMLMap): void {
  orderKeys(root, FEATURE_KEYS)
  quote(root.get('id', true))
  quoteVersions(root.get('since', true))
  for (const key of ['depends_on', 'related', 'formerly']) quoteItems(root.get(key, true))
  forEachMap(root.get('links', true), (link) => orderKeys(link, LINK_KEYS))

  const behaviours = root.get('behaviours', true)
  if (isSeq(behaviours)) {
    forEachMap(behaviours, (behaviour) => {
      orderKeys(behaviour, BEHAVIOUR_KEYS)
      quote(behaviour.get('id', true))
      quoteVersions(behaviour.get('since', true))
      quoteItems(behaviour.get('formerly', true))
      const variants = behaviour.get('variants', true)
      forEachMap(variants, (variant) => {
        orderKeys(variant, VARIANT_KEYS)
        quoteVersions(variant.get('since', true))
      })
      blockStyle(variants)
    })
    // A comment above the first item is stored on the list; keep it with that item when sorting.
    const first = behaviours.items[0]
    if (isMap(first) && behaviours.commentBefore !== undefined && behaviours.commentBefore !== null) {
      first.commentBefore = first.commentBefore ? `${behaviours.commentBefore}\n${first.commentBefore}` : behaviours.commentBefore
      behaviours.commentBefore = undefined
    }
    behaviours.items.sort((a, b) => compareIds(idOf(a), idOf(b)))
    behaviours.items.forEach((item, index) => {
      if (isMap(item)) item.spaceBefore = index > 0
    })
    blockStyle(behaviours)
  }

  const changelog = root.get('changelog', true)
  forEachMap(changelog, (entry) => {
    orderKeys(entry, ENTRY_KEYS)
    quote(entry.get('date', true))
    quote(entry.get('version', true))
    const changes = entry.get('changes', true)
    forEachMap(changes, (change) => {
      orderKeys(change, CHANGE_KEYS)
      for (const key of ['added', 'modified', 'removed']) quote(change.get(key, true))
      const moved = change.get('moved', true)
      if (isMap(moved)) {
        orderKeys(moved, MOVED_KEYS)
        quote(moved.get('from', true))
        quote(moved.get('to', true))
      }
    })
    blockStyle(changes)
  })
  blockStyle(changelog)

  for (const pair of root.items) {
    if (isScalar(pair.key) && (pair.key.value === 'behaviours' || pair.key.value === 'changelog')) pair.key.spaceBefore = true
  }
}

/** Multi-line strings become literal blocks ending in one newline; every other string is plain where YAML allows. */
function normaliseScalars(doc: Document): void {
  visit(doc, {
    Scalar(_key, node) {
      if (typeof node.value !== 'string') return
      const trimmed = node.value.replace(/\s+$/u, '')
      if (trimmed.includes('\n')) {
        node.value = `${trimmed}\n`
        node.type = Scalar.BLOCK_LITERAL
      } else {
        // One line plus trailing line breaks (a block's, or stdin's) would be written as a block; drop them.
        if (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED || node.value.includes('\n')) node.value = trimmed
        node.type = Scalar.PLAIN
      }
    },
  })
}

/** Keys in `order` first, in that order; unknown keys keep their relative order at the end. */
function orderKeys(map: YAMLMap, order: readonly string[]): void {
  // Keys added with `map.set('key', …)` are plain strings rather than Scalars; rank them the same.
  const rank = (pair: Pair) => {
    const index = order.indexOf(String(isScalar(pair.key) ? pair.key.value : pair.key))
    return index === -1 ? order.length : index
  }
  const first = map.items[0]
  const leading = first !== undefined && isScalar(first.key) ? first.key.commentBefore : undefined
  if (first !== undefined && isScalar(first.key)) first.key.commentBefore = undefined
  map.items.sort((a, b) => rank(a) - rank(b))
  // A header comment (yaml-language-server) stays at the top of the file.
  const top = map.items[0]
  if (leading !== undefined && leading !== null && top !== undefined && isScalar(top.key)) {
    top.key.commentBefore = top.key.commentBefore ? `${leading}\n${top.key.commentBefore}` : leading
  }
}

function orderChild(map: YAMLMap, key: string, order: readonly string[]): void {
  const child = map.get(key, true)
  if (isMap(child)) orderKeys(child, order)
}

function forEachMap(node: unknown, fn: (map: YAMLMap) => void): void {
  if (isSeq(node) === false) return
  for (const item of node.items) if (isMap(item)) fn(item)
}

function blockStyle(node: unknown): void {
  if (isSeq(node)) (node as YAMLSeq).flow = node.items.length === 0
}

/** Quotes a string scalar; a number is restored from its source text, so `1.10` stays `"1.10"`. */
function quote(node: unknown): void {
  if (isScalar(node) === false) return
  if (typeof node.value === 'number') node.value = node.source ?? String(node.value)
  if (typeof node.value === 'string') node.type = Scalar.QUOTE_DOUBLE
}

function quoteItems(node: unknown): void {
  if (isSeq(node)) node.items.forEach(quote)
}

function quoteVersions(node: unknown): void {
  if (isScalar(node)) quote(node)
  else if (isMap(node)) for (const pair of node.items) quote(pair.value)
}

function idOf(node: unknown): string {
  if (isMap(node) === false) return ''
  const id = node.get('id')
  return typeof id === 'string' || typeof id === 'number' ? String(id) : ''
}

export interface FormatPlan {
  changes: FileChange[]
  /** Files that do not parse; they are left untouched. */
  skipped: string[]
}

/** Every write and rename `almanac fmt` would make. Counter fixes come from `lint --fix`. */
export function planFormat(workspace: Workspace, counterFixes: readonly CounterFix[] = []): FormatPlan {
  const writes: FileChange[] = []
  const skipped: string[] = []
  for (const file of allFiles(workspace)) {
    const parsed = parseYaml(file.text)
    if (parsed.problems.length > 0) {
      skipped.push(file.path)
      continue
    }
    for (const fix of counterFixes) if (fix.file.absPath === file.absPath) parsed.doc.set(fix.key, fix.value)
    formatDocument(parsed.doc, file.kind)
    const content = serialize(parsed.doc)
    if (content !== file.text) writes.push({ kind: 'write', path: file.absPath, content, previous: file.text })
  }

  const renames: FileChange[] = []
  const taken = new Set<string>()
  const rename = (from: string, to: string) => {
    if (from === to || taken.has(to) || workspace.fs.exists(to)) return
    taken.add(to)
    renames.push({ kind: 'rename', from, to })
  }
  for (const dir of workspace.categories) {
    for (const feature of dir.features) {
      if (feature.parsed.problems.length > 0) continue
      const { id, name } = identity(feature.parsed.doc)
      if (typeof id !== 'string' || FEATURE_ID_RE.test(id) === false || typeof name !== 'string') continue
      const expected = featureFileName(id, name)
      if (basename(feature.absPath) !== expected) rename(feature.absPath, join(dir.absDir, expected))
    }
    if (dir.file === undefined || dir.file.parsed.problems.length > 0) continue
    const { id, name } = identity(dir.file.parsed.doc)
    if (typeof id !== 'number' || Number.isInteger(id) === false || id < 1 || typeof name !== 'string') continue
    const expected = categoryDirName(id, name)
    if (dir.dirName !== expected) rename(dir.absDir, join(workspace.root, expected))
  }
  // Feature renames happen inside their current folder, before the folder itself is renamed.
  return { changes: [...writes, ...renames], skipped }
}

function identity(doc: Document): { id: unknown; name: unknown } {
  const value = plainValue(doc)
  if (value === null || typeof value !== 'object') return { id: undefined, name: undefined }
  const record = value as Record<string, unknown>
  return { id: record.id, name: record.name }
}
