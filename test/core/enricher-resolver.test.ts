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

describe('shared enricher resolver: Ollama format', () => {
  const showBody = (contextLength: number) => ({
    details: { family: 'gemma3' },
    model_info: { 'gemma3.context_length': contextLength },
    capabilities: ['tools'],
  })

  it('resolves an Ollama enricher with per-model POST requests', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      return {
        ok: true,
        json: async () => showBody(body.model === 'gemma3' ? 131072 : 8192),
      }
    })

    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher },
      { format: ModelInfoFormat.Ollama, modelIds: ['gemma3', 'llama3'] },
    )

    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/api/show', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ model: 'gemma3' }),
    }))
    expect(enricher).toBeDefined()
    expect(enricher?.enrich({ id: 'gemma3' }, { filterNonChat: true }).limit).toEqual({ context: 131072, output: 32000 })
    expect(enricher?.enrich({ id: 'llama3' }, { filterNonChat: true }).limit).toEqual({ context: 8192, output: 8192 })
  })

  it('tolerates a per-model 404 without crashing discovery', async () => {
    const warn = vi.fn()
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      if (body.model === 'b') return { ok: false, status: 404 }
      return { ok: true, json: async () => showBody(4096) }
    })

    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher, logger: { warn } },
      { format: ModelInfoFormat.Ollama, modelIds: ['a', 'b'] },
    )

    expect(enricher).toBeDefined()
    expect(enricher?.enrich({ id: 'a' }, { filterNonChat: true }).limit).toBeDefined()
    expect(enricher?.enrich({ id: 'b' }, { filterNonChat: true })).toEqual({})
    expect(warn).toHaveBeenCalledWith('Provider model info discovery failed', expect.objectContaining({
      modelId: 'b',
      status: 404,
    }))
  })

  it('returns undefined when all per-model POSTs fail', async () => {
    const warn = vi.fn()
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher, logger: { warn } },
      { format: ModelInfoFormat.Ollama, modelIds: ['a', 'b'] },
    )

    expect(enricher).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Provider model info discovery failed', expect.objectContaining({
      modelId: 'a',
    }))
  })

  it('returns undefined without fetching when modelIds are empty or omitted', async () => {
    const warn = vi.fn()
    const fetcher = vi.fn()

    const empty = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher, logger: { warn } },
      { format: ModelInfoFormat.Ollama, modelIds: [] },
    )
    const omitted = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher, logger: { warn } },
      { format: ModelInfoFormat.Ollama },
    )

    expect(empty).toBeUndefined()
    expect(omitted).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('Ollama model info format requires model IDs', expect.objectContaining({}))
  })

  it('propagates per-model rejections as per-model no-enrichment', async () => {
    const warn = vi.fn()
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { model: string }
      if (body.model === 'bad') throw new Error('network error')
      return { ok: true, json: async () => showBody(4096) }
    })

    const mixed = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher, logger: { warn } },
      { format: ModelInfoFormat.Ollama, modelIds: ['good', 'bad'] },
    )
    expect(mixed).toBeDefined()
    expect(mixed?.enrich({ id: 'good' }, { filterNonChat: true }).limit).toBeDefined()
    expect(warn).toHaveBeenCalledWith('Provider model info discovery failed', expect.objectContaining({
      modelId: 'bad',
      error: 'network error',
    }))

    warn.mockClear()
    const failing = vi.fn().mockRejectedValue(new Error('network error'))
    const allFailed = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher: failing, logger: { warn } },
      { format: ModelInfoFormat.Ollama, modelIds: ['a'] },
    )
    expect(allFailed).toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Provider model info discovery failed', expect.objectContaining({
      error: 'network error',
    }))
  })

  it('uses the default /api/show endpoint and honors a custom modelInfoEndpoint', async () => {
    const defaultFetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => showBody(4096) })
    await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher: defaultFetcher },
      { format: ModelInfoFormat.Ollama, modelIds: ['a'] },
    )
    expect(defaultFetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/api/show', expect.anything())

    const customFetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => showBody(4096) })
    await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher: customFetcher },
      { format: ModelInfoFormat.Ollama, modelIds: ['a'], endpoint: '/api/custom' },
    )
    expect(customFetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/api/custom', expect.anything())
  })
})
