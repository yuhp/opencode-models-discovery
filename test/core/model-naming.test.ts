import { describe, expect, it } from 'vitest'
import { disambiguateModelNames, getOwnerLabel, resolveModelDisplayName, resolveModelOwner } from '../../src/core/model-naming'

describe('shared model naming', () => {
  it('preserves the complete ID when smart naming is disabled', () => {
    const model = { id: 'github-copilot/gpt-5.6-sol' }
    expect(resolveModelDisplayName(model, false)).toBe(model.id)
  })

  it('prefers a valid metadata name over generic formatting', () => {
    expect(resolveModelDisplayName(
      { id: 'qwen/qwen3-30b' },
      true,
      'Qwen 3 Thirty B',
    )).toBe('Qwen 3 Thirty B')
  })

  it('resolves raw owner preferring owned_by over ID namespace', () => {
    expect(resolveModelOwner({ id: 'gateway/gpt-5', raw: { id: 'gateway/gpt-5', owned_by: 'openai' } })).toBe('openai')
    expect(resolveModelOwner({ id: 'gateway/gpt-5', raw: { id: 'gateway/gpt-5', owned_by: '  openai  ' } })).toBe('openai')
    expect(resolveModelOwner({ id: 'gateway/gpt-5', raw: { id: 'gateway/gpt-5', owned_by: '' } })).toBe('gateway')
    expect(resolveModelOwner({ id: 'gateway/gpt-5', raw: { id: 'gateway/gpt-5', owned_by: '   ' } })).toBe('gateway')
    expect(resolveModelOwner({ id: 'gateway/gpt-5', raw: { id: 'gateway/gpt-5' } })).toBe('gateway')
    expect(resolveModelOwner({ id: 'standalone-model', raw: { id: 'standalone-model' } })).toBeUndefined()
  })

  it('prefers owned_by and falls back to the ID namespace for owner label', () => {
    expect(getOwnerLabel({ id: 'namespace/model', raw: { id: 'namespace/model', owned_by: 'custom-owner' } })).toBe('Custom Owner')
    expect(getOwnerLabel({ id: 'qwen/model', raw: { id: 'qwen/model' } })).toBe('Qwen')
  })

  it('only disambiguates collisions and preserves IDs', () => {
    const models = [
      { id: 'github-copilot/gpt-5', raw: { id: 'github-copilot/gpt-5' }, name: 'GPT 5' },
      { id: 'openai/gpt-5', raw: { id: 'openai/gpt-5' }, name: 'GPT 5' },
      { id: 'qwen/qwen3-30b', raw: { id: 'qwen/qwen3-30b' }, name: 'Qwen3 30B' },
    ]
    disambiguateModelNames(models)
    expect(models.map(({ name }) => name)).toEqual(['GPT 5 (Github Copilot)', 'GPT 5 (Openai)', 'Qwen3 30B'])
    expect(models.map(({ id }) => id)).toEqual(['github-copilot/gpt-5', 'openai/gpt-5', 'qwen/qwen3-30b'])
  })
})
