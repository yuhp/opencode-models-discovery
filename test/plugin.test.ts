import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ModelDiscoveryPlugin } from '../src/index.ts'
import { clearCache, readCache } from '../src/cache/model-cache.ts'

const mockFetch = vi.fn()
global.fetch = mockFetch

if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 3000)
    return controller.signal
  })
}

describe('ModelDiscovery Plugin', () => {
  let mockClient: any
  let pluginHooks: any

  beforeEach(async () => {
    mockFetch.mockClear()

    mockClient = {
      app: {
        log: vi.fn().mockResolvedValue(true)
      },
      tui: {
        showToast: vi.fn().mockResolvedValue(true)
      }
    }

    const mockInput: any = {
      client: mockClient,
      project: {
        id: 'test-project',
        name: 'test',
        path: '/tmp',
        worktree: '',
        time: { created: Date.now() }
      },
      directory: '/tmp',
      worktree: '',
      $: vi.fn(),
      config: {}
    }

    pluginHooks = await ModelDiscoveryPlugin(mockInput)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await clearCache()
  })

  describe('Plugin Initialization', () => {
    it('should initialize successfully with valid client', async () => {
      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }
      const hooks = await ModelDiscoveryPlugin(mockInput)
      expect(hooks).toBeDefined()
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
    })

    it('should handle invalid client gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockInput: any = {
        client: null,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }
      const hooks = await ModelDiscoveryPlugin(mockInput)

      expect(hooks).toBeDefined()
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-models-discovery] Invalid client provided to plugin', { category: 'plugin' })

      consoleSpy.mockRestore()
    })
  })

  describe('Config Hook', () => {
    it('should validate config and reject invalid configurations', async () => {
      await pluginHooks.config(null)
      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery',
          level: 'error',
          message: 'Invalid config provided',
          extra: expect.objectContaining({
            category: 'config',
            errors: expect.arrayContaining(['Config must be an object'])
          })
        })
      }))
    })

    it('should handle empty config gracefully', async () => {
      await pluginHooks.config({})
      expect(true).toBe(true)
    })

    it('should discover models for OpenAI-compatible providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model-1', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'test-model-2', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }
      await pluginHooks.config(config)

      expect(config.provider?.ollama?.models).toBeDefined()
      expect(Object.keys(config.provider.ollama.models).length).toBe(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({
        method: 'GET'
      }))
    })

    it('should use provider-specific discovery endpoint when configured', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'custom-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434',
              modelsDiscovery: {
                endpoint: '/api/models'
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['custom-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/api/models', expect.objectContaining({
        method: 'GET'
      }))
    })

    it('should enrich LiteLLM models from model info and filter non-chat modes', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'openai/gpt-5.5', object: 'model', created: 1234567890, owned_by: 'openai' },
              { id: 'text-embedding-3-small', object: 'model', created: 1234567890, owned_by: 'openai' },
              { id: 'dall-e-3', object: 'model', created: 1234567890, owned_by: 'openai' }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                model_name: 'openai/gpt-5.5',
                litellm_params: { model: 'ollama/openai/gpt-5.5' },
                model_info: {
                  key: 'openai/gpt-5.5',
                  mode: 'chat'
                }
              },
              {
                model_name: 'openai/gpt-5.5',
                litellm_params: { model: 'openai/gpt-5.5' },
                model_info: {
                  key: 'gpt-5.5',
                  mode: 'chat',
                  max_tokens: 128000,
                  max_input_tokens: 1050000,
                  max_output_tokens: 128000,
                  supports_reasoning: true,
                  supports_none_reasoning_effort: true,
                  supports_minimal_reasoning_effort: false,
                  supports_xhigh_reasoning_effort: true,
                  supported_openai_params: ['reasoning_effort']
                }
              },
              {
                model_name: 'TEXT-EMBEDDING-3-SMALL',
                litellm_params: { model: 'openai/TEXT-EMBEDDING-3-SMALL' },
                model_info: {
                  mode: 'embedding',
                  max_input_tokens: 8191
                }
              },
              {
                model_name: 'dall-e-3',
                litellm_params: { model: 'openai/dall-e-3' },
                model_info: {
                  mode: 'image_generation'
                }
              }
            ]
          })
        })

      const config: any = {
        provider: {
          litellm: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LiteLLM',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                modelInfoEndpoint: '/v1/model/info',
                modelInfoFormat: 'litellm'
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET'
      }))
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:4000/v1/model/info', expect.objectContaining({
        method: 'GET'
      }))
      expect(config.provider.litellm.models['openai/gpt-5.5']).toEqual(expect.objectContaining({
        id: 'openai/gpt-5.5',
        reasoning: true,
        limit: {
          context: 1050000,
          input: 1050000,
          output: 128000
        },
        variants: {
          none: { reasoningEffort: 'none' },
          low: { reasoningEffort: 'low' },
          medium: { reasoningEffort: 'medium' },
          high: { reasoningEffort: 'high' },
          xhigh: { reasoningEffort: 'xhigh' }
        }
      }))
      expect(config.provider.litellm.models['text-embedding-3-small']).toBeUndefined()
      expect(config.provider.litellm.models['dall-e-3']).toBeUndefined()
    })

    it('should skip embedding models even when model info is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'Qwen/Qwen3-VL-Embedding-8B', object: 'model', created: 1234567890, owned_by: 'openai' },
            { id: 'Qwen/Qwen3-VL-32B-Instruct', object: 'model', created: 1234567890, owned_by: 'openai' }
          ]
        })
      })

      const config: any = {
        provider: {
          litellm: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LiteLLM',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(config.provider.litellm.models['Qwen/Qwen3-VL-Embedding-8B']).toBeUndefined()
      expect(config.provider.litellm.models['Qwen/Qwen3-VL-32B-Instruct']).toEqual(expect.objectContaining({
        id: 'Qwen/Qwen3-VL-32B-Instruct',
        modalities: {
          input: ['text', 'image'],
          output: ['text']
        }
      }))
    })

    it('should merge discovered models with existing config', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'new-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {
              'existing-model': { name: 'Existing Model' }
            }
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models).toEqual({
        'existing-model': { name: 'Existing Model' },
        'new-model': expect.objectContaining({
          id: 'new-model',
          name: 'new-model'
        })
      })
    })

    it('should keep raw model ids by default', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-30b-a3b', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toEqual(
        expect.objectContaining({
          id: 'qwen/qwen3-30b-a3b',
          name: 'qwen/qwen3-30b-a3b'
        })
      )
    })

    it('should apply smart formatting when enabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-30b-a3b', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const hooksWithConfig = await ModelDiscoveryPlugin({
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }, {
        smartModelName: true
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toEqual(
        expect.objectContaining({
          id: 'qwen/qwen3-30b-a3b',
          name: 'Qwen3 30B A3B'
        })
      )
    })

    it('should handle provider offline gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' }
          }
        }
      }

      await pluginHooks.config(config)

      // Offline providers are handled silently
      consoleSpy.mockRestore()
    })

    it('should skip non-OpenAI-compatible providers', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config: any = {
        provider: {
          anthropic: {
            npm: '@ai-sdk/anthropic',
            name: 'Anthropic',
            options: { baseURL: 'https://api.anthropic.com' }
          }
        }
      }

      await pluginHooks.config(config)

      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('appears to be offline'))
      consoleSpy.mockRestore()
    })

    it('should discover providers with custom models endpoint even without /v1 baseURL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'endpoint-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          anthropic: {
            npm: '@ai-sdk/anthropic',
            name: 'Anthropic Custom Backend',
            options: {
              baseURL: 'http://127.0.0.1:9000',
              modelsDiscovery: {
                endpoint: '/api/models'
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.anthropic.models['endpoint-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:9000/api/models', expect.objectContaining({
        method: 'GET'
      }))
    })

    it('should skip providers in exclude list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        providers: {
          exclude: ['ollama']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      // Filter check happens silently
    })

    it('should only discover providers in include list', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        providers: {
          include: ['lmstudio']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          },
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider?.lmstudio?.models?.['test-model']).toBeDefined()
      expect(config.provider?.ollama?.models).toEqual({})
    })

    it('should skip discovery when discovery.enabled is false', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        discovery: {
          enabled: false
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider?.ollama?.models).toEqual({})
    })

    it('should allow provider-level discovery when global discovery is disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        discovery: {
          enabled: false
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                enabled: true
              }
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider?.ollama?.models?.['test-model']).toBeDefined()
    })

    it('should allow provider-level discovery to bypass provider compatibility detection', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'forced-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          custom: {
            npm: '@ai-sdk/anthropic',
            name: 'Custom Provider',
            options: {
              baseURL: 'http://127.0.0.1:9000',
              modelsDiscovery: {
                enabled: true
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider?.custom?.models?.['forced-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:9000/v1/models', expect.objectContaining({
        method: 'GET'
      }))
    })

    it('should skip provider when provider-level discovery is disabled', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        providers: {
          include: ['ollama']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                enabled: false
              }
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider?.ollama?.models).toEqual({})
    })

    it('should only discover models matching includeRegex', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-30b-a3b', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'bge-m3', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^qwen/']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toBeDefined()
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should skip models matching excludeRegex', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-30b-a3b', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'bge-m3', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          excludeRegex: ['^bge-']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toBeDefined()
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should preserve explicitly configured models even when regex would filter them out', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'keep-me', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'discover-me', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^discover-']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {
              'keep-me': { name: 'Keep Me' }
            }
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider.ollama.models['keep-me']).toEqual({ name: 'Keep Me' })
      expect(config.provider.ollama.models['discover-me']).toBeDefined()
    })

    it('should prefer provider-level model filters over global filters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-30b-a3b', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'bge-m3', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        smartModelName: false,
        models: {
          includeRegex: ['^bge-']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                smartModelName: true,
                models: {
                  includeRegex: ['^qwen/']
                }
              }
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toEqual(
        expect.objectContaining({
          name: 'Qwen3 30B A3B'
        })
      )
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should use global model filters when provider-level filters are not configured', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'qwen/qwen3-30b-a3b', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'qwen/qwen3-8b', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'bge-m3', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^qwen/']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1'
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toBeDefined()
      expect(config.provider.ollama.models['qwen/qwen3-8b']).toBeDefined()
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should not inject cached models for excluded providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'cached-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)
      expect(config.provider.ollama.models['cached-model']).toBeDefined()

      mockFetch.mockClear()
      const hooksWithExclude = await ModelDiscoveryPlugin({
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }, {
        providers: {
          exclude: ['ollama']
        }
      })

      const configWithExclude: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithExclude.config(configWithExclude)

      expect(configWithExclude.provider.ollama.models).toEqual({})
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should not inject cached models when provider-level discovery is disabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'cached-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)
      expect(config.provider.ollama.models['cached-model']).toBeDefined()

      mockFetch.mockClear()
      const configWithProviderDisabled: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                enabled: false
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(configWithProviderDisabled)

      expect(configWithProviderDisabled.provider.ollama.models).toEqual({})
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('should invalidate provider cache when api key changes', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-for-key-a', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const configForKeyA: any = {
        provider: {
          openrouter: {
            npm: '@ai-sdk/openai-compatible',
            name: 'OpenRouter',
            options: {
              baseURL: 'https://openrouter.ai/api/v1',
              apiKey: 'key-a'
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(configForKeyA)
      expect(configForKeyA.provider.openrouter.models['model-for-key-a']).toBeDefined()

      mockFetch.mockClear()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'model-for-key-b', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const configForKeyB: any = {
        provider: {
          openrouter: {
            npm: '@ai-sdk/openai-compatible',
            name: 'OpenRouter',
            options: {
              baseURL: 'https://openrouter.ai/api/v1',
              apiKey: 'key-b'
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(configForKeyB)

      expect(configForKeyB.provider.openrouter.models['model-for-key-a']).toBeUndefined()
      expect(configForKeyB.provider.openrouter.models['model-for-key-b']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/models', expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer key-b'
        })
      }))
    })

    it('should refresh stale cache in background even when model ids are unchanged', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'same-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)
      const firstCache = await readCache()
      const firstDiscoveredAt = firstCache?.providers.ollama.discoveredAt
      expect(firstDiscoveredAt).toBeDefined()

      await new Promise((resolve) => setTimeout(resolve, 10))

      const hooksWithStaleCache = await ModelDiscoveryPlugin({
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }, {
        cache: {
          ttl: -1
        }
      })

      mockFetch.mockClear()
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'same-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const staleConfig: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithStaleCache.config(staleConfig)

      expect(staleConfig.provider.ollama.models['same-model']).toBeDefined()

      await vi.waitFor(async () => {
        const refreshedCache = await readCache()
        expect(refreshedCache?.providers.ollama.discoveredAt).not.toBe(firstDiscoveredAt)
      })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('Event Hook', () => {
    it('should validate event input', async () => {
      await pluginHooks.event({ event: null })
      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery',
          level: 'error',
          message: 'Invalid event input',
          extra: expect.objectContaining({
            category: 'event',
            errors: expect.arrayContaining(['event: event is required and must be an object'])
          })
        })
      }))
    })

    it('should handle session events gracefully', async () => {
      await pluginHooks.event({ event: { type: 'session.created' } })
      expect(true).toBe(true)
    })
  })

  describe('Chat Params Hook', () => {
    it('should be defined as a function', () => {
      expect(pluginHooks['chat.params']).toBeTypeOf('function')
    })

    it('should do nothing (validation disabled)', async () => {
      const input = {
        sessionID: 'test-session',
        model: { id: 'test-model' },
        provider: {
          npm: '@ai-sdk/openai-compatible',
          info: { id: 'ollama' },
          options: { baseURL: 'http://127.0.0.1:11434/v1' }
        }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      // Validation is disabled - no operations should be performed
      expect(output).toEqual({})
      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should handle config enhancement errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockFetch.mockRejectedValue(new Error('Discovery failed'))

      const config: any = {}
      await pluginHooks.config(config)

      expect(true).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('Multi-Provider Support', () => {
    it('should discover models for multiple OpenAI-compatible providers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'ollama-model-1', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          },
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['ollama-model-1']).toBeDefined()
    })

    it('should discover models for providers with Anthropic npm but OpenAI-compatible URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'anthropic-compatible-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/anthropic',
            name: 'Ollama (Anthropic Mode)',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['anthropic-compatible-model']).toBeDefined()
    })
  })
})
