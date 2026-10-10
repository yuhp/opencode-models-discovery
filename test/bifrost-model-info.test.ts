import { describe, it, expect } from 'vitest'
import { createBifrostEnricher } from '../src/utils/model-info/bifrost'

describe('Bifrost model info enricher', () => {
  it('extracts documented inline metadata from a raw model', () => {
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

    const result = createBifrostEnricher(null).enrich(rawModel as { id: string }, { filterNonChat: true })
    expect(result).toMatchObject({
      metadataName: 'Claude Sonnet 4.6',
      limit: { context: 200000, input: 200000, output: 8192 },
      modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
      cost: { input: 3, output: 15 },
    })
  })

  it('leaves missing or malformed metadata unset', () => {
    const result = createBifrostEnricher(null).enrich({
      id: 'openai/gpt-4o',
      context_length: 0,
      max_input_tokens: '128000',
      max_output_tokens: -1,
      architecture: { input_modalities: ['TEXT', 1, 'unsupported'], output_modalities: [] },
      pricing: { prompt: 'invalid', completion: -1 },
    }, { filterNonChat: true })

    expect(result).toEqual({ modalities: { input: ['text'] } })
  })

  it('preserves a reported zero price', () => {
    const result = createBifrostEnricher(null).enrich({
      id: 'local/free-model',
      pricing: { prompt: '0', completion: '0.000001' },
    }, { filterNonChat: true })

    expect(result.cost).toEqual({ input: 0, output: 1 })
  })

  it('preserves context limit while ignoring incomplete pricing', () => {
    const result = createBifrostEnricher(null).enrich({
      id: 'openai/gpt-4o',
      context_length: 128000,
      max_input_tokens: 128000,
      pricing: { prompt: '0.000003' },
    }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 128000, input: 128000 })
    expect(result.cost).toBeUndefined()
  })

  it('maps reasoning supported_efforts to variants', () => {
    const result = createBifrostEnricher(null).enrich({
      id: 'vllm/chat-fast',
      context_length: 131072,
      reasoning: {
        supported_efforts: ['low', 'medium', 'xhigh'],
        default_effort: 'xhigh',
      },
    }, { filterNonChat: true })

    expect(result.reasoning).toBe(true)
    expect(result.variants).toEqual({
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      xhigh: { reasoningEffort: 'xhigh' },
    })
  })

  it('ignores unsupported or malformed reasoning blocks', () => {
    const result = createBifrostEnricher(null).enrich({
      id: 'vllm/glm',
      context_length: 400000,
      reasoning: {
        supported_efforts: ['ultra', ''],
        default_effort: 'ultra',
      },
    }, { filterNonChat: true })

    expect(result.variants).toBeUndefined()
    expect(result.reasoning).toBeUndefined()
    expect(result.limit).toEqual({ context: 400000 })
  })

  it('does not emit variants when supported_efforts is absent', () => {
    const result = createBifrostEnricher(null).enrich({
      id: 'vllm/base',
      context_length: 400000,
      reasoning: { default_enabled: true },
    }, { filterNonChat: true })

    expect(result.variants).toBeUndefined()
    expect(result.reasoning).toBeUndefined()
  })
})
