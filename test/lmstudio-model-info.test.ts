import { describe, expect, it } from 'vitest'
import { createLMStudioEnricher } from '../src/utils/model-info/lmstudio'

describe('native LM Studio enricher', () => {
  it('maps loaded context and capabilities from an inventory model', () => {
    const result = createLMStudioEnricher({ models: [{
      type: 'llm',
      key: 'google/gemma-4',
      display_name: 'Gemma 4',
      max_context_length: 131072,
      loaded_instances: [{ config: { context_length: 8192 } }, { config: { context_length: 16384 } }],
      capabilities: {
        vision: true,
        trained_for_tool_use: true,
        reasoning: { allowed_options: ['off', 'low', 'medium', 'xhigh', 'on'] },
      },
    }] }).enrich({ id: 'google/gemma-4' }, { filterNonChat: true })

    expect(result).toEqual({
      metadataName: 'Gemma 4',
      limit: { context: 16384, output: 16384 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      toolCall: true,
      reasoning: true,
      variants: {
        off: { reasoningEffort: 'none' },
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        xhigh: { reasoningEffort: 'xhigh' },
      },
    })
  })

  it('falls back to max context length and resolves safe default output limit', () => {
    const result = createLMStudioEnricher({ models: [{
      key: 'local/model',
      max_context_length: 4096,
      loaded_instances: [{ config: { context_length: 0 } }],
    }] }).enrich({ id: 'local/model' }, { filterNonChat: true })

    expect(result).toEqual({ limit: { context: 4096, output: 4096 } })
  })

  it('caps output limit at DEFAULT_OUTPUT_TOKEN_LIMIT for large context windows', () => {
    const result = createLMStudioEnricher({ models: [{
      key: 'large/model',
      max_context_length: 131072,
    }] }).enrich({ id: 'large/model' }, { filterNonChat: true })

    expect(result).toEqual({ limit: { context: 131072, output: 32000 } })
  })

  it('ignores incomplete instances and unknown reasoning options', () => {
    const result = createLMStudioEnricher({ models: [{
      key: 'partial/model',
      loaded_instances: [{}, { config: {} }, { config: { context_length: 2048 } }],
      capabilities: { reasoning: { allowed_options: ['custom', 'on', 'medium'] } },
    }] }).enrich({ id: 'partial/model' }, { filterNonChat: true })

    expect(result).toEqual({
      limit: { context: 2048, output: 2048 },
      reasoning: true,
      variants: { medium: { reasoningEffort: 'medium' } },
    })
  })

  it('does not enrich unknown models', () => {
    expect(createLMStudioEnricher({ models: [] }).enrich({ id: 'missing' }, { filterNonChat: true })).toEqual({})
  })
})
