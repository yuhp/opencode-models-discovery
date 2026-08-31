import { describe, it, expect } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

function enrich(modelInfo: Record<string, unknown>): any {
  const enricher = createModelInfoEnricher(ModelInfoFormat.LiteLLM, {
    data: [{ model_name: 'test-model', model_info: modelInfo }],
  })
  expect(enricher).toBeDefined()
  const modelConfig: any = { id: 'test-model' }
  enricher!.applyModelInfo(modelConfig, 'test-model')
  return modelConfig
}

describe('LiteLLM cost, tool_call and temperature enrichment', () => {
  it('maps per-token costs to per-million tokens', () => {
    expect(enrich({ input_cost_per_token: 1e-6, output_cost_per_token: 2.5e-6 }).cost).toEqual({
      input: 1,
      output: 2.5,
    })
  })

  it('keeps explicit zero costs as free', () => {
    expect(enrich({ input_cost_per_token: 0, output_cost_per_token: 0 }).cost).toEqual({
      input: 0,
      output: 0,
    })
  })

  it('includes flat cache_read and cache_write costs when positive', () => {
    const config = enrich({
      input_cost_per_token: 5e-7,
      output_cost_per_token: 1.5e-6,
      cache_read_input_token_cost: 1.25e-7,
      cache_creation_input_token_cost: 2.5e-7,
    })
    expect(config.cost).toEqual({
      input: 0.5,
      output: 1.5,
      cache_read: 0.125,
      cache_write: 0.25,
    })
  })

  it('omits cache keys when cache costs are null or zero', () => {
    const config = enrich({
      input_cost_per_token: 1e-6,
      output_cost_per_token: 1e-6,
      cache_read_input_token_cost: 0,
      cache_creation_input_token_cost: null,
    })
    expect(config.cost).toEqual({ input: 1, output: 1 })
  })

  it('does not set cost when only one side is known', () => {
    expect(enrich({ input_cost_per_token: 1e-6, output_cost_per_token: null }).cost).toBeUndefined()
  })

  it('does not set cost when scaling a per-token cost overflows to infinity', () => {
    expect(enrich({ input_cost_per_token: 1e308, output_cost_per_token: 1e-6 }).cost).toBeUndefined()
  })

  it('ignores string prices; LiteLLM serializes numbers', () => {
    expect(enrich({ input_cost_per_token: '1e-6', output_cost_per_token: '1e-6' }).cost).toBeUndefined()
  })

  it('sets tool_call from supports_function_calling', () => {
    expect(enrich({ supports_function_calling: true }).tool_call).toBe(true)
    expect(enrich({ supports_function_calling: false }).tool_call).toBe(false)
  })

  it('leaves tool_call untouched when the flag is null or missing', () => {
    expect(enrich({ supports_function_calling: null }).tool_call).toBeUndefined()
    expect(enrich({ max_tokens: 8192 }).tool_call).toBeUndefined()
  })

  it('sets temperature from supported_openai_params', () => {
    expect(enrich({ supported_openai_params: ['tools', 'temperature'] }).temperature).toBe(true)
    expect(enrich({ supported_openai_params: ['tools', 'response_format'] }).temperature).toBe(false)
  })

  it('leaves temperature untouched when supported_openai_params is missing', () => {
    expect(enrich({ max_tokens: 8192 }).temperature).toBeUndefined()
  })

  it('leaves temperature untouched when supported_openai_params is an empty list', () => {
    expect(enrich({ supported_openai_params: [] }).temperature).toBeUndefined()
  })
})
