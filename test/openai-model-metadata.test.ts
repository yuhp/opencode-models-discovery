import { describe, expect, it } from 'vitest'
import { applyOpenAIModelMetadata, getOpenAIModelDisplayName } from '../src/utils/openai-model-metadata.ts'

describe('OpenAI-compatible model metadata', () => {
  it('maps Carcará context and output fields into OpenCode limits', () => {
    const modelConfig: Record<string, unknown> = {
      id: 'carcara-coder',
      modalities: { input: ['text'], output: ['text'] },
    }

    applyOpenAIModelMetadata(modelConfig, {
      id: 'carcara-coder',
      context_length: 1_048_576,
      max_input_tokens: 1_048_576,
      max_output_tokens: 4096,
    })

    expect(modelConfig.limit).toEqual({
      context: 1_048_576,
      input: 1_048_576,
      output: 4096,
    })
  })

  it('maps standard capabilities, modalities, cost, and interleaved metadata', () => {
    const modelConfig: Record<string, unknown> = {
      id: 'rich-model',
      modalities: { input: ['text'], output: ['text'] },
    }

    applyOpenAIModelMetadata(modelConfig, {
      id: 'rich-model',
      context_length: 128_000,
      max_output_tokens: 8192,
      input_modalities: ['TEXT', 'IMAGE'],
      output_modalities: ['TEXT'],
      capabilities: {
        attachment: true,
        reasoning: true,
        tools: true,
        structured_output: true,
        temperature: false,
      },
      cost: { input: 3, output: 15, cache_read: 1, cache_write: 2 },
      interleaved: { field: 'reasoning_content' },
      family: 'qwen',
      release_date: '2026-01-01',
      supported_openai_params: ['response_format'],
    })

    expect(modelConfig).toMatchObject({
      limit: { context: 128_000, output: 8192 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      attachment: true,
      reasoning: true,
      tool_call: true,
      structured_output: true,
      temperature: false,
      interleaved: { field: 'reasoning_content' },
      cost: { input: 3, output: 15, cache_read: 1, cache_write: 2 },
      family: 'qwen',
      release_date: '2026-01-01',
    })
  })

  it('prefers OpenCode limit values and ignores invalid token metadata', () => {
    const modelConfig: Record<string, unknown> = { id: 'model' }

    applyOpenAIModelMetadata(modelConfig, {
      id: 'model',
      limit: { context: 65_536, input: 60_000, output: 4096 },
      context_length: 128_000,
      max_input_tokens: 'not-a-number',
      max_output_tokens: 4096.5,
    })

    expect(modelConfig.limit).toEqual({ context: 65_536, input: 60_000, output: 4096 })
  })

  it('uses provider display names only when the caller opts into smart names', () => {
    expect(getOpenAIModelDisplayName({ id: 'model', name: 'Friendly model' })).toBe('Friendly model')
    expect(getOpenAIModelDisplayName({ id: 'model', display_name: 'Friendly model' })).toBe('Friendly model')
    expect(getOpenAIModelDisplayName({ id: 'model' })).toBeUndefined()
  })
})
