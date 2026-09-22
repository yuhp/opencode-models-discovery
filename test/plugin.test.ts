import { describe, it, expect, vi } from 'vitest'
import pluginDefault from '../src/index.ts'
import { discoverProviderModels } from '../src/plugin/enhance-config.ts'
import type { PluginLogger } from '../src/plugin/logger.ts'

const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('../src/utils/openai-compatible-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/openai-compatible-api')>()
  const requestOptions = (apiKey?: string) => ({
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
    },
    signal: AbortSignal.timeout(3000)
  })

  const readJson = async <T,>(response: any): Promise<T | undefined> => {
    if (!response?.ok) return undefined
    try {
      return await response.json() as T
    } catch {
      return undefined
    }
  }

  return {
    ...actual,
    discoverModelsFromProvider: vi.fn(async (baseURL: string, apiKey?: string, endpoint = '/v1/models') => {
      try {
        const data = await readJson<{ data?: any[] }>(await mockFetch(actual.buildAPIURL(baseURL, endpoint), requestOptions(apiKey)))
        return data ? { ok: true, models: data.data ?? [] } : { ok: false, models: [] }
      } catch {
        return { ok: false, models: [] }
      }
    }),
    discoverModelInfoFromProvider: vi.fn(async (baseURL: string, apiKey?: string, endpoint = '/v1/model/info') => {
      try {
        const data = await readJson<unknown>(await mockFetch(actual.buildAPIURL(baseURL, endpoint), requestOptions(apiKey)))
        return data !== undefined ? { ok: true, data } : { ok: false, data: undefined }
      } catch {
        return { ok: false, data: undefined }
      }
    })
  }
})

global.fetch = mockFetch

if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 3000)
    return controller.signal
  })
}

/** Silent logger stub matching the PluginLogger contract. */
function createTestLogger(): PluginLogger {
  const noop = (): void => {}
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => createTestLogger(),
  }
}

describe('opencode-models-discovery plugin (V2)', () => {
  describe('default export shape', () => {
    it('is a V2 plugin definition object with the expected id and setup function', () => {
      expect(pluginDefault).toBeTypeOf('object')
      expect(pluginDefault).not.toBeNull()
      expect(typeof pluginDefault.id).toBe('string')
      expect(pluginDefault.id).toBe('opencode-models-discovery')
      expect(typeof pluginDefault.setup).toBe('function')
    })
  })

  describe('discoverProviderModels', () => {
    it('discovers and enriches a fake OpenAI-compatible model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            id: 'fake/chat-model',
            object: 'model',
            created: 0,
            owned_by: 'local',
            normalized_name: 'Fake Chat Model',
            context_length: 8192,
            max_input_tokens: 8192,
            max_output_tokens: 4096,
            architecture: { input_modalities: ['TEXT'], output_modalities: ['TEXT'] },
            pricing: { prompt: '0.000002', completion: '0.000008' },
          }],
        }),
      })

      const models = await discoverProviderModels({
        providerID: 'fake',
        npm: '@ai-sdk/openai-compatible',
        settings: {
          baseURL: 'http://127.0.0.1:11434/v1',
          modelsDiscovery: { modelInfoFormat: 'bifrost', smartModelName: true },
        },
        fallback: {},
        logger: createTestLogger(),
      })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({
        method: 'GET'
      }))
      expect(models).toHaveLength(1)
      expect(models[0]).toMatchObject({
        id: 'fake/chat-model',
        modelID: 'fake/chat-model',
        providerID: 'fake',
        name: 'Fake Chat Model',
        status: 'active',
        enabled: true,
        capabilities: { tools: true, input: ['text'], output: ['text'] },
        limit: { context: 8192, input: 8192, output: 4096 },
        cost: [{ input: 2, output: 8 }],
      })
    })
  })
})
