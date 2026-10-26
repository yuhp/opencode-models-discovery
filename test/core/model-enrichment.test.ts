import { describe, expect, it, vi } from 'vitest'
import { enrichModelDraft, prepareModelEnricher } from '../../src/core/model-enrichment'

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

  it('runs deferred preparation before enrichment', async () => {
    const prepare = vi.fn(async () => {})
    const enricher = {
      prepare,
      enrich: (model: { id: string }) => ({ limit: { context: model.id.length } }),
    }

    await prepareModelEnricher(enricher, ['alpha', 'beta'])

    expect(prepare).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledWith(['alpha', 'beta'])
    const result = enrichModelDraft({ id: 'alpha', name: 'alpha', raw: { id: 'alpha' } }, enricher)
    expect(result.draft.limit).toEqual({ context: 5 })
  })

  it('treats deferred preparation failures as best-effort', async () => {
    const prepare = vi.fn(async () => {
      throw new Error('metadata unavailable')
    })

    await expect(prepareModelEnricher({ prepare, enrich: () => ({}) }, ['alpha'])).resolves.toBeUndefined()
  })

  it('skips preparation for enrichers without a deferred phase', async () => {
    await expect(prepareModelEnricher({ enrich: () => ({}) }, ['alpha'])).resolves.toBeUndefined()
    await expect(prepareModelEnricher(undefined, ['alpha'])).resolves.toBeUndefined()
  })
})
