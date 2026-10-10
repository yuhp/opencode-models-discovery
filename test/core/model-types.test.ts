import { describe, expect, it } from 'vitest'
import {
  createModelLimits,
  DEFAULT_CONTEXT_TOKEN_LIMIT,
  DEFAULT_OUTPUT_TOKEN_LIMIT,
  isDiscoveredRawModel,
  normalizeDiscoveredRawModel,
} from '../../src/core/model-types'
import { isValidModel } from '../../src/utils/openai-compatible-api'

describe('Discovered model normalization and validation', () => {
  it('accepts valid models with non-empty string IDs', () => {
    const valid = { id: 'gpt-4o', owned_by: 'openai', object: 'model' }
    expect(normalizeDiscoveredRawModel(valid)).toBe(valid)
    expect(isDiscoveredRawModel(valid)).toBe(true)
    expect(isValidModel(valid)).toBe(true)
  })

  it('preserves extra fields on valid models', () => {
    const raw = { id: 'custom-model', context_length: 32768, custom_meta: { foo: 'bar' } }
    const normalized = normalizeDiscoveredRawModel(raw)
    expect(normalized).toBe(raw)
    expect(normalized?.id).toBe('custom-model')
    expect(normalized?.context_length).toBe(32768)
  })

  it('rejects null, undefined, and non-object primitives', () => {
    const inputs = [null, undefined, '', 'model-id', 123, true, Symbol('model')]
    for (const input of inputs) {
      expect(normalizeDiscoveredRawModel(input)).toBeUndefined()
      expect(isDiscoveredRawModel(input)).toBe(false)
      expect(isValidModel(input)).toBe(false)
    }
  })

  it('rejects arrays', () => {
    const inputs = [[], [{ id: 'gpt-4' }]]
    for (const input of inputs) {
      expect(normalizeDiscoveredRawModel(input)).toBeUndefined()
      expect(isDiscoveredRawModel(input)).toBe(false)
      expect(isValidModel(input)).toBe(false)
    }
  })

  it('rejects objects missing id or with non-string id', () => {
    const inputs = [
      {},
      { name: 'gpt-4' },
      { id: null },
      { id: undefined },
      { id: 123 },
      { id: true },
      { id: {} },
    ]
    for (const input of inputs) {
      expect(normalizeDiscoveredRawModel(input)).toBeUndefined()
      expect(isDiscoveredRawModel(input)).toBe(false)
      expect(isValidModel(input)).toBe(false)
    }
  })

  it('rejects empty or whitespace-only string IDs', () => {
    const inputs = [
      { id: '' },
      { id: ' ' },
      { id: '   ' },
      { id: '\t' },
      { id: '\n' },
      { id: ' \r\n ' },
    ]
    for (const input of inputs) {
      expect(normalizeDiscoveredRawModel(input)).toBeUndefined()
      expect(isDiscoveredRawModel(input)).toBe(false)
      expect(isValidModel(input)).toBe(false)
    }
  })
})

describe('Model limit normalization (createModelLimits)', () => {
  it('returns undefined when context limit is missing or non-positive', () => {
    expect(createModelLimits(undefined)).toBeUndefined()
    expect(createModelLimits(0)).toBeUndefined()
    expect(createModelLimits(-1)).toBeUndefined()
    expect(createModelLimits(NaN)).toBeUndefined()
    expect(createModelLimits(Infinity)).toBeUndefined()
  })

  it('bounds output fallback by context when context < DEFAULT_OUTPUT_TOKEN_LIMIT', () => {
    const limits = createModelLimits(4096)
    expect(limits).toEqual({ context: 4096, output: 4096 })
  })

  it('caps output fallback at DEFAULT_OUTPUT_TOKEN_LIMIT when context >= DEFAULT_OUTPUT_TOKEN_LIMIT', () => {
    const limits = createModelLimits(128000)
    expect(limits).toEqual({ context: 128000, output: DEFAULT_OUTPUT_TOKEN_LIMIT })
  })

  it('preserves valid explicit output limits within context bounds', () => {
    const limits = createModelLimits(128000, 16384)
    expect(limits).toEqual({ context: 128000, output: 16384 })
  })

  it('bounds explicit output limit so it does not exceed context limit', () => {
    const limits = createModelLimits(4096, 8192)
    expect(limits).toEqual({ context: 4096, output: 4096 })
  })

  it('falls back to safe default output when explicit output is 0 or non-positive', () => {
    expect(createModelLimits(8192, 0)).toEqual({ context: 8192, output: 8192 })
    expect(createModelLimits(8192, -100)).toEqual({ context: 8192, output: 8192 })
    expect(createModelLimits(128000, 0)).toEqual({ context: 128000, output: DEFAULT_OUTPUT_TOKEN_LIMIT })
  })

  it('preserves optional positive input limits', () => {
    const limits = createModelLimits(32768, 4096, 28000)
    expect(limits).toEqual({ context: 32768, output: 4096, input: 28000 })
  })
})
