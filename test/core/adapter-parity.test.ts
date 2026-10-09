import { describe, expect, it } from 'vitest'
import { discoverModelDrafts } from '../../src/core/discovery-pipeline'
import { mapToV1Model, mapToDiscoveredV2Model } from '../../src/core/model-mapper'
import { createBifrostEnricher } from '../../src/utils/model-info/bifrost'
import { createVLLMEnricher } from '../../src/utils/model-info/vllm'

describe('end-to-end V1 and V2 adapter projection parity', () => {
  const rawProviderModels = [
    {
      id: 'qwen/qwen-2.5-72b-instruct',
      object: 'model',
      owned_by: 'qwen',
      max_model_len: 32768,
    },
    {
      id: 'bedrock/anthropic.claude-sonnet-4-6',
      object: 'model',
      name: 'Claude Sonnet 4.6',
      context_length: 200000,
      max_output_tokens: 8192,
      capabilities: { tool_calling: true, vision: true },
      architecture: { input_modalities: ['TEXT', 'IMAGE'], output_modalities: ['TEXT'] },
    },
    {
      id: 'text-embedding-3-small',
      object: 'model',
      owned_by: 'openai',
    },
    {
      id: 'deepseek-reasoner',
      object: 'model',
      owned_by: 'deepseek',
      context_length: 64000,
      max_output_tokens: 8000,
      capabilities: { reasoning: true, tool_calling: true },
    },
  ]

  it('projects identical model IDs, names, limits, and capabilities across V1 and V2', () => {
    const pipelineConfig = {
      filter: {
        includeBy: [],
        excludeBy: [],
        includeRegex: [],
        excludeRegex: [],
      },
      smartModelName: true,
      enricher: createBifrostEnricher(null),
    }

    const drafts = discoverModelDrafts(rawProviderModels, pipelineConfig)

    const v1Models = drafts.map((draft) => mapToV1Model(draft, { smartModelName: true }))
    const v2Models = drafts.map((draft) => mapToDiscoveredV2Model(draft, { smartModelName: true }))

    // 1. Both adapters must discover the exact same model set (embedding filtered out by non-chat classifier)
    const v1Ids = v1Models.map((m) => m.id).sort()
    const v2Ids = v2Models.map((m) => m.id).sort()
    expect(v1Ids).toEqual([
      'bedrock/anthropic.claude-sonnet-4-6',
      'deepseek-reasoner',
      'qwen/qwen-2.5-72b-instruct',
    ])
    expect(v2Ids).toEqual(v1Ids)

    // 2. Exact display name parity
    const v1Names = Object.fromEntries(v1Models.map((m) => [m.id, m.name]))
    const v2Names = Object.fromEntries(v2Models.map((m) => [m.id, m.name]))
    expect(v2Names).toEqual(v1Names)

    // 3. Exact Context and Output Limit parity for enriched models
    for (const v1 of v1Models) {
      if (v1.limit) {
        const v2 = v2Models.find((m) => m.id === v1.id)!
        expect(v2.limit.context).toBe(v1.limit.context)
        expect(v2.limit.output).toBe(v1.limit.output)
      }
    }

    // 4. Parity of capabilities: tools and reasoning when provided on draft
    for (const v1 of v1Models) {
      const v2 = v2Models.find((m) => m.id === v1.id)!
      if (v1.reasoning !== undefined) {
        expect(v2.reasoning).toBe(v1.reasoning)
      }
      if (v1.tool_call !== undefined) {
        expect(v2.capabilities.tools).toBe(v1.tool_call)
      }
    }
  })

  it('maintains strict parity when custom filters and vLLM enricher are applied', () => {
    const pipelineConfig = {
      filter: {
        includeBy: [{ field: 'owned_by', equals: 'qwen' }],
        excludeBy: [],
        includeRegex: [],
        excludeRegex: [],
      },
      smartModelName: false,
      enricher: createVLLMEnricher(null),
    }

    const drafts = discoverModelDrafts(rawProviderModels, pipelineConfig)
    const v1Models = drafts.map((draft) => mapToV1Model(draft))
    const v2Models = drafts.map((draft) => mapToDiscoveredV2Model(draft, { smartModelName: false }))

    expect(v1Models).toHaveLength(1)
    expect(v2Models).toHaveLength(1)

    const v1 = v1Models[0]!
    const v2 = v2Models[0]!

    expect(v1.id).toBe('qwen/qwen-2.5-72b-instruct')
    expect(v2.id).toBe('qwen/qwen-2.5-72b-instruct')
    // smartModelName: false preserves exact raw ID as name
    expect(v1.name).toBe('qwen/qwen-2.5-72b-instruct')
    expect(v2.name).toBe('qwen/qwen-2.5-72b-instruct')
    // vLLM max_model_len sets context and bounded output
    expect(v1.limit?.context).toBe(32768)
    expect(v1.limit?.output).toBe(32768)
    expect(v2.limit.context).toBe(32768)
    expect(v2.limit.output).toBe(32768)
  })

  it('guarantees identical modalities, reasoning, and tools for fully-enriched models', () => {
    const fullyEnrichedRaw = [
      {
        id: 'oc/omni-chat-v1',
        object: 'model',
        owned_by: 'omniroute',
        context_length: 128000,
        max_output_tokens: 8192,
        input_modalities: ['TEXT', 'IMAGE'],
        output_modalities: ['TEXT'],
        capabilities: { vision: true, tool_calling: true, reasoning: true },
      },
    ]

    const drafts = discoverModelDrafts(fullyEnrichedRaw, {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher: {
        enrich: () => ({
          metadataName: 'Omni Chat v1',
          limit: { context: 128000, output: 8192 },
          modalities: { input: ['text', 'image'], output: ['text'] },
          reasoning: true,
          toolCall: true,
          cost: { input: 1.5, output: 3.0 },
        }),
      },
    })

    const v1 = mapToV1Model(drafts[0]!)
    const v2 = mapToDiscoveredV2Model(drafts[0]!, { smartModelName: true })

    expect(v1.name).toBe('Omni Chat v1')
    expect(v2.name).toBe('Omni Chat v1')
    expect(v1.limit).toEqual({ context: 128000, output: 8192 })
    expect(v2.limit).toEqual({ context: 128000, output: 8192 })
    expect(v1.reasoning).toBe(true)
    expect(v2.reasoning).toBe(true)
    expect(v1.tool_call).toBe(true)
    expect(v2.capabilities.tools).toBe(true)
    expect(v1.modalities?.input).toEqual(['text', 'image'])
    expect(v2.capabilities.input).toEqual(['text', 'image'])
  })

  it('projects Bifrost context-only models with reasoning variants correctly across V1 and V2', () => {
    const raw = [
      {
        id: 'vllm/qwen-thinking',
        context_length: 131072,
        reasoning: {
          supported_efforts: ['low', 'medium', 'high'],
          default_effort: 'medium',
        },
      },
    ]

    const drafts = discoverModelDrafts(raw, {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: true,
      enricher: createBifrostEnricher(null),
    })

    const v1 = mapToV1Model(drafts[0]!)
    const v2 = mapToDiscoveredV2Model(drafts[0]!, { smartModelName: true })

    expect(v1.limit?.context).toBe(131072)
    expect(v1.limit?.output).toBeUndefined()
    expect(v1.reasoning).toBe(true)
    expect(v1.variants).toEqual({
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      high: { reasoningEffort: 'high' },
    })

    expect(v2.limit.context).toBe(131072)
    expect(v2.limit.output).toBe(32000)
    expect(v2.reasoning).toBe(true)
    expect(v2.variants).toEqual([
      { id: 'low', settings: { reasoningEffort: 'low' } },
      { id: 'medium', settings: { reasoningEffort: 'medium' } },
      { id: 'high', settings: { reasoningEffort: 'high' } },
    ])
  })
})
