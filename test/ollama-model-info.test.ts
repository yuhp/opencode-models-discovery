import { describe, expect, it, vi } from 'vitest'
import { createOllamaEnricher } from '../src/utils/model-info/ollama'
import { prepareModelEnricher } from '../src/core/model-enrichment'
import showGemma from './fixtures/ollama/show-gemma.json'

const BASE_URL = 'http://127.0.0.1:11434/v1'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

async function enrichedResult(body: unknown, filterNonChat = true) {
  const fetcher = vi.fn().mockResolvedValue(jsonResponse(body))
  const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher })
  await prepareModelEnricher(enricher, ['model'])
  return enricher!.enrich({ id: 'model' }, { filterNonChat })
}

describe('Ollama model info enricher', () => {
  it('posts each discovered id to /api/show and maps context and capabilities', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(showGemma))
    const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher })

    await prepareModelEnricher(enricher, ['gemma4-e2b'])

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:11434/api/show', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ model: 'gemma4-e2b' }),
    }))

    const result = enricher!.enrich({ id: 'gemma4-e2b' }, { filterNonChat: true })
    expect(result).toEqual({
      limit: { context: 131_072, output: 32_000 },
      modalities: { input: ['text', 'image'], output: ['text'] },
      reasoning: true,
      toolCall: true,
    })
  })

  it('prefers num_ctx over architecture-derived context_length', async () => {
    const result = await enrichedResult({
      ...showGemma,
      parameters: 'num_ctx 64000',
    })

    expect(result.limit?.context).toBe(64_000)
  })

  it('falls back to the architecture context_length when num_ctx is absent', async () => {
    const result = await enrichedResult({
      ...showGemma,
      parameters: '',
    })

    expect(result.limit?.context).toBe(131_072)
  })

  it('falls back to any available *.context_length entry', async () => {
    const result = await enrichedResult({
      model_info: {
        'other.context_length': 4_096,
        'second.context_length': 8_192,
      },
    })

    expect(result.limit?.context).toBe(8_192)
  })

  it('falls back to a top-level context_length and ignores a non-positive num_ctx', async () => {
    const result = await enrichedResult({
      parameters: 'num_ctx 0',
      context_length: 32_768,
    })

    expect(result.limit?.context).toBe(32_768)
  })

  it('parses the quoted and colon-separated num_ctx variants', async () => {
    await expect(enrichedResult({ parameters: 'num_ctx: 8192' })).resolves.toMatchObject({ limit: { context: 8_192 } })
    await expect(enrichedResult({ parameters: '"num_ctx": 16384' })).resolves.toMatchObject({ limit: { context: 16_384 } })
  })

  it('maps audio and image capabilities, reasoning, and tool calling', async () => {
    const result = await enrichedResult({
      capabilities: ['completion', 'audio', 'vision', 'thinking', 'tools'],
    })

    expect(result).toEqual({
      modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
      reasoning: true,
      toolCall: true,
    })
  })

  it('supports images and function_calling aliases', async () => {
    const result = await enrichedResult({
      capabilities: ['completion', 'images', 'function_calling'],
    })

    expect(result).toEqual({
      modalities: { input: ['text', 'image'], output: ['text'] },
      toolCall: true,
    })
  })

  it('skips embedding-only models when filterNonChat is enabled', async () => {
    const body = {
      parameters: 'num_ctx 8192',
      capabilities: ['embedding'],
    }

    await expect(enrichedResult(body, true)).resolves.toEqual({ skip: true })
    await expect(enrichedResult(body, false)).resolves.toMatchObject({ limit: { context: 8_192 } })
  })

  it('does not skip a model that reports both completion and embedding', async () => {
    const result = await enrichedResult({
      capabilities: ['completion', 'embedding'],
    })

    expect(result.skip).toBeUndefined()
  })

  it('degrades per model when /api/show rejects or fails', async () => {
    const warn = vi.fn()
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const model = JSON.parse(String(init?.body)).model
      if (model === 'good') return jsonResponse(showGemma)
      if (model === 'missing') return jsonResponse({}, 404)
      throw new Error('timeout')
    })
    const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher, logger: { warn } })

    await expect(prepareModelEnricher(enricher, ['good', 'missing', 'boom'])).resolves.toBeUndefined()

    expect(enricher!.enrich({ id: 'good' }, { filterNonChat: true }).limit?.context).toBe(131_072)
    expect(enricher!.enrich({ id: 'missing' }, { filterNonChat: true })).toEqual({})
    expect(enricher!.enrich({ id: 'boom' }, { filterNonChat: true })).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('keeps an enricher that no-ops when every request fails', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'))
    const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher })

    await prepareModelEnricher(enricher, ['alpha', 'beta'])

    expect(enricher).toBeDefined()
    expect(enricher!.enrich({ id: 'alpha' }, { filterNonChat: true })).toEqual({})
  })

  it('bounds concurrency instead of issuing all requests at once', async () => {
    let active = 0
    let peak = 0
    const fetcher = vi.fn(async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return jsonResponse({ capabilities: ['completion'] })
    })
    const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher })

    await enricher!.prepare!(Array.from({ length: 10 }, (_, index) => `model-${index}`))

    expect(fetcher).toHaveBeenCalledTimes(10)
    expect(peak).toBeLessThanOrEqual(4)
  })

  it('honors an absolute modelInfoEndpoint override', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(showGemma))
    const enricher = createOllamaEnricher({
      baseURL: BASE_URL,
      endpoint: 'http://proxy.example/api/show',
      fetcher,
    })

    await prepareModelEnricher(enricher, ['gemma4-e2b'])

    expect(fetcher).toHaveBeenCalledWith('http://proxy.example/api/show', expect.anything())
  })

  it('does not refetch ids that were already prepared', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(showGemma))
    const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher })

    await enricher!.prepare!(['gemma4-e2b', 'gemma4-e2b'])
    await enricher!.prepare!(['gemma4-e2b'])

    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('does not enrich unknown models', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(showGemma))
    const enricher = createOllamaEnricher({ baseURL: BASE_URL, fetcher })

    await prepareModelEnricher(enricher, ['gemma4-e2b'])

    expect(enricher!.enrich({ id: 'other' }, { filterNonChat: true })).toEqual({})
  })
})
