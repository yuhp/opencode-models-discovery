import { describe, it, expect } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

function litellmEnricher(modelInfo: Record<string, unknown>) {
  return createModelInfoEnricher(ModelInfoFormat.LiteLLM, {
    data: [{ model_name: 'test-model', model_info: modelInfo }],
  })
}

describe('LiteLLM model info enricher', () => {
  it('sets modalities from model_info.modalities', () => {
    const enricher = litellmEnricher({
      modalities: { input: ['text', 'image'], output: ['text'] },
    })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model')
    expect(modelConfig.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('derives image input from supports_vision when modalities are absent', () => {
    const enricher = litellmEnricher({ supports_vision: true })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model')
    expect(modelConfig.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('defaults a missing modality side to ["text"] when only one side is provided', () => {
    const enricher = litellmEnricher({ modalities: { input: ['text', 'image'] } })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model')
    expect(modelConfig.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('ignores non-string entries in modalities lists', () => {
    const enricher = litellmEnricher({
      modalities: { input: ['text', 'image', 42, null], output: ['text'] },
    })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model')
    expect(modelConfig.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('leaves existing modalities untouched when info carries no modality signals', () => {
    const enricher = litellmEnricher({ max_tokens: 8192 })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model', modalities: { input: ['text'], output: ['text'] } }
    enricher!.applyModelInfo(modelConfig, 'test-model')
    expect(modelConfig.modalities).toEqual({ input: ['text'], output: ['text'] })
  })

  describe('reasoning variants', () => {
    function variantKeys(modelInfo: Record<string, unknown>): string[] {
      const enricher = litellmEnricher({
        supports_reasoning: true,
        supported_openai_params: ['reasoning_effort'],
        ...modelInfo,
      })
      const modelConfig: any = { id: 'test-model' }
      enricher!.applyModelInfo(modelConfig, 'test-model')
      return Object.keys(modelConfig.variants ?? {})
    }

    it('hides high when supports_high_reasoning_effort is false', () => {
      expect(variantKeys({ supports_high_reasoning_effort: false })).toEqual(['low', 'medium'])
    })

    it('hides medium when supports_medium_reasoning_effort is false', () => {
      expect(variantKeys({ supports_medium_reasoning_effort: false })).toEqual(['low', 'high'])
    })

    it('keeps medium and high when their flags are absent', () => {
      expect(variantKeys({})).toEqual(['low', 'medium', 'high'])
    })

    it('honors all seven per-tier effort flags when set explicitly', () => {
      expect(variantKeys({
        supports_none_reasoning_effort: true,
        supports_minimal_reasoning_effort: true,
        supports_low_reasoning_effort: true,
        supports_medium_reasoning_effort: true,
        supports_high_reasoning_effort: true,
        supports_xhigh_reasoning_effort: true,
        supports_max_reasoning_effort: true,
      })).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    })
  })
})
