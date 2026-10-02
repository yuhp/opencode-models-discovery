import { describe, it, expect } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

describe('Bifrost model info enricher', () => {
  it('extracts documented inline metadata from a raw model', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'bedrock/anthropic.claude-sonnet-4-6' }
    const rawModel: Record<string, unknown> = {
      id: 'bedrock/anthropic.claude-sonnet-4-6',
      context_length: 200000,
      max_input_tokens: 200000,
      max_output_tokens: 8192,
      normalized_name: 'Claude Sonnet 4.6',
      architecture: {
        input_modalities: ['TEXT', 'IMAGE', 'SPEECH', 'unsupported'],
        output_modalities: ['TEXT'],
      },
      pricing: {
        prompt: '0.000003',
        completion: '0.000015',
      },
    }

    expect(enricher!.getModelName?.(modelConfig.id, rawModel)).toBe('Claude Sonnet 4.6')
    enricher!.applyModelInfo(modelConfig, modelConfig.id, rawModel)

    expect(modelConfig).toMatchObject({
      limit: { context: 200000, input: 200000, output: 8192 },
      modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
      cost: { input: 3, output: 15 },
    })
  })

  it('leaves missing or malformed metadata unset', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'openai/gpt-4o' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      context_length: 0,
      max_input_tokens: '128000',
      max_output_tokens: -1,
      architecture: { input_modalities: ['TEXT', 1, 'unsupported'], output_modalities: [] },
      pricing: { prompt: 'invalid', completion: -1 },
    })

    expect(modelConfig).toEqual({
      id: 'openai/gpt-4o',
      modalities: { input: ['text'] },
    })
    expect(modelConfig.limit).toBeUndefined()
    expect(modelConfig.cost).toBeUndefined()
  })

  it('preserves a reported zero price', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'local/free-model' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      pricing: { prompt: '0', completion: '0.000001' },
    })

    expect(modelConfig.cost).toEqual({ input: 0, output: 1 })
  })

  it('does not inject incomplete limits or costs', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'openai/gpt-4o' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      context_length: 128000,
      max_input_tokens: 128000,
      pricing: { prompt: '0.000003' },
    })

    expect(modelConfig.limit).toEqual({ context: 128000, input: 128000, output: 0 })
    expect(modelConfig.cost).toBeUndefined()
  })

  it('maps reasoning supported_efforts and default_effort to variants', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'vllm/chat-fast' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      context_length: 131072,
      reasoning: {
        supported_efforts: ['low', 'medium', 'xhigh'],
        default_effort: 'xhigh',
      },
    })

    expect(modelConfig.reasoning).toBe(true)
    expect(modelConfig.variants).toEqual({
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      xhigh: { reasoningEffort: 'xhigh', default: true },
    })
  })

  it('omits the default flag when default_effort is not a supported tier', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'vllm/reasoning' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      reasoning: {
        supported_efforts: ['low', 'high'],
        default_effort: 'medium',
      },
    })

    expect(modelConfig.reasoning).toBe(true)
    expect(modelConfig.variants).toEqual({
      low: { reasoningEffort: 'low' },
      high: { reasoningEffort: 'high' },
    })
  })

  it('ignores unsupported or malformed reasoning blocks', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'vllm/glm' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      context_length: 400000,
      reasoning: {
        supported_efforts: ['ultra', ''],
        default_effort: 'ultra',
      },
    })

    expect(modelConfig.variants).toBeUndefined()
    expect(modelConfig.reasoning).toBeUndefined()
    expect(modelConfig.limit).toEqual({ context: 400000, output: 0 })
  })

  it('does not emit variants when supported_efforts is absent', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.Bifrost, null)
    const modelConfig: any = { id: 'vllm/base' }

    enricher!.applyModelInfo(modelConfig, modelConfig.id, {
      id: modelConfig.id,
      context_length: 400000,
      reasoning: { default_enabled: true },
    })

    expect(modelConfig.variants).toBeUndefined()
    expect(modelConfig.reasoning).toBeUndefined()
  })
})
