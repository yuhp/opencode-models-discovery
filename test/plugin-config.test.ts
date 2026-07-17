import { describe, it, expect } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher, isSupportedModelInfoFormat } from '../src/utils/model-info'

describe('ModelInfoFormat enum', () => {
  it('has the correct string values', () => {
    expect(ModelInfoFormat.LiteLLM).toBe('litellm')
    expect(ModelInfoFormat.ModelsDev).toBe('models.dev')
    expect(ModelInfoFormat.VLLM).toBe('vllm')
  })
})

describe('isSupportedModelInfoFormat', () => {
  it('accepts enum members', () => {
    expect(isSupportedModelInfoFormat(ModelInfoFormat.LiteLLM)).toBe(true)
    expect(isSupportedModelInfoFormat(ModelInfoFormat.ModelsDev)).toBe(true)
    expect(isSupportedModelInfoFormat(ModelInfoFormat.VLLM)).toBe(true)
  })

  it('accepts raw string literals (config compatibility)', () => {
    expect(isSupportedModelInfoFormat('litellm')).toBe(true)
    expect(isSupportedModelInfoFormat('models.dev')).toBe(true)
    expect(isSupportedModelInfoFormat('vllm')).toBe(true)
  })

  it('rejects unknown formats', () => {
    expect(isSupportedModelInfoFormat('unknown' as ModelInfoFormat)).toBe(false)
    expect(isSupportedModelInfoFormat('openai' as ModelInfoFormat)).toBe(false)
  })
})

describe('createModelInfoEnricher', () => {
  it('creates an enricher with enum members', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LiteLLM, [], { filterNonChat: true })
    expect(enricher).toBeDefined()
    expect(typeof enricher!.shouldSkipModel).toBe('function')
    expect(typeof enricher!.applyModelInfo).toBe('function')

    const modelsDevEnricher = createModelInfoEnricher(ModelInfoFormat.ModelsDev, new Map(), { filterNonChat: true })
    expect(modelsDevEnricher).toBeDefined()
    expect(typeof modelsDevEnricher!.shouldSkipModel).toBe('function')
    expect(typeof modelsDevEnricher!.applyModelInfo).toBe('function')

    const vllmEnricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null, { filterNonChat: true })
    expect(vllmEnricher).toBeDefined()
    expect(typeof vllmEnricher!.shouldSkipModel).toBe('function')
    expect(typeof vllmEnricher!.applyModelInfo).toBe('function')
  })

  it('creates an enricher with raw strings (config compatibility)', () => {
    const enricher = createModelInfoEnricher('litellm' as ModelInfoFormat, [], { filterNonChat: true })
    expect(enricher).toBeDefined()

    const modelsDevEnricher = createModelInfoEnricher('models.dev' as ModelInfoFormat, new Map(), { filterNonChat: true })
    expect(modelsDevEnricher).toBeDefined()

    const vllmEnricher = createModelInfoEnricher('vllm' as ModelInfoFormat, null, { filterNonChat: true })
    expect(vllmEnricher).toBeDefined()
  })

  it('returns undefined for unknown format', () => {
    const enricher = createModelInfoEnricher('unknown' as ModelInfoFormat, [], { filterNonChat: true })
    expect(enricher).toBeUndefined()
  })
})

describe('JSON config struct parsing', () => {
  function parse(json: string): Record<string, unknown> {
    return JSON.parse(json)
  }

  it.each([
    { json: '{"modelInfoFormat":"litellm"}', expected: true },
    { json: '{"modelInfoFormat":"models.dev"}', expected: true },
    { json: '{"modelInfoFormat":"vllm"}', expected: true },
    { json: '{"modelInfoFormat":"bogus"}', expected: false },
  ])('handles modelInfoFormat=$json', ({ json, expected }) => {
    const config = parse(json)
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(expected)
  })

  it('handles absence of modelInfoFormat', () => {
    const config = parse('{"enabled":true}')
    expect(config.modelInfoFormat).toBeUndefined()
  })

  it('handles a full provider discovery config from JSON', () => {
    const json = `{
      "enabled": true,
      "endpoint": "/v1/models",
      "modelInfoEndpoint": "/v1/model/info",
      "modelInfoFormat": "litellm",
      "filterNonChat": true,
      "models": {
        "includeBy": [{ "field": "id", "match": "^chat-" }]
      }
    }`
    const config = parse(json)
    expect(config.modelInfoFormat).toBe('litellm')
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(true)
  })
})

describe('vLLM model info enricher', () => {
  it('extracts max_model_len from raw model', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null, { filterNonChat: true })
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
      input: 8192,
      output: 8192,
    })
  })

  it('does not set limit when max_model_len is missing', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null, { filterNonChat: true })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model', { id: 'test-model', object: 'model', created: 1, owned_by: 'llama.cpp' })
    expect(modelConfig.limit).toBeUndefined()
  })

  it('does not set limit for non-positive max_model_len values', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.VLLM, null, { filterNonChat: true })
    expect(enricher).toBeDefined()

    const modelConfig: any = { id: 'test-model' }
    enricher!.applyModelInfo(modelConfig, 'test-model', { id: 'test-model', object: 'model', created: 1, owned_by: 'vllm', max_model_len: 0 })
    expect(modelConfig.limit).toBeUndefined()
  })
})
