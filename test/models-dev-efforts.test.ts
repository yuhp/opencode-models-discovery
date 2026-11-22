import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadModelsDevEfforts, modelsDevEffortsTestUtils } from '../src/utils/models-dev-efforts.js'

const flat = 'https://models.dev/models.json'
const providers = 'https://models.dev/api.json'
const mirror = 'https://mirror.example/catalog'
const named = (...values: unknown[]) => ({ reasoning_options: [{ type: 'effort', values }] })

function serve(catalogs: Record<string, unknown>) {
  const fetcher = vi.fn(async (url: string) => Object.hasOwn(catalogs, url)
    ? Response.json(catalogs[url])
    : new Response(null, { status: 503 }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}

afterEach(() => {
  vi.unstubAllGlobals()
  modelsDevEffortsTestUtils.resetCache()
})

describe('loadModelsDevEfforts', () => {
  it('looks up public provider routing keys and resolves a unique flat model to its canonical route', async () => {
    serve({
      [flat]: { 'openai/chat-pro': { id: 'openai/chat-pro', reasoning: true } },
      [providers]: {
        openai: { models: { 'chat-pro': { id: 'chat-pro', ...named('default', 'low', 'max', 'max') } } },
        gateway: { models: {
          'openai/chat-pro': { id: 'openai/chat-pro', ...named('custom-level') },
          'chat-pro': named('high'),
          'new-model': named('medium'),
        } },
      },
    })
    const lookup = await loadModelsDevEfforts()
    expect(lookup('openai/chat-pro')).toEqual(['low', 'max'])
    expect(lookup('chat-pro')).toEqual(['low', 'max'])
    expect(lookup('gateway/openai/chat-pro')).toEqual(['custom-level'])
    expect(lookup('new-model')).toEqual(['medium'])
    for (const id of ['unknown/chat-pro', 'chat-pro-2099', 'chat-pro:free', 'OPENAI/chat-pro']) {
      expect(lookup(id)).toBeUndefined()
    }
  })

  it('preserves explicit flat declarations and counts rows without efforts when checking short-name ambiguity', async () => {
    serve({
      [flat]: {
        'a/chat': named('high'), 'b/chat': {}, 'a/empty': named(), 'a/auto': named('default'),
        'a/budget': { reasoning_options: [{ type: 'budget', min: 1, max: 2000 }] },
      },
      [providers]: { a: { models: {
        chat: named('max'), empty: named('max'), auto: named('max'), budget: named('low'), shared: named('low'),
      } }, b: { models: { shared: {} } } },
    })
    const lookup = await loadModelsDevEfforts()
    expect(lookup('chat')).toBeUndefined()
    expect(lookup('a/chat')).toEqual(['high'])
    expect(lookup('empty')).toBeUndefined()
    expect(lookup('auto')).toBeUndefined()
    expect(lookup('budget')).toEqual(['low'])
    expect(lookup('shared')).toBeUndefined()
  })

  it('uses only the requested mirror and follows explicit row IDs in flat and nested layouts', async () => {
    const secondMirror = mirror + '-2'
    const fetcher = serve({
      [mirror]: {
        'flat-alias': { id: 'vendor/flat', ...named('high') },
        plain: named('medium'),
        vendor: { models: {
          alias: { id: 'canonical', ...named('max') }, plain: named('low'), malformed: { reasoning_options: false },
        } },
      },
      [secondMirror]: { 'vendor/canonical': named('low') },
    })
    const lookup = await loadModelsDevEfforts(mirror)
    expect(lookup('vendor/flat')).toEqual(['high'])
    expect(lookup('flat-alias')).toBeUndefined()
    expect(lookup('vendor/canonical')).toEqual(['max'])
    expect(lookup('canonical')).toEqual(['max'])
    expect(lookup('vendor/alias')).toBeUndefined()
    expect(lookup('vendor/plain')).toEqual(['low'])
    expect(lookup('plain')).toEqual(['medium'])
    expect(lookup('vendor/malformed')).toBeUndefined()
    expect((await loadModelsDevEfforts(secondMirror))('canonical')).toEqual(['low'])
    expect(new Set(fetcher.mock.calls.map(([url]) => url))).toEqual(new Set([mirror, secondMirror]))
  })

  it('uses agreeing mirror aliases and declines conflicting aliases in either order', async () => {
    serve({ [mirror]: {
      a: { id: 'one', ...named('high', 'max') }, b: { id: 'one', ...named('max', 'high') },
      c: { id: 'two', ...named('high') }, d: { id: 'two', ...named('max') }, e: { id: 'two', ...named('high') },
      f: { id: 'three' }, g: { id: 'three', ...named('max') },
    } })
    const lookup = await loadModelsDevEfforts(mirror)
    expect(lookup('one')).toEqual(['high', 'max'])
    expect(lookup('two')).toBeUndefined()
    expect(lookup('three')).toBeUndefined()
  })

  it('can use exact supplemental routes during a flat outage and retries the missing source', async () => {
    const catalogs: Record<string, unknown> = { [providers]: { a: { models: { chat: named('high') } } } }
    serve(catalogs)
    const partial = await loadModelsDevEfforts()
    expect(partial('a/chat')).toEqual(['high'])
    expect(partial('chat')).toBeUndefined()

    catalogs[flat] = { 'a/chat': {} }
    expect((await loadModelsDevEfforts())('chat')).toEqual(['high'])
  })
})
