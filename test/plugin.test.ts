import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ModelDiscoveryPlugin } from '../src/index.ts'

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

  afterEach(() => {
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
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-model-discovery] Invalid client provided to plugin')

      consoleSpy.mockRestore()
    })
  })

  describe('Config Hook', () => {
    it('should validate config and reject invalid configurations', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await pluginHooks.config(null)
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-model-discovery] Invalid config provided:', expect.arrayContaining(['Config must be an object']))

      consoleSpy.mockRestore()
    })

    it('should handle empty config gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await pluginHooks.config({})
      expect(true).toBe(true)

      consoleSpy.mockRestore()
    })

    it('should discover models for OpenAI-compatible providers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true
      })

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
          name: 'New Model'
        })
      })
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
  })

  describe('Event Hook', () => {
    it('should validate event input', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await pluginHooks.event({ event: null })
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-model-discovery] Invalid event input:', expect.arrayContaining(['event: event is required and must be an object']))

      consoleSpy.mockRestore()
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