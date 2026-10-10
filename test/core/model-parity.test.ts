import { describe, expect, it } from 'vitest'
import { discoverModelDrafts } from '../../src/core/discovery-pipeline'
import { mapToV1Model } from '../../src/core/model-mapper'
import { mapToDiscoveredV2Model } from '../../src/core/model-mapper'
import type { ProviderDiscoveryOptions } from '../../src/v2/provider-config'
import { createModelsDevEnricher } from '../../src/utils/model-info/models-dev'
import { createBifrostEnricher } from '../../src/utils/model-info/bifrost'
import { createVLLMEnricher } from '../../src/utils/model-info/vllm'
import { createLlamaSwapEnricher } from '../../src/utils/model-info/llamaswap'
import { createOmniRouteEnricher } from '../../src/utils/model-info/omniroute'
import { createLMStudioEnricher } from '../../src/utils/model-info/lmstudio'
import { createAIProxyEnricher } from '../../src/utils/model-info/aiproxy'

const options: ProviderDiscoveryOptions = {
  enabled: true,
  endpoint: '/v1/models',
  timeoutMs: 5_000,
  includeRegex: [],
  excludeRegex: [],
  includeBy: [],
  excludeBy: [],
  smartModelName: true,
  filterNonChat: true,
}

describe('V1/V2 shared-core parity', () => {
  it('produces the same IDs and display names for equivalent raw responses', () => {
    const rawModels = [
      { id: 'openai/gpt-5', owned_by: 'openai' },
      { id: 'github-copilot/gpt-5', owned_by: 'github-copilot' },
      { id: 'qwen/qwen3-30b' },
      { id: 'text-embedding-3-large' },
    ]
    const filter = {
      includeBy: [],
      excludeBy: [],
      includeRegex: [],
      excludeRegex: [],
    }

    const drafts = discoverModelDrafts(rawModels, { filter, smartModelName: true })
    const v1Projection = drafts.map((draft) => ({ id: draft.id, name: draft.name }))
    const v2Projection = drafts.map((draft) => {
      const model = mapToDiscoveredV2Model(draft, options)
      return { id: model.modelID, name: model.name }
    })

    expect(v1Projection).toEqual(v2Projection)
    expect(v1Projection).toEqual([
      { id: 'openai/gpt-5', name: 'GPT 5 (Openai)' },
      { id: 'github-copilot/gpt-5', name: 'GPT 5 (Github Copilot)' },
      { id: 'qwen/qwen3-30b', name: 'Qwen3 30B' },
    ])
  })

  it('keeps IDs unchanged when smart names are disabled', () => {
    const rawModels = [{ id: 'openai/gpt-5' }]
    const drafts = discoverModelDrafts(rawModels, { filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] }, smartModelName: false })
    const mapped = mapToDiscoveredV2Model(drafts[0], { ...options, smartModelName: false })

    expect(drafts[0]).toMatchObject({ id: 'openai/gpt-5', name: 'openai/gpt-5' })
    expect(mapped).toMatchObject({ id: 'openai/gpt-5', modelID: 'openai/gpt-5', name: 'openai/gpt-5' })
  })

  it('keeps native models.dev enrichment equivalent for V1 drafts and V2 models', () => {
    const enricher = createModelsDevEnricher(new Map([
      ['openai/gpt-5', {
        id: 'openai/gpt-5',
        name: 'GPT 5',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 128_000, output: 16_384 },
      }],
    ]))
    const drafts = discoverModelDrafts([{ id: 'openai/gpt-5' }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher,
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect({
      id: draft.id,
      name: draft.name,
      limit: draft.limit,
      modalities: draft.modalities,
      reasoning: draft.reasoning,
      toolCall: draft.toolCall,
    }).toEqual({
      id: mapped.modelID,
      name: mapped.name,
      limit: { context: 128_000, output: 16_384 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      reasoning: true,
      toolCall: mapped.capabilities.tools,
    })
  })

  it('keeps native Bifrost enrichment equivalent for V1 drafts and V2 models', () => {
    const enricher = createBifrostEnricher(null)
    const drafts = discoverModelDrafts([{
      id: 'bedrock/claude-sonnet',
      context_length: 200_000,
      max_input_tokens: 200_000,
      max_output_tokens: 8_192,
      normalized_name: 'Claude Sonnet',
      architecture: { input_modalities: ['TEXT', 'IMAGE', 'SPEECH'], output_modalities: ['TEXT'] },
      pricing: { prompt: '0.000003', completion: '0.000015' },
    }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher,
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect(draft.name).toBe('Claude Sonnet')
    expect(draft.limit).toEqual({ context: 200_000, input: 200_000, output: 8_192 })
    expect(draft.modalities).toEqual({ input: ['text', 'image', 'audio'], output: ['text'] })
    expect(draft.cost).toEqual({ input: 3, output: 15 })
    expect(mapped.name).toBe(draft.name)
    expect(mapped.limit).toEqual(draft.limit)
    expect(mapped.capabilities.input).toEqual(draft.modalities?.input)
    expect(mapped.cost).toEqual([{ input: 3, output: 15, cache: { read: 0, write: 0 } }])
  })

  it('keeps native vLLM limits equivalent for V1 drafts and V2 models', () => {
    const drafts = discoverModelDrafts([{ id: 'vllm/model', max_model_len: 32_768 }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher: createVLLMEnricher(null),
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect(draft.limit).toEqual({ context: 32_768, output: 32_768 })
    expect(mapped.limit).toEqual(draft.limit)
  })

  it('keeps native llama-swap enrichment equivalent for V1 drafts and V2 models', () => {
    const drafts = discoverModelDrafts([{
      id: 'llama-swap/gemma',
      name: 'Gemma',
      meta: { n_ctx: 16_384, llamaswap: { max_output_tokens: 2_048 } },
      supported_parameters: ['tools'],
    }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher: createLlamaSwapEnricher(null),
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect(draft.name).toBe('Gemma')
    expect(draft.limit).toEqual({ context: 16_384, output: 2_048 })
    expect(draft.toolCall).toBe(true)
    expect(mapped.name).toBe('Gemma')
    expect(mapped.limit).toEqual(draft.limit)
    expect(mapped.capabilities.tools).toBe(true)
  })

  it('keeps native OmniRoute enrichment equivalent for V1 drafts and V2 models', () => {
    const drafts = discoverModelDrafts([{
      id: 'omniroute/vision',
      input_modalities: ['text', 'image'],
      capabilities: { reasoning: true, tool_calling: true, effort_tiers: ['low', 'high'] },
      context_length: 64_000,
      max_output_tokens: 4_096,
    }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher: createOmniRouteEnricher(null),
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect(draft.limit).toEqual({ context: 64_000, output: 4_096 })
    expect(draft.toolCall).toBe(true)
    expect(draft.reasoning).toBe(true)
    expect(mapped.limit).toEqual(draft.limit)
    expect(mapped.capabilities.tools).toBe(true)
    expect(mapped.reasoning).toBe(true)
  })

  it('keeps native LM Studio enrichment equivalent for V1 drafts and V2 models', () => {
    const enricher = createLMStudioEnricher({ models: [{
      key: 'lmstudio/gemma',
      display_name: 'Gemma Local',
      max_context_length: 8192,
      capabilities: { vision: true, trained_for_tool_use: true },
    }] })
    const drafts = discoverModelDrafts([{ id: 'lmstudio/gemma' }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher,
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect(draft.name).toBe('Gemma Local')
    expect(draft.limit).toEqual({ context: 8192, output: 8192 })
    expect(draft.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
    expect(draft.toolCall).toBe(true)
    expect(mapped.name).toBe('Gemma Local')
    expect(mapped.limit).toEqual({ context: 8192, output: 8192 })
    expect(mapped.capabilities.input).toEqual(['text', 'image'])
    expect(mapped.capabilities.tools).toBe(true)
  })

  it('keeps native AIProxy enrichment equivalent for V1 drafts and V2 models', () => {
    const enricher = createAIProxyEnricher(new Map([['openai/gpt-6', {
      id: 'openai/gpt-6',
      name: 'GPT 6',
      reasoning: true,
      tool_call: true,
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 1_000_000, output: 32_000 },
    }]]))
    const drafts = discoverModelDrafts([{
      id: 'openai/gpt-6',
      limits: { max_input_tokens: 900_000, max_output_tokens: 64_000 },
      pricing: { input_per_1m_usd: 0.2, output_per_1m_usd: 0.8 },
      capabilities: { reasoning: true, effort_tiers: ['low', 'high'] },
    }], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher,
      enrichmentContext: { filterNonChat: true },
    })
    const draft = drafts[0]!
    const mapped = mapToDiscoveredV2Model(draft, options)

    expect(draft.name).toBe('GPT 6')
    expect(draft.limit).toEqual({ context: 1_000_000, output: 64_000, input: 900_000 })
    expect(draft.cost).toEqual({ input: 0.2, output: 0.8 })
    expect(draft.reasoning).toBe(true)
    expect(draft.variants).toEqual({ low: { reasoningEffort: 'low' }, high: { reasoningEffort: 'high' } })
    expect(mapped.name).toBe('GPT 6')
    expect(mapped.limit).toEqual(draft.limit)
    expect(mapped.capabilities.tools).toBe(true)
    expect(mapped.cost).toEqual([{ input: 0.2, output: 0.8, cache: { read: 0, write: 0 } }])
  })
})
