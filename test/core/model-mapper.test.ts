import { describe, expect, it } from 'vitest'
import { mapToV1Model, mapToDiscoveredV2Model } from '../../src/core/model-mapper'
import type { DiscoveredModelDraft } from '../../src/core/model-types'

const options = { smartModelName: true }

function draft(overrides: Partial<DiscoveredModelDraft> = {}): DiscoveredModelDraft {
  return {
    id: 'openai/gpt-5',
    name: 'GPT 5',
    raw: { id: 'openai/gpt-5' },
    ...overrides,
  }
}

describe('shared model projections', () => {
  it('projects a draft into the V1 model shape', () => {
    expect(mapToV1Model(draft({
      organizationOwner: 'openai',
      limit: { context: 128_000, output: 16_384 },
      toolCall: true,
      structuredOutput: false,
    }))).toEqual({
      id: 'openai/gpt-5',
      name: 'GPT 5',
      organizationOwner: 'openai',
      limit: { context: 128_000, output: 16_384 },
      tool_call: true,
      structured_output: false,
    })
  })

  it('projects the same draft into the V2 model shape', () => {
    expect(mapToDiscoveredV2Model(draft({
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 128_000, output: 16_384 },
      toolCall: true,
    }), options)).toMatchObject({
      id: 'openai/gpt-5',
      modelID: 'openai/gpt-5',
      name: 'GPT 5',
      capabilities: {
        tools: true,
        input: ['text', 'image'],
        output: ['text'],
      },
      limit: { context: 128_000, output: 16_384 },
    })
  })

  it('preserves variant body and header request overlays for V2 models', () => {
    const customDraft = draft({
      id: 'openai/gpt-fast',
      variants: {
        medium: { reasoningEffort: 'medium' },
        fast: {
          settings: { custom: true },
          body: { service_tier: 'fast' },
          headers: { 'x-tier': 'fast' },
        },
      },
    })

    const mapped = mapToDiscoveredV2Model(customDraft, { smartModelName: true })
    expect(mapped.variants).toEqual(expect.arrayContaining([
      {
        id: 'medium',
        settings: { reasoningEffort: 'medium' },
      },
      {
        id: 'fast',
        settings: { custom: true },
        body: { service_tier: 'fast' },
        headers: { 'x-tier': 'fast' },
      },
    ]))
  })

  it('safely bounds missing output token limit while preserving large context', () => {
    const customDraft = draft({
      id: 'oc/long-context',
      limit: { context: 1_048_576 },
    })

    const mapped = mapToDiscoveredV2Model(customDraft, { smartModelName: true })
    expect(mapped.limit.context).toBe(1_048_576)
    expect(mapped.limit.output).toBe(32_000)
  })
})
