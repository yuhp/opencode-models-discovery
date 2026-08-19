import { describe, expect, it } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

describe('llama-swap model info enricher', () => {
  it('maps inline context, modalities, display name, and function calling', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LlamaSwap, null)
    expect(enricher).toBeDefined()

    const config: any = {
      id: 'Gemma-4-31B-It',
      modalities: { input: ['text'], output: ['text'] },
    }
    const rawModel: Record<string, unknown> = {
      id: config.id,
      name: 'Gemma 4 31B IT',
      context_length: 9216,
      architecture: {
        input_modalities: ['text', 'image'],
        output_modalities: ['text'],
      },
      capabilities: { function_calling: true, vision: true },
      supported_parameters: ['tools', 'tool_choice'],
      meta: {
        n_ctx: 9216,
        llamaswap: { type: 'model' },
      },
    }

    expect(enricher!.getModelName?.(config.id, rawModel)).toBe('Gemma 4 31B IT')
    enricher!.applyModelInfo(config, config.id, rawModel)

    expect(config).toMatchObject({
      limit: { context: 9216, output: 0 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      tool_call: true,
    })
  })

  it('falls back to meta.n_ctx and honors optional configured input and output limits', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LlamaSwap, null)
    const config: any = { id: 'local-model' }

    enricher!.applyModelInfo(config, config.id, {
      id: config.id,
      meta: {
        n_ctx: 34816,
        llamaswap: {
          max_input_tokens: 32768,
          max_output_tokens: 2048,
        },
      },
    })

    expect(config.limit).toEqual({ context: 34816, input: 32768, output: 2048 })
  })

  it('uses supported_parameters as a tool-calling fallback', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LlamaSwap, null)
    const config: any = { id: 'tool-model' }

    enricher!.applyModelInfo(config, config.id, {
      id: config.id,
      supported_parameters: ['tools'],
    })

    expect(config.tool_call).toBe(true)
  })

  it('leaves malformed metadata unset and preserves default modalities', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.LlamaSwap, null)
    const config: any = {
      id: 'invalid-model',
      modalities: { input: ['text'], output: ['text'] },
    }

    enricher!.applyModelInfo(config, config.id, {
      id: config.id,
      name: '   ',
      context_length: '32768',
      architecture: {
        input_modalities: ['unsupported', 1],
        output_modalities: [],
      },
      capabilities: 'invalid',
      supported_parameters: 'tools',
      meta: { n_ctx: -1 },
    })

    expect(enricher!.getModelName?.(config.id, { name: '   ' })).toBeUndefined()
    expect(config).toEqual({
      id: 'invalid-model',
      modalities: { input: ['text'], output: ['text'] },
    })
  })
})
