import { describe, it, expect } from 'vitest'
import { createLiteLLMEnricher } from '../src/utils/model-info/litellm'

function enrich(modelInfo: Record<string, unknown>): any {
  return createLiteLLMEnricher({ data: [{ model_name: 'test-model', model_info: modelInfo }] })
    .enrich({ id: 'test-model' }, { filterNonChat: true })
}

describe('LiteLLM cost, tool_call and temperature enrichment', () => {
  it('maps per-token costs to per-million tokens', () => {
    expect(enrich({ input_cost_per_token: 1e-6, output_cost_per_token: 2.5e-6 }).cost).toEqual({ input: 1, output: 2.5 })
  })

  it('keeps free costs and includes positive cache costs', () => {
    expect(enrich({ input_cost_per_token: 0, output_cost_per_token: 0 }).cost).toEqual({ input: 0, output: 0 })
    expect(enrich({ input_cost_per_token: 5e-7, output_cost_per_token: 1.5e-6, cache_read_input_token_cost: 1.25e-7, cache_creation_input_token_cost: 2.5e-7 }).cost)
      .toEqual({ input: 0.5, output: 1.5, cache_read: 0.125, cache_write: 0.25 })
  })

  it('requires both primary cost sides and rejects overflow/string values', () => {
    expect(enrich({ input_cost_per_token: 1e-6 }).cost).toBeUndefined()
    expect(enrich({ input_cost_per_token: 1e308, output_cost_per_token: 1e-6 }).cost).toBeUndefined()
    expect(enrich({ input_cost_per_token: '1e-6', output_cost_per_token: '1e-6' }).cost).toBeUndefined()
  })

  it('maps tool calling and temperature declarations', () => {
    expect(enrich({ supports_function_calling: true }).toolCall).toBe(true)
    expect(enrich({ supports_function_calling: false }).toolCall).toBe(false)
    expect(enrich({ supported_openai_params: ['tools', 'temperature'] }).temperature).toBe(true)
    expect(enrich({ supported_openai_params: ['tools', 'response_format'] }).temperature).toBe(false)
    expect(enrich({ supported_openai_params: [] }).temperature).toBeUndefined()
  })
})
