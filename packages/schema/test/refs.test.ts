import { describe, expect, it } from 'vitest'
import { compareIds, idLevel, jsonSchema, localNumber, parentId, parseRef } from '@feature-almanac/schema'

describe('parseRef', () => {
  it('parses each level, prefixes and variant refs', () => {
    expect(parseRef('1')).toEqual({ id: '1', level: 'category' })
    expect(parseRef('1.2')).toEqual({ id: '1.2', level: 'feature' })
    expect(parseRef('PD-1.2.3')).toEqual({ id: '1.2.3', level: 'behaviour', prefix: 'PD' })
    expect(parseRef('1.2.3@android')).toEqual({ id: '1.2.3', level: 'behaviour', platform: 'android' })
  })

  it('rejects malformed refs and platforms on non-behaviours', () => {
    for (const bad of ['0', '1.0', '01.2', '1.2.3.4', 'pd-1.2', '1.2@ios', '1.2.3@iOS', '']) {
      expect(parseRef(bad), bad).toBeUndefined()
    }
  })
})

describe('ID helpers', () => {
  it('orders numerically, not lexically', () => {
    expect(['1.10', '1.2', '2', '1.2.1'].sort(compareIds)).toEqual(['1.2', '1.2.1', '1.10', '2'])
  })

  it('splits IDs', () => {
    expect(parentId('1.2.3')).toBe('1.2')
    expect(parentId('1')).toBeUndefined()
    expect(localNumber('1.2.13')).toBe(13)
    expect(idLevel('4.5')).toBe('feature')
  })
})

describe('jsonSchema', () => {
  it('exports each file schema as JSON Schema', () => {
    for (const kind of ['config', 'category', 'feature'] as const) {
      const schema = jsonSchema(kind)
      expect(schema.type).toBe('object')
      expect(schema.additionalProperties).toBe(false)
    }
  })
})
