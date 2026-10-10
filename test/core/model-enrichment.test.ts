import { describe, expect, it } from 'vitest'
import { enrichModelDraft } from '../../src/core/model-enrichment'

describe('shared model enrichment contract', () => {
  it('applies native enricher output into a neutral draft', () => {
    const result = enrichModelDraft({
      id: 'provider/model',
      name: 'provider/model',
      raw: { id: 'provider/model' },
      capabilities: { tools: true },
      limit: { context: 100 },
    }, {
      enrich: () => ({
        metadataName: 'Readable Model',
        reasoning: true,
        toolCall: false,
        cost: { input: 1, output: 2 },
        modalities: { input: ['text', 'image'] },
      }),
    })

    expect(result.skipped).toBe(false)
    expect(result.metadataName).toBe('Readable Model')
    expect(result.draft.reasoning).toBe(true)
    expect(result.draft.toolCall).toBe(false)
    expect(result.draft.cost).toEqual({ input: 1, output: 2 })
    expect(result.draft.modalities).toEqual({ input: ['text', 'image'] })
  })

  it('preserves native skip decisions without applying enrichment', () => {
    let applied = false
    const result = enrichModelDraft({ id: 'skip-me', name: 'skip-me', raw: { id: 'skip-me' } }, {
      enrich: () => {
        applied = true
        return { skip: true }
      },
    })

    expect(result.skipped).toBe(true)
    expect(applied).toBe(true)
  })
})
