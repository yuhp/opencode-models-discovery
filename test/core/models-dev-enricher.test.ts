import { describe, expect, it } from 'vitest'
import { createModelsDevEnricher } from '../../src/utils/model-info/models-dev'

describe('native models.dev enricher', () => {
  it('returns neutral metadata without a host-shaped config object', () => {
    const enricher = createModelsDevEnricher(new Map([
      ['openai/gpt-5', {
        id: 'openai/gpt-5',
        name: 'GPT 5',
        reasoning: true,
        tool_call: true,
        modalities: { input: ['text', 'image'] },
        limit: { context: 128_000, output: 16_384 },
      }],
    ]))

    expect(enricher.enrich({ id: 'openai/gpt-5' }, { filterNonChat: true })).toEqual({
      metadataName: 'GPT 5',
      limit: { context: 128_000, output: 16_384 },
      reasoning: true,
      toolCall: true,
      modalities: { input: ['text', 'image'] },
    })
  })
})
