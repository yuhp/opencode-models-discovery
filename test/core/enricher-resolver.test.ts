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
      { baseURL: 'http://127.0.0.1:4000', apiKey: 'secret-key', fetcher },
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
