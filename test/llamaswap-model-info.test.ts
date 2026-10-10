import { describe, expect, it } from 'vitest'
import { createLlamaSwapEnricher } from '../src/utils/model-info/llamaswap'

describe('native llama-swap enricher', () => {
  it('maps context, modalities, display name, and function calling', () => {
    const result = createLlamaSwapEnricher(null).enrich({
      id: 'Gemma-4-31B-It',
      name: 'Gemma 4 31B IT',
      context_length: 9216,
      architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
      capabilities: { function_calling: true, vision: true },
      supported_parameters: ['tools', 'tool_choice'],
      meta: { n_ctx: 9216, llamaswap: { type: 'model' } },
    }, { filterNonChat: true })

    expect(result).toEqual({
      metadataName: 'Gemma 4 31B IT',
      limit: { context: 9216, output: 9216 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      toolCall: true,
    })
  })

  it('falls back to meta.n_ctx and honors optional limits', () => {
    const result = createLlamaSwapEnricher(null).enrich({
      id: 'local-model',
      meta: { n_ctx: 34816, llamaswap: { max_input_tokens: 32768, max_output_tokens: 2048 } },
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 34816, input: 32768, output: 2048 })
  })

  it('uses supported_parameters as a tool-calling fallback', () => {
    const result = createLlamaSwapEnricher(null).enrich({ id: 'tool-model', supported_parameters: ['tools'] }, { filterNonChat: true })
    expect(result.toolCall).toBe(true)
  })

  it('leaves malformed metadata unset', () => {
    const result = createLlamaSwapEnricher(null).enrich({
      id: 'invalid-model',
      name: '   ',
      context_length: '32768',
      architecture: { input_modalities: ['unsupported', 1], output_modalities: [] },
      capabilities: 'invalid',
      supported_parameters: 'tools',
      meta: { n_ctx: -1 },
    }, { filterNonChat: true })

    expect(result).toEqual({})
  })
})
