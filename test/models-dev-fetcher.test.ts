import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchModelsDevData, lookupModelsDevData, modelsDevTestUtils } from '../src/utils/models-dev-fetcher.ts'

describe('models.dev fetcher', () => {
  beforeEach(() => {
    modelsDevTestUtils.resetCache()
  })

  it('should parse provider-nested models.dev data', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      openai: {
        models: {
          'gpt-4o': {
            id: 'gpt-4o',
            tool_call: true,
            limit: { context: 128000, output: 16384 }
          }
        }
      }
    })

    expect(cache.get('openai/gpt-4o')).toEqual(expect.objectContaining({
      id: 'openai/gpt-4o',
      tool_call: true,
      limit: { context: 128000, input: undefined, output: 16384 }
    }))
  })

  it('should parse flat models.dev data keyed by model id', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      'openai/gpt-4o': {
        tool_call: true,
        limit: { context: 128000 }
      }
    })

    expect(cache.get('openai/gpt-4o')).toEqual(expect.objectContaining({
      id: 'openai/gpt-4o',
      tool_call: true,
      limit: { context: 128000, input: undefined, output: undefined }
    }))
  })

  it('should match exact and same-provider model variants', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      openai: {
        models: {
          'gpt-4o': { id: 'gpt-4o', tool_call: true },
          'gpt-4o-mini': { id: 'gpt-4o-mini', tool_call: false }
        }
      },
      anthropic: {
        models: {
          'claude-3-5-sonnet': { id: 'claude-3-5-sonnet', reasoning: true }
        }
      }
    })

    expect(lookupModelsDevData('openai/gpt-4o-mini', cache)?.id).toBe('openai/gpt-4o-mini')
    expect(lookupModelsDevData('openai/gpt-4o-2024-11-20', cache)?.id).toBe('openai/gpt-4o')
  })

  it('should normalize gateway prefixes and provider variants before lookup', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      'moonshotai/kimi-k2.6': {
        name: 'Kimi K2.6',
        modalities: { input: ['text', 'image'], output: ['text'] }
      },
      'deepseek/deepseek-v4-flash': {
        name: 'DeepSeek V4 Flash',
        reasoning: true
      }
    })

    expect(lookupModelsDevData('openrouter/moonshotai/kimi-k2.6:free', cache)?.id).toBe('moonshotai/kimi-k2.6')
    expect(lookupModelsDevData('gateway/deepseek/deepseek-v4-flash', cache)?.id).toBe('deepseek/deepseek-v4-flash')
  })

  it('should match model id segments without requiring the provider to match', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      openai: {
        models: {
          'shared-model': { id: 'shared-model', tool_call: true }
        }
      }
    })

    expect(lookupModelsDevData('custom/shared-model', cache)?.id).toBe('openai/shared-model')
  })

  it('should not match ambiguous duplicate model id segments', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      providerA: {
        models: {
          'shared-model': { id: 'shared-model', tool_call: true }
        }
      },
      providerB: {
        models: {
          'shared-model': { id: 'shared-model', tool_call: false }
        }
      }
    })

    expect(lookupModelsDevData('custom/shared-model', cache)).toBeUndefined()
  })

  it('should allow model-only matches when provider is absent', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      openai: {
        models: {
          'gpt-4o': { id: 'gpt-4o', tool_call: true }
        }
      }
    })

    expect(lookupModelsDevData('gpt-4o', cache)?.id).toBe('openai/gpt-4o')
  })

  it('should require a strong prefix match', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      openai: {
        models: {
          gpt: { id: 'gpt', tool_call: true }
        }
      }
    })

    expect(lookupModelsDevData('openai/gpt-4o-2024-11-20', cache)).toBeUndefined()
  })

  it('should not match ambiguous tied prefix candidates', () => {
    const cache = modelsDevTestUtils.parseModelsDevData({
      providerA: {
        models: {
          'shared-model-alpha': { id: 'shared-model-alpha', tool_call: true }
        }
      },
      providerB: {
        models: {
          'shared-model-beta': { id: 'shared-model-beta', tool_call: false }
        }
      }
    })

    expect(lookupModelsDevData('custom/shared-model', cache)).toBeUndefined()
  })

  it('should cache models.dev data separately for each URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const id = String(url).includes('mirror.example') ? 'mirror-model' : 'default-model'
      return new Response(JSON.stringify({ test: { models: { [id]: { id } } } }))
    })

    const defaultModels = await fetchModelsDevData()
    const mirrorModels = await fetchModelsDevData('https://mirror.example/models.json')
    await fetchModelsDevData('https://mirror.example/models.json')

    expect(defaultModels.has('test/default-model')).toBe(true)
    expect(mirrorModels.has('test/mirror-model')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fetchMock.mockRestore()
  })
})
