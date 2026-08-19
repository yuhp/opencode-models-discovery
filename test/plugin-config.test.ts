import { describe, it, expect } from 'vitest'
import { isSupportedModelInfoFormat } from '../src/utils/model-info'
import { validateConfig } from '../src/utils/validation'
import { DEFAULT_CACHE_TTL_SECONDS } from '../src/types/plugin-config'

describe('JSON config struct parsing', () => {
  function parse(json: string): Record<string, unknown> {
    return JSON.parse(json)
  }

  it.each([
    { json: '{"modelInfoFormat":"bifrost"}', expected: true },
    { json: '{"modelInfoFormat":"litellm"}', expected: true },
    { json: '{"modelInfoFormat":"models.dev"}', expected: true },
    { json: '{"modelInfoFormat":"vllm"}', expected: true },
    { json: '{"modelInfoFormat":"llama-swap"}', expected: true },
    { json: '{"modelInfoFormat":"omniroute"}', expected: true },
    { json: '{"modelInfoFormat":"bogus"}', expected: false },
  ])('handles modelInfoFormat=$json', ({ json, expected }) => {
    const config = parse(json)
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(expected)
  })

  it('handles absence of modelInfoFormat', () => {
    const config = parse('{"enabled":true}')
    expect(config.modelInfoFormat).toBeUndefined()
  })

  it('uses a 24-hour default cache TTL and validates cache options', () => {
    expect(DEFAULT_CACHE_TTL_SECONDS).toBe(86400)

    const validation = validateConfig({
      provider: {
        local: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'http://127.0.0.1:8000/v1',
            modelsDiscovery: {
              cache: { enabled: 'yes', ttlSeconds: -1 },
            },
          },
        },
      },
    })

    expect(validation.isValid).toBe(false)
    expect(validation.errors).toEqual(expect.arrayContaining([
      "Provider 'local' modelsDiscovery.cache.enabled must be a boolean",
      "Provider 'local' modelsDiscovery.cache.ttlSeconds must be a non-negative finite number",
    ]))
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '3000'])('rejects invalid provider timeoutMs values', (timeoutMs) => {
    const validation = validateConfig({
      provider: {
        local: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'http://127.0.0.1:8000/v1',
            modelsDiscovery: { timeoutMs },
          },
        },
      },
    })

    expect(validation.errors).toContain("Provider 'local' modelsDiscovery.timeoutMs must be a positive finite number")
  })

  it('accepts a positive finite provider timeoutMs', () => {
    const validation = validateConfig({
      provider: {
        local: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'http://127.0.0.1:8000/v1',
            modelsDiscovery: { timeoutMs: 15000 },
          },
        },
      },
    })

    expect(validation.isValid).toBe(true)
  })

  it('handles a full provider discovery config from JSON', () => {
    const json = `{
      "enabled": true,
      "endpoint": "/v1/models",
      "modelInfoEndpoint": "/v1/model/info",
      "modelInfoFormat": "litellm",
      "filterNonChat": true,
      "models": {
        "includeBy": [{ "field": "id", "match": "^chat-" }]
      }
    }`
    const config = parse(json)
    expect(config.modelInfoFormat).toBe('litellm')
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(true)
  })

  it('allows LiteLLM enrichment without an explicit modelInfoEndpoint', () => {
    const config = parse('{"modelInfoFormat":"litellm"}')
    expect(config.modelInfoEndpoint).toBeUndefined()
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(true)
  })

  it('accepts a complete modelInfoEndpoint URL for models.dev mirrors', () => {
    const config = parse('{"modelInfoFormat":"models.dev","modelInfoEndpoint":"https://mirror.example/models.json"}')
    expect(config.modelInfoEndpoint).toBe('https://mirror.example/models.json')
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(true)
  })

  it('accepts a complete modelInfoEndpoint URL for LiteLLM', () => {
    const config = parse('{"modelInfoFormat":"litellm","modelInfoEndpoint":"https://metadata.example/v1/model/info"}')
    expect(config.modelInfoEndpoint).toBe('https://metadata.example/v1/model/info')
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(true)
  })

  it('rejects discovery endpoints that are not origin-relative paths', () => {
    const validation = validateConfig({
      provider: {
        local: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: 'https://provider.example/v1',
            modelsDiscovery: { endpoint: 'https://other.example/v1/models' },
          },
        },
      },
    })

    expect(validation.errors).toContain("Provider 'local' modelsDiscovery.endpoint must be an origin-relative path starting with /")
  })
})
