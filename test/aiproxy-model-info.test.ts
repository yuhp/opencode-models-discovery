import { describe, expect, it } from 'vitest'
import { createAIProxyEnricher } from '../src/utils/model-info/aiproxy'

describe('native AIProxy model enricher', () => {
  it('overlays inline pricing, token limits, and supported reasoning efforts', () => {
    const enricher = createAIProxyEnricher(new Map([['gpt-6-luna', {
      id: 'gpt-6-luna',
      name: 'GPT-6 Luna',
      reasoning: true,
      limit: { context: 1_050_000, input: 900_000, output: 32_000 },
    }]]))
    const result = enricher.enrich({
      id: 'gpt-6-luna',
      limits: { max_input_tokens: 922_000, max_output_tokens: 128_000 },
      pricing: { input_per_1m_usd: 0.1, output_per_1m_usd: 0.5, cache_read_per_1m_usd: 0.01 },
      capabilities: { reasoning: true, effort_tiers: ['low', 'medium', 'high', 'xhigh', 'max'] },
    }, { filterNonChat: true })

    expect(result).toEqual({
      metadataName: 'GPT-6 Luna',
      limit: { context: 1_050_000, input: 922_000, output: 128_000 },
      cost: { input: 0.1, output: 0.5, cache_read: 0.01 },
      reasoning: true,
      variants: {
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        high: { reasoningEffort: 'high' },
        xhigh: { reasoningEffort: 'xhigh' },
        max: { reasoningEffort: 'max' },
      },
    })
  })

  it('preserves zero prices and ignores malformed inline metadata', () => {
    const enricher = createAIProxyEnricher(new Map([['custom-model', {
      id: 'custom-model',
      limit: { context: 32_000, output: 4_000 },
      cost: { input: 2, output: 3 },
    }]]))
    const result = enricher.enrich({
      id: 'custom-model',
      limits: { max_input_tokens: '32000', max_output_tokens: Number.POSITIVE_INFINITY },
      pricing: { input_per_1m_usd: 0, output_per_1m_usd: 'unknown', cache_read_per_1m_usd: -1 },
      capabilities: { reasoning: true, effort_tiers: ['xhigh', 'ultra', 1] },
    }, { filterNonChat: true })

    expect(result).toEqual({
      limit: { context: 32_000, output: 4_000 },
      cost: { input: 0 },
      reasoning: true,
      variants: { xhigh: { reasoningEffort: 'xhigh' } },
    })
  })

  it('leaves absent metadata unset', () => {
    expect(createAIProxyEnricher(null).enrich({
      id: 'unknown-model',
      limits: 'invalid',
      pricing: null,
      capabilities: { effort_tiers: ['unsupported'] },
    }, { filterNonChat: true })).toEqual({ variants: {} })
  })
})
