import { describe, expect, it, vi } from 'vitest'
import {
  createDiscoveryCacheEntry,
  discoveryCacheKey,
  isDiscoveryCacheFresh,
  parseDiscoveryCacheEntry,
  readDiscoveryCache,
  writeDiscoveryCache,
} from '../../src/core/discovery-cache'

const identity = {
  providerID: 'local/provider',
  baseURL: 'http://127.0.0.1:1234/v1',
  endpoint: '/v1/models',
  modelInfoFormat: 'vllm',
}

describe('shared discovery cache policy', () => {
  it('creates stable provider keys', () => {
    expect(discoveryCacheKey('opencode.models-discovery.v2', identity.providerID))
      .toBe('opencode.models-discovery.v2:provider:local%2Fprovider')
  })

  it('validates identity and TTL', () => {
    const now = Date.parse('2026-10-09T00:00:00.000Z')
    const entry = createDiscoveryCacheEntry(identity, [{ id: 'qwen' }], {}, new Date(now - 1000).toISOString())

    expect(isDiscoveryCacheFresh(entry.fetchedAt, 2, now)).toBe(true)
    expect(parseDiscoveryCacheEntry(entry, identity, 2, now)).toEqual(entry)
    expect(parseDiscoveryCacheEntry(entry, { ...identity, endpoint: '/models' }, 2, now)).toBeUndefined()
    expect(parseDiscoveryCacheEntry(entry, identity, 0, now)).toBeUndefined()
  })

  it('isolates backend failures from cache policy callers', async () => {
    const backend = {
      get: vi.fn().mockRejectedValue(new Error('read failed')),
      set: vi.fn().mockRejectedValue(new Error('write failed')),
    }
    expect(await readDiscoveryCache(backend, 'key', identity, 60)).toBeUndefined()
    expect(await writeDiscoveryCache(backend, 'key', createDiscoveryCacheEntry(identity, [], {}))).toBe(false)
  })
})
