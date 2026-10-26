import { describe, expect, it, vi } from 'vitest'
import { resolveModelInfoEnricher, buildModelInfoURL } from '../../src/core/enricher-resolver'
import { ModelInfoFormat } from '../../src/types/plugin-config'

describe('shared enricher resolver', () => {
  it('builds absolute and relative model-info URLs correctly', () => {
    expect(buildModelInfoURL('http://127.0.0.1:8000/v1', '/v1/model/info'))
      .toBe('http://127.0.0.1:8000/v1/model/info')
    expect(buildModelInfoURL('http://127.0.0.1:8000/v1', 'info'))
      .toBe('http://127.0.0.1:8000/v1/info')
    expect(buildModelInfoURL('http://127.0.0.1:8000/v1', 'https://example.com/api/models'))
      .toBe('https://example.com/api/models')
  })

  it('resolves inline format enrichers without any network requests', async () => {
    const fetcher = vi.fn()
    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:8000', fetcher },
      { format: ModelInfoFormat.Bifrost },
    )
    expect(enricher).toBeDefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('resolves OpenRouter inline metadata without a network request', async () => {
    const fetcher = vi.fn()
    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'https://openrouter.ai/api/v1', fetcher },
      { format: ModelInfoFormat.OpenRouter },
    )

    expect(enricher).toBeDefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('resolves Ollama as a deferred enricher without fetching at resolution time', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        parameters: 'num_ctx 8192',
        capabilities: ['completion', 'tools'],
      }),
    })
    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher },
      { format: ModelInfoFormat.Ollama },
    )

    expect(enricher).toBeDefined()
    expect(fetcher).not.toHaveBeenCalled()

    await enricher!.prepare!(['gemma3'])

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/api/show', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ model: 'gemma3' }),
    }))
    expect(enricher!.enrich({ id: 'gemma3' }, { filterNonChat: true })).toMatchObject({
      limit: { context: 8_192 },
      toolCall: true,
    })
  })

  it('resolves remote LiteLLM format with authentication and timeout', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          model_name: 'chat-model',
          model_info: {
            max_tokens: 4096,
            max_input_tokens: 32768,
            mode: 'chat',
          },
        }],
      }),
    })

    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:4000', apiKey: 'example-api-key', fetcher },
      { format: ModelInfoFormat.LiteLLM },
    )

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:4000/v1/model/info', expect.objectContaining({
      method: 'GET',
    }))
    expect(enricher).toBeDefined()
    const result = enricher?.enrich({ id: 'chat-model' } as any, { filterNonChat: true })
    expect(result?.limit).toEqual({ context: 32768, output: 4096, input: 32768 })
  })

  it('gracefully handles remote fetch failures', async () => {
    const warn = vi.fn()
    const fetcher = vi.fn().mockRejectedValue(new Error('network error'))

    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:4000', fetcher, logger: { warn } },
      { format: ModelInfoFormat.LiteLLM },
    )

    expect(enricher).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Provider model info discovery failed', expect.objectContaining({
      format: ModelInfoFormat.LiteLLM,
    }))
  })

  it('returns undefined and warns on unsupported format', async () => {
    const warn = vi.fn()
    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:4000', logger: { warn } },
      { format: 'unknown-format' as any },
    )
    expect(enricher).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Unsupported provider model info format', expect.objectContaining({
      format: 'unknown-format',
    }))
  })
})
