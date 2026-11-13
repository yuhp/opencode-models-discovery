import { describe, expect, it } from 'vitest'
import { createModelsDevEnricher } from '../src/utils/model-info/models-dev'

function catalog(id: string, limit: { context?: number; input?: number; output?: number }, extra: Record<string, unknown> = {}) {
  return new Map([[id, { id, limit, ...extra }]])
}

describe('models.dev model enricher', () => {
  it('prefers limits advertised by the provider over the models.dev catalog', () => {
    const enricher = createModelsDevEnricher(catalog('deepseek/deepseek-v4.1-flash', {
      context: 1_048_576,
      output: 393_216,
    }))

    const result = enricher.enrich({
      id: 'deepseek/deepseek-v4.1-flash',
      context_length: 1_000_000,
      max_completion_tokens: 384_000,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 1_000_000, output: 384_000 })
  })

  it('accepts max_context_length and max_output_tokens aliases', () => {
    const enricher = createModelsDevEnricher(catalog('custom-model', {
      context: 1_000_000,
      output: 384_000,
    }))

    const result = enricher.enrich({
      id: 'custom-model',
      max_context_length: 262_144,
      max_output_tokens: 65_536,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 262_144, output: 65_536 })
  })

  it('fills missing provider fields from the models.dev catalog', () => {
    const enricher = createModelsDevEnricher(catalog('custom-model', {
      context: 1_000_000,
      input: 900_000,
      output: 32_000,
    }))

    const result = enricher.enrich({
      id: 'custom-model',
      context_length: 200_000,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 200_000, input: 900_000, output: 32_000 })
  })

  it('keeps the models.dev context when the provider advertises output only', () => {
    const enricher = createModelsDevEnricher(catalog('custom-model', {
      context: 1_000_000,
      output: 393_216,
    }))

    const result = enricher.enrich({
      id: 'custom-model',
      max_completion_tokens: 128_000,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 1_000_000, output: 128_000 })
  })

  it('ignores malformed provider limits', () => {
    const enricher = createModelsDevEnricher(catalog('custom-model', {
      context: 128_000,
      output: 16_384,
    }))

    const result = enricher.enrich({
      id: 'custom-model',
      context_length: '128000',
      max_context_length: 0,
      max_completion_tokens: Number.POSITIVE_INFINITY,
      max_output_tokens: -1,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 128_000, output: 16_384 })
  })

  it('uses advertised context for models missing from the models.dev catalog', () => {
    const enricher = createModelsDevEnricher(new Map())

    const result = enricher.enrich({
      id: 'gateway-only-model',
      context_length: 64_000,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 64_000, output: 32_000 })
  })

  it('clamps advertised output to the advertised context', () => {
    const enricher = createModelsDevEnricher(new Map())

    const result = enricher.enrich({
      id: 'gateway-only-model',
      context_length: 64_000,
      max_completion_tokens: 128_000,
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 64_000, output: 64_000 })
  })
})
