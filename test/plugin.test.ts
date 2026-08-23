import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { ModelDiscoveryPlugin } from '../src/index.ts'
import { modelsDevTestUtils } from '../src/utils/models-dev-fetcher.ts'
import { providerModelStoreTestUtils } from '../src/plugin/enhance-config.ts'
import { ProviderModelStore } from '../src/plugin/provider-model-store.ts'

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

describe('ModelDiscovery Plugin', () => {
  let mockClient: any
  let pluginHooks: any
  let cacheRoot: string

  beforeEach(async () => {
    mockFetch.mockClear()
    modelsDevTestUtils.resetCache()
    delete process.env.OPENCODE_AUTH_CONTENT
    delete process.env.OPENCODE
    delete process.env.OPENCODE_PID
    delete process.env.MIMOCODE
    delete process.env.MIMOCODE_PID
    delete process.env.OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED
    cacheRoot = await mkdtemp(path.join(os.tmpdir(), 'models-discovery-plugin-'))
    providerModelStoreTestUtils.setStore(new ProviderModelStore(cacheRoot))

    mockClient = {
      app: {
        log: vi.fn().mockResolvedValue(true)
      },
      config: {
        providers: vi.fn().mockResolvedValue({ data: { providers: [] } })
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
    delete process.env.OPENCODE_AUTH_CONTENT
    delete process.env.OPENCODE
    delete process.env.OPENCODE_PID
    delete process.env.MIMOCODE
    delete process.env.MIMOCODE_PID
    delete process.env.OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED
    providerModelStoreTestUtils.resetStore()
    await rm(cacheRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
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
      expect(hooks['chat.params']).toBeUndefined()
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
      expect(hooks['chat.params']).toBeUndefined()
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

    it('should warn once when legacy global discovery config is used', async () => {
      vi.useFakeTimers()

      try {
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
        } as any, {
          discovery: {
            enabled: false
          }
        })

        const config: any = {
          command: {
            existing: {
              description: 'Existing command',
              template: 'Keep me',
            }
          }
        }

        await hooksWithConfig.config(config)
        await hooksWithConfig.config(config)

        expect(config.command.existing).toEqual({
          description: 'Existing command',
          template: 'Keep me',
        })
        expect(config.command['models-discovery:migrate']).toEqual(expect.objectContaining({
          description: 'Migrate opencode-models-discovery config',
          agent: 'build',
          template: expect.stringContaining('Use the customize-opencode skill.'),
        }))
        expect(config.command['models-discovery:migrate'].model).toBeUndefined()
        expect(config.command['models-discovery:migrate'].template).toContain('opencode.json, opencode.jsonc, or .opencode/opencode.json')
        expect(config.command['models-discovery:migrate'].template).toContain('~/.config/opencode/opencode.json')
        expect(config.command['models-discovery:migrate'].template).toContain('OPENCODE_CONFIG')
        expect(config.command['models-discovery:migrate'].template).toContain('/Library/Application Support/opencode/')
        expect(config.command['models-discovery:migrate'].template).toContain('/etc/opencode/')
        expect(config.command['models-discovery:migrate'].template).toContain('%ProgramData%\\opencode')
        expect(config.command['models-discovery:migrate'].template).toContain('discovery.enabled')
        expect(config.command['models-discovery:migrate'].template).toContain('provider.<id>.options.modelsDiscovery')
        expect(config.command['models-discovery:migrate'].template).toContain('Field mapping:')
        expect(config.command['models-discovery:migrate'].template).toContain('enabled_providers and disabled_providers')
        expect(config.command['models-discovery:migrate'].template).toContain('OpenCode /connect credentials')
        expect(config.command['models-discovery:migrate'].template).toContain('After v1.0.0, provider-level modelsDiscovery is the configuration boundary')
        expect(config.command['models-discovery:migrate'].template).toContain('OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED=false')
        expect(config.command['models-discovery:migrate'].template).toContain('restart opencode')
        expect(config.command['models-discovery:config']).toEqual(expect.objectContaining({
          description: 'Configure opencode-models-discovery',
          agent: 'build',
          template: expect.stringContaining('Help configure opencode-models-discovery using the recommended provider-level configuration style.'),
        }))
        expect(config.command['models-discovery:config'].model).toBeUndefined()
        expect(config.command['models-discovery:config'].template).toContain('Use the customize-opencode skill.')
        expect(config.command['models-discovery:config'].template).toContain('provider.<id>.options.modelsDiscovery')
        expect(config.command['models-discovery:config'].template).toContain('endpoint')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoEndpoint')
        expect(config.command['models-discovery:config'].template).toContain('filterNonChat')
        expect(config.command['models-discovery:config'].template).toContain('enabled_providers and disabled_providers')
        expect(config.command['models-discovery:config'].template).toContain('OpenCode /connect credentials')
        expect(config.command['models-discovery:config'].template).toContain('@ai-sdk/openai-compatible')
        expect(config.command['models-discovery:config'].template).toContain('non-standard models paths should set modelsDiscovery.endpoint')
        expect(config.command['models-discovery:config'].template).toContain('v1.0.0 ignores plugin-level global discovery config at runtime')
        expect(config.command['models-discovery:config'].template).toContain('includeBy')
        expect(config.command['models-discovery:config'].template).toContain('excludeBy')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="models.dev"')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="bifrost"')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="litellm"')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="vllm"')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="lmstudio"')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="llama-swap"')
        expect(config.command['models-discovery:config'].template).toContain('modelInfoFormat="omniroute"')
        expect(config.command['models-discovery:config'].template).toContain('max_model_len')
        expect(config.command['models-discovery:config'].template).toContain('restart opencode')

        expect(mockClient.tui.showToast).not.toHaveBeenCalled()

        await hooksWithConfig.event({ event: { type: 'session.created' } })
        expect(mockClient.tui.showToast).not.toHaveBeenCalled()

        await hooksWithConfig.event({ event: { type: 'reference.updated', properties: {} } })

        expect(mockClient.tui.showToast).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(500)
        expect(mockClient.tui.showToast).toHaveBeenCalledTimes(1)
        expect(mockClient.tui.showToast).toHaveBeenCalledWith({
          body: expect.objectContaining({
            title: 'Discovery Config Migration',
            variant: 'warning',
            message: expect.stringContaining('Global opencode-models-discovery config is no longer applied in v1.0.0')
          })
        })

        await hooksWithConfig.event({ event: { type: 'server.connected', properties: {} } })
        await vi.advanceTimersByTimeAsync(1500)
        expect(mockClient.tui.showToast).toHaveBeenCalledTimes(2)

        await vi.advanceTimersByTimeAsync(3000)
        expect(mockClient.tui.showToast).toHaveBeenCalledTimes(3)

        await vi.advanceTimersByTimeAsync(5000)
        expect(mockClient.tui.showToast).toHaveBeenCalledTimes(4)

        await hooksWithConfig.event({ event: { type: 'reference.updated', properties: {} } })
        await vi.advanceTimersByTimeAsync(10000)
        expect(mockClient.tui.showToast).toHaveBeenCalledTimes(4)

        expect(mockClient.app.log).toHaveBeenCalledWith(expect.objectContaining({
          body: expect.objectContaining({
            level: 'warn',
            message: 'Legacy global opencode-models-discovery config was detected but is ignored in v1.0.0. Use provider.<name>.options.modelsDiscovery instead.',
            extra: expect.objectContaining({
              category: 'config',
              migrationCommand: '/models-discovery:migrate'
            })
          })
        }))
      } finally {
        vi.useRealTimers()
      }
    })

    it('should not show migration warning for provider-level discovery config only', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: []
        })
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

      await pluginHooks.config(config)

      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
      expect(config.command['models-discovery:config']).toEqual(expect.objectContaining({
        description: 'Configure opencode-models-discovery',
        agent: 'build',
        template: expect.stringContaining('Use the customize-opencode skill.'),
      }))
      expect(config.command['models-discovery:migrate']).toBeUndefined()
    })

    it('should warn when includeBy or excludeBy are placed outside modelsDiscovery.models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: []
        })
      })

      const config: any = {
        provider: {
          gateway: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Gateway',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                includeBy: [
                  { field: 'id', match: '^deepseek-' }
                ],
                excludeBy: [
                  { field: 'id', match: 'embedding' }
                ]
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockClient.app.log).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery',
          level: 'warn',
          message: 'Config warnings',
          extra: expect.objectContaining({
            category: 'config',
            warnings: expect.arrayContaining([
              "Provider 'gateway' modelsDiscovery.includeBy is ignored; use modelsDiscovery.models.includeBy instead",
              "Provider 'gateway' modelsDiscovery.excludeBy is ignored; use modelsDiscovery.models.excludeBy instead"
            ])
          })
        })
      }))
    })

    it('should not overwrite existing migration and config commands', async () => {
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
      } as any, {
        models: {
          includeRegex: '^llama'
        }
      })

      const config: any = {
        command: {
          'models-discovery:migrate': {
            description: 'User command',
            template: 'Do not replace this',
          },
          'models-discovery:config': {
            description: 'User config command',
            template: 'Keep custom config command',
          }
        }
      }

      await hooksWithConfig.config(config)

      expect(config.command['models-discovery:migrate']).toEqual({
        description: 'User command',
        template: 'Do not replace this',
      })
      expect(config.command['models-discovery:config']).toEqual({
        description: 'User config command',
        template: 'Keep custom config command',
      })
      expect(mockClient.app.log).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          level: 'warn',
          message: 'Migration command already exists; leaving user-defined command unchanged',
          extra: expect.objectContaining({
            command: 'models-discovery:migrate',
          })
        })
      }))
      expect(mockClient.app.log).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          level: 'warn',
          message: 'Config command already exists; leaving user-defined command unchanged',
          extra: expect.objectContaining({
            command: 'models-discovery:config',
          })
        })
      }))
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
      await pluginHooks.config(config)

      expect(config.provider?.ollama?.models).toBeDefined()
      expect(Object.keys(config.provider.ollama.models).length).toBe(2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/models', expect.objectContaining({
        method: 'GET'
      }))
    })

    it('uses a fresh persisted inventory without resolving credentials or requesting models', async () => {
      const store = new ProviderModelStore(cacheRoot)
      await store.saveModels({
        id: 'cached',
        baseURL: 'http://127.0.0.1:8000',
        endpoint: '/v1/models',
      }, { 'cached-model': { id: 'cached-model', name: 'Cached Model', reasoning: true } })

      const config: any = {
        provider: {
          cached: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8000/v1',
              modelsDiscovery: { cache: { enabled: true } },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)

      expect(config.provider.cached.models['cached-model']).toBeDefined()
      expect(config.provider.cached.models['cached-model'].reasoning).toBe(true)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockClient.config.providers).not.toHaveBeenCalled()
    })

    it('merges matching explicit models into a fresh persisted inventory', async () => {
      const store = new ProviderModelStore(cacheRoot)
      await store.saveModels({
        id: 'cached',
        baseURL: 'http://127.0.0.1:8000',
        endpoint: '/v1/models',
      }, {
        'cached-model': {
          id: 'cached-model',
          name: 'Cached Model',
          limit: { context: 32768, output: 4096 },
          modalities: { input: ['text', 'image'], output: ['text'] },
          reasoning: true,
        },
      })

      const config: any = {
        provider: {
          cached: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8000/v1',
              modelsDiscovery: { cache: { enabled: true } },
            },
            models: {
              'cached-model': {
                id: 'other-model',
                variants: { custom: { reasoningEffort: 'high' } },
              },
              standalone: { name: 'Standalone Model' },
            },
          },
        },
      }

      await pluginHooks.config(config)

      expect(config.provider.cached.models).toEqual({
        'cached-model': {
          id: 'cached-model',
          name: 'Cached Model',
          limit: { context: 32768, output: 4096 },
          modalities: { input: ['text', 'image'], output: ['text'] },
          reasoning: true,
          variants: { custom: { reasoningEffort: 'high' } },
        },
        standalone: { name: 'Standalone Model' },
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('merges matching explicit models into discovered enriched metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'chat-model', object: 'model', max_model_len: 32768 }],
        }),
      })

      const config: any = {
        provider: {
          test: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8000/v1',
              modelsDiscovery: { modelInfoFormat: 'vllm', smartModelName: true },
            },
            models: {
              'chat-model': {
                id: 'other-model',
                variants: { custom: { reasoningEffort: 'high' } },
              },
            },
          },
        },
      }

      await pluginHooks.config(config)

      expect(config.provider.test.models['chat-model']).toEqual({
        id: 'chat-model',
        name: 'Chat Model',
        limit: { context: 32768, output: 32768 },
        modalities: { input: ['text'], output: ['text'] },
        variants: { custom: { reasoningEffort: 'high' } },
      })
    })

    it('persists only filtered enriched models and reuses their metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'chat-model', object: 'model', max_model_len: 32768 },
            { id: 'embedding-model', object: 'model', max_model_len: 8192 },
          ],
        }),
      })

      const config: any = {
        provider: {
          cached: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8000/v1',
              modelsDiscovery: {
                modelInfoFormat: 'vllm',
                cache: { enabled: true },
              },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)

      const store = new ProviderModelStore(cacheRoot)
      const state = await store.read({
        id: 'cached',
        baseURL: 'http://127.0.0.1:8000',
        endpoint: '/v1/models',
      })
      expect(state?.models).toEqual({
        'chat-model': expect.objectContaining({
          id: 'chat-model',
          limit: { context: 32768, output: 32768 },
        }),
      })
      expect(state?.models['embedding-model']).toBeUndefined()

      const secondConfig: any = {
        provider: {
          cached: {
            npm: '@ai-sdk/openai-compatible',
            options: config.provider.cached.options,
            models: {},
          },
        },
      }
      mockFetch.mockClear()
      await pluginHooks.config(secondConfig)

      expect(secondConfig.provider.cached.models['chat-model'].limit).toEqual({ context: 32768, output: 32768 })
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('enriches Bifrost inline metadata without another request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            id: 'bedrock/anthropic.claude-sonnet-4-6',
            object: 'model',
            created: 0,
            owned_by: 'bifrost',
            normalized_name: 'Claude Sonnet 4.6',
            context_length: 200000,
            max_input_tokens: 200000,
            max_output_tokens: 8192,
            architecture: { input_modalities: ['TEXT', 'IMAGE', 'SPEECH'], output_modalities: ['TEXT'] },
            pricing: { prompt: '0.000003', completion: '0.000015' },
          }],
        }),
      })

      const config: any = {
        provider: {
          bifrost: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8080/v1',
              modelsDiscovery: { modelInfoFormat: 'bifrost', smartModelName: true },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(config.provider.bifrost.models['bedrock/anthropic.claude-sonnet-4-6']).toMatchObject({
        id: 'bedrock/anthropic.claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        limit: { context: 200000, input: 200000, output: 8192 },
        modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
        cost: { input: 3, output: 15 },
      })
    })

    it('enriches llama-swap inline metadata without another request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            id: 'Gemma-4-31B-It',
            object: 'model',
            created: 0,
            owned_by: 'llama-swap',
            name: 'Gemma 4 31B IT',
            context_length: 9216,
            architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            capabilities: { function_calling: true, vision: true },
            supported_parameters: ['tools', 'tool_choice'],
            meta: { n_ctx: 9216, llamaswap: { type: 'model' } },
          }],
        }),
      })

      const config: any = {
        provider: {
          llamaswap: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8080/v1',
              modelsDiscovery: { modelInfoFormat: 'llama-swap', smartModelName: true },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(config.provider.llamaswap.models['Gemma-4-31B-It']).toMatchObject({
        id: 'Gemma-4-31B-It',
        name: 'Gemma 4 31B IT',
        limit: { context: 9216, output: 0 },
        modalities: { input: ['text', 'image'], output: ['text'] },
        tool_call: true,
      })
    })

    it('enriches OmniRoute inline metadata without another request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{
            id: 'oc/mimo-v2.5-free',
            object: 'model',
            created: 0,
            owned_by: 'oc',
            context_length: 128000,
            max_input_tokens: 120000,
            max_output_tokens: 8192,
            input_modalities: ['TEXT', 'IMAGE'],
            output_modalities: ['TEXT'],
            capabilities: { vision: true, tool_calling: true, reasoning: true },
          }],
        }),
      })

      const config: any = {
        provider: {
          omniroute: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:20128/v1',
              modelsDiscovery: { modelInfoFormat: 'omniroute' },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(config.provider.omniroute.models['oc/mimo-v2.5-free']).toMatchObject({
        id: 'oc/mimo-v2.5-free',
        limit: { context: 128000, input: 120000, output: 8192 },
        modalities: { input: ['text', 'image'], output: ['text'] },
        tool_call: true,
        reasoning: true,
      })
    })

    it('does not inject expired inventory after a failed refresh but keeps explicit models', async () => {
      const store = new ProviderModelStore(cacheRoot)
      await store.saveModels({
        id: 'expired',
        baseURL: 'http://127.0.0.1:8000',
        endpoint: '/v1/models',
      }, { 'stale-model': { id: 'stale-model', name: 'Stale Model' } })
      mockFetch.mockResolvedValueOnce({ ok: false })

      const config: any = {
        provider: {
          expired: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:8000/v1',
              modelsDiscovery: { cache: { enabled: true, ttlSeconds: 0 } },
            },
            models: { explicit: { id: 'explicit', name: 'Explicit model' } },
          },
        },
      }

      await pluginHooks.config(config)

      expect(config.provider.expired.models).toEqual({ explicit: { id: 'explicit', name: 'Explicit model' } })
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('should use resolved provider key from OpenCode auth when options.apiKey is absent', async () => {
      mockClient.config.providers.mockResolvedValueOnce({
        data: {
          providers: [
            { id: 'test_provider', key: 'connected-key' }
          ]
        }
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'connected-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          test_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Test Provider',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.test_provider.models['connected-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer connected-key'
        })
      }))
    })

    it('should prefer explicit options.apiKey over resolved provider key', async () => {
      mockClient.config.providers.mockResolvedValueOnce({
        data: {
          providers: [
            { id: 'test_provider', key: 'connected-key' }
          ]
        }
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'explicit-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          test_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Test Provider',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              apiKey: 'explicit-key'
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.test_provider.models['explicit-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer explicit-key'
        })
      }))
    })

    it('should not block explicit apiKey providers on resolved provider loading', async () => {
      mockClient.config.providers.mockImplementationOnce(() => new Promise(() => {}))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'explicit-fast-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          hyy: {
            npm: '@ai-sdk/openai-compatible',
            name: 'HYY',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              apiKey: 'explicit-key'
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockClient.config.providers).not.toHaveBeenCalled()
      expect(config.provider.hyy.models['explicit-fast-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer explicit-key'
        })
      }))
    })

    it('should continue discovery without auth when resolved providers cannot be loaded', async () => {
      mockClient.config.providers.mockRejectedValueOnce(new Error('provider resolution failed'))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'fallback-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          no_auth_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'No Auth Provider',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.no_auth_provider.models['fallback-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.not.objectContaining({
          Authorization: expect.any(String)
        })
      }))
    })

    it('should fall back to OpenCode auth content when resolved providers cannot be loaded', async () => {
      process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
        test_provider: {
          type: 'api',
          key: 'auth-store-key'
        }
      })
      mockClient.config.providers.mockRejectedValueOnce(new Error('provider resolution failed'))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'auth-store-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          test_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Test Provider',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.test_provider.models['auth-store-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer auth-store-key'
        })
      }))
    })

    it('should read the OpenCode host auth store when OPENCODE is set', async () => {
      process.env.OPENCODE = '1'
      process.env.OPENCODE_PID = '12345'

      const readFileSpy = vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
        test_provider: {
          type: 'api',
          key: 'host-auth-key'
        }
      }) as any)

      mockClient.config.providers.mockRejectedValueOnce(new Error('provider resolution failed'))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'host-auth-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          test_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Test Provider',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(readFileSpy).toHaveBeenCalledWith(expect.stringMatching(/\/opencode\/auth\.json$/), 'utf8')
      expect(config.provider.test_provider.models['host-auth-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer host-auth-key'
        })
      }))
    })

    it('should default to the OpenCode host auth store when no host env is set', async () => {
      const readFileSpy = vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
        test_provider: {
          type: 'api',
          key: 'default-host-auth-key'
        }
      }) as any)

      mockClient.config.providers.mockRejectedValueOnce(new Error('provider resolution failed'))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'default-host-auth-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          test_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Test Provider',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(readFileSpy).toHaveBeenCalledWith(expect.stringMatching(/\/opencode\/auth\.json$/), 'utf8')
      expect(config.provider.test_provider.models['default-host-auth-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer default-host-auth-key'
        })
      }))
    })

    it('should read the Mimocode host auth store when MIMOCODE is set', async () => {
      process.env.MIMOCODE = '1'
      process.env.MIMOCODE_PID = '67890'

      const readFileSpy = vi.spyOn(fs, 'readFile').mockResolvedValue(JSON.stringify({
        test_provider: {
          type: 'api',
          key: 'mimo-auth-key'
        }
      }) as any)

      mockClient.config.providers.mockRejectedValueOnce(new Error('provider resolution failed'))
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'mimo-auth-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          test_provider: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Test Provider',
            options: { baseURL: 'http://127.0.0.1:4000/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(readFileSpy).toHaveBeenCalledWith(expect.stringMatching(/\/mimocode\/auth\.json$/), 'utf8')
      expect(config.provider.test_provider.models['mimo-auth-model']).toBeDefined()
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/models', expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer mimo-auth-key'
        })
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

    it('should enrich models from models.dev when explicitly configured as model info format', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'openai/gpt-4o', object: 'model', created: 1234567890, owned_by: 'openai' },
              { id: 'unknown/local-model', object: 'model', created: 1234567890, owned_by: 'local' }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            openai: {
              models: {
                'gpt-4o': {
                  id: 'gpt-4o',
                  attachment: true,
                  reasoning: false,
                  tool_call: true,
                  structured_output: true,
                  temperature: true,
                  modalities: {
                    input: ['text', 'image'],
                    output: ['text']
                  },
                  limit: {
                    context: 128000,
                    output: 16384
                  }
                }
              }
            }
          })
        })

      const config: any = {
        provider: {
          openai: {
            npm: '@ai-sdk/openai-compatible',
            name: 'OpenAI',
            options: {
              baseURL: 'https://api.openai.com/v1',
              modelsDiscovery: {
                modelInfoFormat: 'models.dev',
                modelInfoEndpoint: 'https://mirror.example/models.json'
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://api.openai.com/v1/models', expect.objectContaining({
        method: 'GET'
      }))
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://mirror.example/models.json', expect.objectContaining({
        method: 'GET'
      }))
      expect(config.provider.openai.models['openai/gpt-4o']).toEqual(expect.objectContaining({
        id: 'openai/gpt-4o',
        attachment: true,
        reasoning: false,
        tool_call: true,
        structured_output: true,
        temperature: true,
        modalities: {
          input: ['text', 'image'],
          output: ['text']
        },
        limit: {
          context: 128000,
          output: 16384
        }
      }))
      expect(config.provider.openai.models['unknown/local-model']).not.toHaveProperty('limit')
      expect(config.provider.openai.models['unknown/local-model']).not.toHaveProperty('tool_call')
    })

    it('should use models.dev display names for custom provider smart names', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'custom/gpt-4o', object: 'model', created: 1234567890, owned_by: 'local' }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            openai: {
              models: {
                'gpt-4o': {
                  id: 'gpt-4o',
                  name: 'GPT-4o',
                  tool_call: true,
                  limit: { context: 128000 }
                }
              }
            }
          })
        })

      const config: any = {
        provider: {
          custom: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Custom',
            options: {
              baseURL: 'http://127.0.0.1:9000/v1',
              modelsDiscovery: {
                modelInfoFormat: 'models.dev',
                smartModelName: true
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.custom.models['custom/gpt-4o']).toEqual(expect.objectContaining({
        id: 'custom/gpt-4o',
        name: 'GPT-4o',
        tool_call: true,
        limit: { context: 128000, output: 0 }
      }))
    })

    it('should keep raw ids when models.dev has names but smart model names are disabled', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'custom/gpt-4o', object: 'model', created: 1234567890, owned_by: 'local' }
            ]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            openai: {
              models: {
                'gpt-4o': {
                  id: 'gpt-4o',
                  name: 'GPT-4o',
                  tool_call: true
                }
              }
            }
          })
        })

      const config: any = {
        provider: {
          custom: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Custom',
            options: {
              baseURL: 'http://127.0.0.1:9000/v1',
              modelsDiscovery: {
                modelInfoFormat: 'models.dev'
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.custom.models['custom/gpt-4o']).toEqual(expect.objectContaining({
        id: 'custom/gpt-4o',
        name: 'custom/gpt-4o',
        tool_call: true
      }))
    })

    it('should continue discovery when models.dev metadata cannot be fetched', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              { id: 'local-model', object: 'model', created: 1234567890, owned_by: 'local' }
            ]
          })
        })
        .mockRejectedValueOnce(new Error('models.dev unavailable'))

      const config: any = {
        provider: {
          local: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Local',
            options: {
              baseURL: 'http://127.0.0.1:9000/v1',
              modelsDiscovery: {
                modelInfoFormat: 'models.dev'
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.local.models['local-model']).toEqual(expect.objectContaining({
        id: 'local-model'
      }))
      expect(config.provider.local.models['local-model']).not.toHaveProperty('limit')
    })

    it('should skip embedding models even when model info is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'Qwen/Qwen3-VL-Embedding-8B', object: 'model', created: 1234567890, owned_by: 'openai' },
            { id: 'Qwen/Qwen3-VL-32B-Instruct', object: 'model', created: 1234567890, owned_by: 'openai' },
            { id: 'deepseek/deepseek-v4-flash', object: 'model', created: 1234567890, owned_by: 'openai' }
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
          input: ['text'],
          output: ['text']
        }
      }))
      expect(config.provider.litellm.models['deepseek/deepseek-v4-flash']).toEqual(expect.objectContaining({
        id: 'deepseek/deepseek-v4-flash',
        modalities: {
          input: ['text'],
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

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                smartModelName: true
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

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

    it('should ignore legacy providers.exclude at runtime', async () => {
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

      expect(config.provider?.ollama?.models?.['test-model']).toBeDefined()
    })

    it('should ignore legacy providers.include at runtime', async () => {
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
      expect(config.provider?.ollama?.models?.['test-model']).toBeDefined()
    })

    it('should ignore legacy discovery.enabled=false at runtime', async () => {
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

      expect(config.provider?.ollama?.models?.['test-model']).toBeDefined()
    })

    it('should allow provider-level discovery when legacy global discovery is disabled', async () => {
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

    it('should ignore legacy global model includeRegex at runtime', async () => {
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
      expect(config.provider.ollama.models['bge-m3']).toBeDefined()
    })

    it('should ignore legacy global model excludeRegex at runtime', async () => {
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
      expect(config.provider.ollama.models['bge-m3']).toBeDefined()
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

      expect(config.provider.ollama.models['keep-me']).toEqual({
        id: 'keep-me',
        name: 'Keep Me',
        modalities: { input: ['text'], output: ['text'] },
      })
      expect(config.provider.ollama.models['discover-me']).toBeDefined()
    })

    it('should use provider-level model filters and smart model names', async () => {
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

    it('should ignore legacy global model filters when provider-level filters are not configured', async () => {
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
      expect(config.provider.ollama.models['bge-m3']).toBeDefined()
    })

    it('should use OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED=false only for unspecified providers', async () => {
      process.env.OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED = 'false'
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          disabledByDefault: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Disabled By Default',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          },
          explicitlyEnabled: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Explicitly Enabled',
            options: {
              baseURL: 'http://127.0.0.1:1234/v1',
              modelsDiscovery: { enabled: true }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.disabledByDefault.models).toEqual({})
      expect(config.provider.explicitlyEnabled.models['test-model']).toBeDefined()
    })

    it('should let explicit provider-level enabled=false override env default true', async () => {
      process.env.OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED = 'true'
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'test-model', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: { enabled: false }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models).toEqual({})
    })

    it('should filter models by provider-level includeBy and excludeBy raw fields', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'chat-available', object: 'model', created: 1234567890, owned_by: 'local', type: 'chat', available: true },
            { id: 'chat-unavailable', object: 'model', created: 1234567890, owned_by: 'local', type: 'chat', available: false },
            { id: 'embedding-available', object: 'model', created: 1234567890, owned_by: 'local', type: 'embedding', available: true },
            { id: 'missing-fields', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          gateway: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Gateway',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                models: {
                  includeBy: [{ field: 'type', equals: 'chat' }],
                  excludeBy: [{ field: 'available', equals: false }]
                }
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.gateway.models['chat-available']).toBeDefined()
      expect(config.provider.gateway.models['chat-unavailable']).toBeUndefined()
      expect(config.provider.gateway.models['embedding-available']).toBeUndefined()
      expect(config.provider.gateway.models['missing-fields']).toBeUndefined()
    })

    it('should not treat nested field names as paths for includeBy', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'nested-only', object: 'model', created: 1234567890, owned_by: 'local', metadata: { type: 'chat' } },
            { id: 'literal-field', object: 'model', created: 1234567890, owned_by: 'local', 'metadata.type': 'chat' }
          ]
        })
      })

      const config: any = {
        provider: {
          gateway: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Gateway',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                models: {
                  includeBy: [{ field: 'metadata.type', equals: 'chat' }]
                }
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.gateway.models['nested-only']).toBeUndefined()
      expect(config.provider.gateway.models['literal-field']).toBeDefined()
    })

    it('should reject invalid includeBy equals values', async () => {
      const config: any = {
        provider: {
          gateway: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Gateway',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                models: {
                  includeBy: [{ field: 'metadata', equals: { type: 'chat' } }]
                }
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery',
          level: 'error',
          message: 'Invalid config provided',
          extra: expect.objectContaining({
            category: 'config',
            errors: expect.arrayContaining(["Provider 'gateway' modelsDiscovery.models.includeBy[0].equals must be a string, number, boolean, or null"])
          })
        })
      }))
    })

    it('should filter models by provider-level includeBy and excludeBy regex matches', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'deepseek-chat', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'deepseek-reasoner', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'deepseek-embedding', object: 'model', created: 1234567890, owned_by: 'local' },
            { id: 'qwen-chat', object: 'model', created: 1234567890, owned_by: 'local' }
          ]
        })
      })

      const config: any = {
        provider: {
          gateway: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Gateway',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                models: {
                  includeBy: [{ field: 'id', match: '^deepseek-' }],
                  excludeBy: [{ field: 'id', match: 'embedding$' }]
                }
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.gateway.models['deepseek-chat']).toBeDefined()
      expect(config.provider.gateway.models['deepseek-reasoner']).toBeDefined()
      expect(config.provider.gateway.models['deepseek-embedding']).toBeUndefined()
      expect(config.provider.gateway.models['qwen-chat']).toBeUndefined()
    })

    it('enriches OpenAI-discovered models from the LM Studio inventory endpoint', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/api/v1/models')) {
          return {
            ok: true,
            json: async () => ({
              models: [{
                type: 'llm',
                key: 'qwen/qwen3',
                display_name: 'Qwen 3',
                loaded_instances: [{ config: { context_length: 8192 } }],
                capabilities: { trained_for_tool_use: true },
              }],
            }),
          }
        }
        if (url.endsWith('/v1/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'qwen/qwen3', object: 'model', created: 0, owned_by: 'lmstudio' }] }) }
        }
        return { ok: false }
      })
      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:1234/v1',
              modelsDiscovery: { modelInfoFormat: 'lmstudio' },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:1234/v1/models', expect.any(Object))
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:1234/api/v1/models', expect.any(Object))
      expect(config.provider.lmstudio.models['qwen/qwen3']).toMatchObject({
        id: 'qwen/qwen3',
        limit: { context: 8192, output: 0 },
        tool_call: true,
      })
    })

    it('keeps generic discovery when LM Studio metadata discovery fails', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/v1/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'generic-model', object: 'model', created: 0, owned_by: 'lmstudio' }] }) }
        }
        return { ok: false }
      })
      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:1234/v1',
              modelsDiscovery: { modelInfoFormat: 'lmstudio' },
            },
            models: { explicit: { id: 'explicit', name: 'Explicit model' } },
          },
        },
      }

      await pluginHooks.config(config)

      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:1234/api/v1/models', expect.any(Object))
      expect(config.provider.lmstudio.models).toEqual(expect.objectContaining({
        explicit: { id: 'explicit', name: 'Explicit model' },
        'generic-model': expect.objectContaining({ id: 'generic-model' }),
      }))
      expect(config.provider.lmstudio.models['generic-model'].limit).toBeUndefined()
    })

    it('reuses enriched LM Studio models from a fresh cache without requests', async () => {
      mockFetch.mockImplementation(async (url: string) => {
        if (url.endsWith('/api/v1/models')) {
          return { ok: true, json: async () => ({ models: [{ key: 'qwen/qwen3', loaded_instances: [{ config: { context_length: 8192 } }] }] }) }
        }
        if (url.endsWith('/v1/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'qwen/qwen3', object: 'model', created: 0, owned_by: 'lmstudio' }] }) }
        }
        return { ok: false }
      })
      const config: any = {
        provider: {
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            options: {
              baseURL: 'http://127.0.0.1:1234/v1',
              modelsDiscovery: { modelInfoFormat: 'lmstudio', cache: { enabled: true, ttlSeconds: 60 } },
            },
            models: {},
          },
        },
      }

      await pluginHooks.config(config)
      mockFetch.mockClear()
      const cachedConfig: any = {
        provider: {
          lmstudio: {
            ...config.provider.lmstudio,
            models: {},
          },
        },
      }

      await pluginHooks.config(cachedConfig)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(cachedConfig.provider.lmstudio.models['qwen/qwen3'].limit).toEqual({ context: 8192, output: 0 })
    })

    it('should reject field filters that specify both equals and match', async () => {
      const config: any = {
        provider: {
          gateway: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Gateway',
            options: {
              baseURL: 'http://127.0.0.1:4000/v1',
              modelsDiscovery: {
                models: {
                  excludeBy: [{ field: 'id', equals: 'test', match: '^test' }]
                }
              }
            },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery',
          level: 'error',
          message: 'Invalid config provided',
          extra: expect.objectContaining({
            category: 'config',
            errors: expect.arrayContaining(["Provider 'gateway' modelsDiscovery.models.excludeBy[0] must include exactly one of equals or match"])
          })
        })
      }))
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
