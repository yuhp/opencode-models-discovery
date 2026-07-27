import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { discoverModelsFromProvider } from '../src/utils/openai-compatible-api'

describe('OpenAI-compatible API discovery', () => {
  async function withServer(handler: Parameters<typeof createServer>[0], test: (baseURL: string) => Promise<void>): Promise<void> {
    let server: Server | undefined
    try {
      server = createServer(handler)
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))

      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Unable to determine test server address')
      }

      await test(`http://127.0.0.1:${address.port}`)
    } finally {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close(error => error ? reject(error) : resolve())
        })
      }
    }
  }

  it('returns discovered models from the low-level http client', async () => {
    await withServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(req.url === '/v1/models'
        ? { data: [{ id: 'local-model', object: 'model', created: 0, owned_by: 'local' }] }
        : { models: [] }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result.ok).toBe(true)
      expect(result.models.map(model => model.id)).toEqual(['local-model'])
    })
  })

  it('uses provider client metadata for matching models', async () => {
    await withServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(req.url === '/v1/models'
        ? {
            data: [{
              id: 'kiro/gpt-5.6-terra',
              object: 'model',
              created: 0,
              owned_by: 'local',
              context_window: 272000,
            }],
          }
        : {
            models: [
              {
                slug: 'gpt-5.6-terra',
                context_window: 372000,
                default_reasoning_level: 'low',
              },
              {
                slug: 'kiro/gpt-5.6-terra',
                context_length: 272000,
                default_reasoning_level: 'medium',
                supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }],
                input_modalities: ['text', 'image'],
              }
            ],
          }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result.models[0]).toEqual(expect.objectContaining({
        context_window: 272000,
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }],
        input_modalities: ['text', 'image'],
      }))
    })
  })

  it('treats an empty model list as a successful response', async () => {
    await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result).toEqual({ ok: true, models: [] })
    })
  })

  it('returns ok false for non-2xx responses', async () => {
    await withServer((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'server error' }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result).toEqual({ ok: false, models: [] })
    })
  })

  it('returns ok false for invalid JSON responses', async () => {
    await withServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{ invalid json')
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result).toEqual({ ok: false, models: [] })
    })
  })

  it('returns ok false when the request times out', async () => {
    await withServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [] }))
      }, 3500)
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result).toEqual({ ok: false, models: [] })
    })
  })

  it('returns ok false for transport errors', async () => {
    const result = await discoverModelsFromProvider('http://127.0.0.1:1')

    expect(result).toEqual({ ok: false, models: [] })
  })

  it('passes authorization headers and supports custom endpoints', async () => {
    await withServer((req, res) => {
      expect(req.url).toBe('/custom/models')
      expect(req.headers.authorization).toBe('Bearer test-key')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { id: 'custom-model', object: 'model', created: 0, owned_by: 'local' },
        ],
      }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL, 'test-key', '/custom/models')

      expect(result.ok).toBe(true)
      expect(result.models.map(model => model.id)).toEqual(['custom-model'])
    })
  })
})
