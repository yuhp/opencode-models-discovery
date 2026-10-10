import { describe, it, expect } from 'vitest'
import { createVLLMEnricher } from '../src/utils/model-info/vllm'

describe('vLLM model info enricher', () => {
  it('extracts max_model_len from raw model', () => {
    const rawModel = {
      id: 'test-model',
      object: 'model',
      created: 1,
      owned_by: 'vllm',
      max_model_len: 8192,
    }

    expect(createVLLMEnricher(null).enrich(rawModel, { filterNonChat: true }).limit).toEqual({
      context: 8192,
      output: 8192,
    })
  })

  it('does not set limit when max_model_len is missing', () => {
    expect(createVLLMEnricher(null).enrich({ id: 'test-model', object: 'model', created: 1, owned_by: 'llama.cpp' }, { filterNonChat: true }).limit).toBeUndefined()
  })

  it('does not set limit for non-positive max_model_len values', () => {
    expect(createVLLMEnricher(null).enrich({ id: 'test-model', object: 'model', created: 1, owned_by: 'vllm', max_model_len: 0 }, { filterNonChat: true }).limit).toBeUndefined()
  })
})
