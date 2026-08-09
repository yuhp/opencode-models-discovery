import { describe, it, expect } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'
import { modelsDevTestUtils } from '../src/utils/models-dev-fetcher'

const modelsDevFixture = modelsDevTestUtils.parseModelsDevData({
  anthropic: {
    models: {
      'claude-x': {
        id: 'claude-x',
        name: 'Claude X',
        attachment: true,
        reasoning: true,
        tool_call: true,
        temperature: false,
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        limit: { context: 1000000, output: 128000 },
        cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
        reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh', 'max'] }],
      },
      'claude-compact': {
        id: 'claude-compact',
        name: 'Claude Compact',
        attachment: true,
        reasoning: true,
        tool_call: true,
        temperature: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 1, output: 5 },
        reasoning_options: [{ type: 'budget_tokens', min: 1024 }],
      },
    },
  },
  'some-gateway': {
    models: {
      'claude-x': {
        id: 'claude-x',
        name: 'Claude X (Reseller)',
        reasoning: true,
        tool_call: true,
        limit: { context: 131072, output: 8192 },
        cost: { input: 99, output: 99 },
      },
      'gateway-only-model': {
        id: 'gateway-only-model',
        name: 'Gateway Only A',
        limit: { context: 4096, output: 4096 },
      },
    },
  },
  'other-gateway': {
    models: {
      'gateway-only-model': {
        id: 'gateway-only-model',
        name: 'Gateway Only B',
        limit: { context: 8192, output: 8192 },
      },
    },
  },
  'vendor-pass': {
    models: {
      'vendor-pass/open-model': {
        id: 'vendor-pass/open-model',
        name: 'Open Model',
        attachment: false,
        reasoning: true,
        tool_call: true,
        temperature: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 512000, output: 131072 },
        cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
        reasoning_options: [{ type: 'effort', values: ['high', 'max'] }],
      },
    },
  },
})

function createEnricher() {
  const enricher = createModelInfoEnricher(ModelInfoFormat.OmniRoute, modelsDevFixture)
  expect(enricher).toBeDefined()
  return enricher!
}

describe('OmniRoute model info enricher', () => {
  it('extracts inline catalog metadata including effort-tier variants', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'cx/gpt-y' }
    const rawModel: Record<string, unknown> = {
      id: 'cx/gpt-y',
      name: 'cx/GPT Y',
      family: 'gpt-y',
      release_date: '2026-07-09',
      capabilities: {
        vision: true,
        tool_calling: true,
        reasoning: true,
        thinking: true,
        effort_tiers: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
        attachment: true,
        structured_output: true,
        temperature: false,
      },
      input_modalities: ['text', 'image', 'pdf'],
      output_modalities: ['text'],
      context_length: 272000,
      max_input_tokens: 272000,
      max_output_tokens: 128000,
      pricing: { input: 5, output: 30, cached: 0.5, cache_creation: 6.25 },
    }

    expect(enricher.getModelName?.(modelConfig.id, rawModel)).toBe('cx/GPT Y')
    enricher.applyModelInfo(modelConfig, modelConfig.id, rawModel)

    expect(modelConfig).toMatchObject({
      limit: { context: 272000, input: 272000, output: 128000 },
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
      reasoning: true,
      tool_call: true,
      attachment: true,
      temperature: false,
      structured_output: true,
      family: 'gpt-y',
      release_date: '2026-07-09',
      cost: { input: 5, output: 30, cache_read: 0.5, cache_write: 6.25 },
    })
    expect(modelConfig.variants).toEqual({
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      high: { reasoningEffort: 'high' },
      xhigh: { reasoningEffort: 'xhigh' },
      max: { reasoningEffort: 'max' },
      ultra: { reasoningEffort: 'ultra' },
    })
  })

  it('fills missing fields from models.dev and prefers first-party entries on ambiguity', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'cc/claude-x' }
    const rawModel: Record<string, unknown> = {
      id: 'cc/claude-x',
      capabilities: {
        reasoning: true,
        effort_tiers: ['none', 'low', 'medium', 'high', 'xhigh'],
      },
      context_length: 500000,
    }

    enricher.applyModelInfo(modelConfig, modelConfig.id, rawModel)

    // context from the gateway wins; output, modalities, flags, and cost come
    // from the first-party anthropic entry, not the reseller entry.
    expect(modelConfig.limit).toEqual({ context: 500000, output: 128000 })
    expect(modelConfig.modalities).toEqual({ input: ['text', 'image', 'pdf'], output: ['text'] })
    expect(modelConfig).toMatchObject({
      reasoning: true,
      tool_call: true,
      attachment: true,
      temperature: false,
      cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 },
    })
    // inline effort tiers still win over models.dev reasoning_options
    expect(Object.keys(modelConfig.variants)).toEqual(['none', 'low', 'medium', 'high', 'xhigh'])
  })

  it('falls back to models.dev effort values when the gateway serves no effort tiers', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'cp/vendor-pass/open-model' }
    const rawModel: Record<string, unknown> = {
      id: 'cp/vendor-pass/open-model',
      capabilities: { reasoning: true, tool_calling: true },
      context_length: 512000,
      max_output_tokens: 131072,
    }

    enricher.applyModelInfo(modelConfig, modelConfig.id, rawModel)

    expect(modelConfig.variants).toEqual({
      high: { reasoningEffort: 'high' },
      max: { reasoningEffort: 'max' },
    })
    expect(modelConfig.cost).toEqual({ input: 1.4, output: 4.4, cache_read: 0.26 })
  })

  it('falls back to models.dev thinking budgets when only budget_tokens is available', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'cc/claude-compact' }
    const rawModel: Record<string, unknown> = {
      id: 'cc/claude-compact',
      capabilities: { reasoning: true },
      context_length: 200000,
      max_output_tokens: 64000,
    }

    enricher.applyModelInfo(modelConfig, modelConfig.id, rawModel)

    expect(modelConfig.variants).toEqual({
      high: { thinking: { type: 'enabled', budgetTokens: 16000 } },
      max: { thinking: { type: 'enabled', budgetTokens: 31999 } },
    })
  })

  it('does not generate variants for non-reasoning models', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'cp/vendor-pass/open-model' }

    enricher.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      capabilities: { reasoning: false, tool_calling: true },
      context_length: 512000,
    })

    expect(modelConfig.reasoning).toBe(false)
    expect(modelConfig.variants).toBeUndefined()
  })

  it('gives up on ambiguous fallback lookups without a preferred first-party provider', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'xy/gateway-only-model' }

    enricher.applyModelInfo(modelConfig, modelConfig.id, { id: modelConfig.id })

    expect(modelConfig.limit).toBeUndefined()
    expect(modelConfig.cost).toBeUndefined()
    expect(modelConfig.modalities).toBeUndefined()
  })

  it('leaves missing or malformed metadata unset and preserves zero prices', () => {
    const enricher = createEnricher()
    const modelConfig: any = { id: 'unknown/mystery-model' }

    enricher.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      capabilities: { effort_tiers: [1, '', null] },
      input_modalities: ['TEXT', 'unsupported', 2],
      context_length: -5,
      max_output_tokens: 'many',
      pricing: { input: 0, output: 0 },
    })

    expect(modelConfig).toEqual({
      id: 'unknown/mystery-model',
      modalities: { input: ['text'] },
      cost: { input: 0, output: 0 },
    })
    expect(modelConfig.limit).toBeUndefined()
    expect(modelConfig.variants).toBeUndefined()
  })
})
