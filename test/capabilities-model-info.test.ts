import { describe, expect, it } from 'vitest'
import { createCapabilitiesEnricher } from '../src/utils/model-info/capabilities'

function enrich(rawModel: Record<string, unknown>) {
  return createCapabilitiesEnricher(null).enrich(rawModel, { filterNonChat: true })
}

describe('capabilities model enricher', () => {
  it('maps inline router capabilities to OpenCode model metadata', () => {
    expect(enrich({
      id: 'ds/deepseek-v4.1-flash',
      context_length: 1_048_576,
      max_input_tokens: 1_048_576,
      max_output_tokens: 384_000,
      capabilities: {
        vision: true,
        pdf: false,
        audioInput: false,
        videoInput: false,
        imageOutput: false,
        audioOutput: false,
        tools: true,
        reasoning: true,
        thinkingFormat: 'deepseek',
      },
    })).toEqual({
      limit: { context: 1_048_576, input: 1_048_576, output: 384_000 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      reasoning: true,
      toolCall: true,
      attachment: true,
      compatibility: { interleaved: { field: 'reasoning_content' } },
    })
  })

  it('maps every media flag and reasoning effort tiers', () => {
    expect(enrich({
      id: 'gemini/models/gemini-3.1-flash-image',
      context_length: 1_048_576,
      max_output_tokens: 65_536,
      capabilities: {
        vision: true,
        pdf: true,
        audioInput: true,
        videoInput: true,
        imageOutput: true,
        audioOutput: true,
        tools: true,
        reasoning: false,
        thinkingFormat: 'gemini-level',
        effort_tiers: ['low', 'high', 'ultra', 3],
      },
    })).toEqual({
      limit: { context: 1_048_576, output: 65_536 },
      modalities: { input: ['text', 'image', 'audio', 'video', 'pdf'], output: ['text', 'image', 'audio'] },
      reasoning: true,
      toolCall: true,
      attachment: true,
      variants: { low: { reasoningEffort: 'low' }, high: { reasoningEffort: 'high' } },
    })
  })

  it('leaves unknown metadata unset', () => {
    expect(enrich({
      id: 'mystery-model',
      context_length: 'big',
      max_output_tokens: Number.POSITIVE_INFINITY,
      capabilities: 'invalid',
    })).toEqual({})
  })
})
