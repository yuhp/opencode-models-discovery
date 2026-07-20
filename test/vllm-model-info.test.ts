import { describe, it, expect } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

describe('vLLM model info enricher', () => {
  it('extracts max_model_len from raw model', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null)
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    const rawModel: Record<string, unknown> = {
      id: 'test-model',
      object: 'model',
      created: 1,
      owned_by: 'vllm',
      max_model_len: 8192,
    }

    enricher!.applyModelInfo(modelConfig, 'test-model', rawModel)
    expect(modelConfig.limit).toEqual({
      context: 8192,
      output: 8192,
    })
  })

  it('does not set limit when max_model_len is missing', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null)
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model', { id: 'test-model', object: 'model', created: 1, owned_by: 'llama.cpp' })
    expect(modelConfig.limit).toBeUndefined()
  })

  it('does not set limit for non-positive max_model_len values', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null)
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model', { id: 'test-model', object: 'model', created: 1, owned_by: 'vllm', max_model_len: 0 })
    expect(modelConfig.limit).toBeUndefined()
  })
})
