import { describe, it, expect } from 'vitest'
import { createLiteLLMEnricher } from '../src/utils/model-info/litellm'

function enrich(modelInfo: Record<string, unknown>) {
  return createLiteLLMEnricher({ data: [{ model_name: 'test-model', model_info: modelInfo }] })
    .enrich({ id: 'test-model' }, { filterNonChat: true })
}

describe('native LiteLLM enricher', () => {
  it('maps and normalizes modalities', () => {
    expect(enrich({ modalities: { input: ['TEXT', 'speech', ' image ', 'Text'], output: ['Text'] } }).modalities)
      .toEqual({ input: ['text', 'audio', 'image'], output: ['text'] })
  })

  it('derives image input from supports_vision', () => {
    expect(enrich({ supports_vision: true }).modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('defaults a missing modality side to text', () => {
    expect(enrich({ modalities: { input: ['text', 'image'] } }).modalities)
      .toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('ignores a declared modality side with no supported values', () => {
    expect(enrich({ modalities: { input: ['text', 'hologram'], output: ['hologram'] } }).modalities).toBeUndefined()
  })

  describe('reasoning variants', () => {
    it('honors explicit tier flags and defaults common tiers', () => {
      const result = enrich({
        supports_reasoning: true,
        supported_openai_params: ['reasoning_effort'],
        supports_none_reasoning_effort: true,
        supports_minimal_reasoning_effort: true,
        supports_low_reasoning_effort: true,
        supports_medium_reasoning_effort: false,
        supports_high_reasoning_effort: true,
        supports_xhigh_reasoning_effort: true,
        supports_max_reasoning_effort: true,
      })
      expect(result.reasoning).toBe(true)
      expect(Object.keys(result.variants as object)).toEqual(['none', 'minimal', 'low', 'high', 'xhigh', 'max'])
    })

    it('does not create variants without reasoning_effort support', () => {
      expect(enrich({ supports_reasoning: true }).variants).toBeUndefined()
    })
  })

  it('skips non-chat models when requested', () => {
    const enricher = createLiteLLMEnricher({ data: [{ model_name: 'embed', model_info: { mode: 'embedding' } }] })
    expect(enricher.enrich({ id: 'embed' }, { filterNonChat: true })).toEqual({ skip: true })
    expect(enricher.enrich({ id: 'embed' }, { filterNonChat: false })).toEqual({})
  })
})
