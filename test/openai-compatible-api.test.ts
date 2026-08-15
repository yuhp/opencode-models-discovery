import { describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { canDiscoverModels, discoverModelsFromProvider } from '../src/utils/openai-compatible-api'

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
      expect(req.url).toBe('/v1/models')
      expect(req.headers['user-agent']).toBe('opencode-models-discovery')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        data: [
          { id: 'local-model', object: 'model', created: 0, owned_by: 'local' },
        ],
      }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL)

      expect(result.ok).toBe(true)
      expect(result.models.map(model => model.id)).toEqual(['local-model'])
    })
  })

  it('uses the OpenAI-compatible models endpoint for v1beta base URLs', async () => {
    await withServer((req, res) => {
      expect(req.url).toBe('/v1/models')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(`${baseURL}/v1beta`)

      expect(result).toEqual({ ok: true, models: [] })
    })
  })

  it('recognizes v1beta providers as OpenAI-compatible discovery targets', () => {
    expect(canDiscoverModels({
      npm: '@ai-sdk/google',
      options: { baseURL: 'https://example.com/v1beta' },
    })).toBe(true)
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

  it('uses a caller-provided request timeout', async () => {
    await withServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: [] }))
      }, 50)
    }, async (baseURL) => {
      const result = await discoverModelsFromProvider(baseURL, undefined, '/v1/models', 10)

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
