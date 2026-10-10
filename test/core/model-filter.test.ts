import { describe, expect, it } from 'vitest'
import { matchesModelFilter } from '../../src/core/model-filter'

describe('shared model filter', () => {
  const filter = (overrides: Partial<Parameters<typeof matchesModelFilter>[1]>) => ({
    includeBy: [],
    excludeBy: [],
    includeRegex: [],
    excludeRegex: [],
    ...overrides,
  })

  it('requires at least one include match and gives exclusions precedence', () => {
    expect(matchesModelFilter(
      { id: 'qwen/vision', available: true },
      filter({
        includeBy: [{ field: 'available', equals: true }],
        excludeBy: [{ field: 'id', match: /vision/ }],
      }),
    )).toBe(false)
  })

  it('evaluates exclude regex even when include regex is configured', () => {
    expect(matchesModelFilter(
      { id: 'qwen/vision' },
      filter({ includeRegex: [/^qwen/], excludeRegex: [/vision/] }),
    )).toBe(false)
  })

  it('matches fields strictly and treats missing fields as non-matches', () => {
    expect(matchesModelFilter(
      { id: 'model-a', available: true },
      filter({ includeBy: [{ field: 'available', equals: true }] }),
    )).toBe(true)
    expect(matchesModelFilter(
      { id: 'model-b' },
      filter({ includeBy: [{ field: 'available', equals: true }] }),
    )).toBe(false)
  })
})
