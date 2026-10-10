import { describe, expect, it } from 'vitest'
import { discoverModelDrafts } from '../../src/core/discovery-pipeline'

describe('shared discovery pipeline', () => {
  it('normalizes, filters, classifies, enriches, names, and disambiguates', () => {
    const drafts = discoverModelDrafts([
      { id: 'openai/gpt-5', owned_by: 'openai', available: true },
      { id: 'github-copilot/gpt-5', owned_by: 'github-copilot', available: true },
      { id: 'text-embedding-3-large' },
      { id: 'ignored', available: false },
      { id: 'invalid', available: true },
      null,
    ], {
      filter: {
        includeBy: [{ field: 'available', equals: true }],
        excludeBy: [],
        includeRegex: [/gpt/],
        excludeRegex: [],
      },
      smartModelName: true,
    })

    expect(drafts.map((draft) => draft.id)).toEqual(['openai/gpt-5', 'github-copilot/gpt-5'])
    expect(drafts.map((draft) => draft.name)).toEqual(['GPT 5 (Openai)', 'GPT 5 (Github Copilot)'])
  })

  it('assigns organizationOwner preferring owned_by over ID namespace', () => {
    const drafts = discoverModelDrafts([
      { id: 'gateway/model-a', owned_by: 'anthropic' },
      { id: 'meta/llama-3' },
      { id: 'custom-model' },
    ], {
      filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
      smartModelName: false,
    })

    expect(drafts.find((d) => d.id === 'gateway/model-a')?.organizationOwner).toBe('anthropic')
    expect(drafts.find((d) => d.id === 'meta/llama-3')?.organizationOwner).toBe('meta')
    expect(drafts.find((d) => d.id === 'custom-model')?.organizationOwner).toBeUndefined()
  })
})
