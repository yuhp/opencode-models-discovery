import { describe, expect, it } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

describe('LM Studio model info enricher', () => {
  it('maps loaded context and capabilities from an inventory model', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LMStudio, { models: [{
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
    }] })
    expect(enricher).toBeDefined()

    const config: any = {
      id: 'google/gemma-4',
      modalities: { input: ['text'], output: ['text'] },
    }
    enricher!.applyModelInfo(config, 'google/gemma-4')

    expect(enricher!.getModelName?.('google/gemma-4')).toBe('Gemma 4')
    expect(config.limit.context).toEqual(16384)
    expect(config.limit.output).toEqual(0)
    expect(config.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
    expect(config.tool_call).toBe(true)
    expect(config.reasoning).toBe(true)
    expect(config.variants).toEqual({
      off: { reasoningEffort: 'none' },
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      xhigh: { reasoningEffort: 'xhigh' },
    })
  })

  it('falls back to max context length and uses zero for an unknown output limit', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LMStudio, { models: [{
      type: 'llm',
      key: 'local/model',
      max_context_length: 4096,
      loaded_instances: [{ config: { context_length: 0 } }],
    }] })
    const config: any = { id: 'local/model' }

    enricher!.applyModelInfo(config, 'local/model')
    expect(config.limit.context).toEqual(4096)
    expect(config.limit.output).toEqual(0)
    expect(config.modalities).toBeUndefined()
    expect(config.reasoning).toBeUndefined()
    expect(config.tool_call).toBeUndefined()
  })

  it('ignores incomplete instances, unknown reasoning options, and on', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LMStudio, { models: [{
      key: 'partial/model',
      loaded_instances: [{}, { config: {} }, { config: { context_length: 2048 } }],
      capabilities: { reasoning: { allowed_options: ['custom', 'on', 'medium'] } },
    }] })
    const config: any = { id: 'partial/model' }

    enricher!.applyModelInfo(config, 'partial/model')

    expect(config.limit.context).toEqual(2048)
    expect(config.limit.output).toEqual(0)
    expect(config.reasoning).toBe(true)
    expect(config.variants).toEqual({ medium: { reasoningEffort: 'medium' } })
  })

  it('does not enrich unknown models', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LMStudio, { models: [] })
    const config: any = { id: 'missing' }

    enricher!.applyModelInfo(config, 'missing')
    expect(config).toEqual({ id: 'missing' })
  })
})
