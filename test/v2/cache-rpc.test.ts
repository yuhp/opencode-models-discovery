import { describe, expect, it, vi } from "vitest"
import plugin from "../../src/v2/index.js"
import { discoveryCacheKey } from "../../src/core/discovery-cache.js"
import { DiscoveryRpcDefinition, type RpcCacheClearOutput, type RpcCacheInspectOutput } from "../../src/v2/rpc.js"

describe("V2 Cache Operations RPC", () => {
  function createTestSetup(providersList: Array<Record<string, unknown>> = []) {
    const storageStore = new Map<string, unknown>()
    const rpcHandlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {}

    const defaultProviders = providersList.length > 0 ? providersList : [
      {
        id: "provider-a",
        name: "Provider A",
        package: "@opencode-ai/ai/providers/openai-compatible",
        settings: {
          baseURL: "http://127.0.0.1:1234/v1",
          modelsDiscovery: {
            enabled: true,
            cache: { enabled: true, ttlSeconds: 3600 },
          },
        },
      },
      {
        id: "provider-b",
        name: "Provider B",
        package: "@opencode-ai/ai/providers/openai-compatible",
        settings: {
          baseURL: "http://127.0.0.1:5678/v1",
          modelsDiscovery: {
            enabled: true,
            cache: { enabled: false },
          },
        },
      },
    ]

    const ctx = {
      app: { version: "2.0.14" },
      options: {},
      provider: {
        transform: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue({ data: defaultProviders }),
      },
      integration: {
        transform: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
        connection: { active: vi.fn().mockResolvedValue(undefined), resolve: vi.fn() },
      },
      event: {
        subscribe: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {},
        }),
      },
      tool: { transform: vi.fn() },
      storage: {
        get: vi.fn().mockImplementation(async (key: string) => storageStore.get(key)),
        set: vi.fn().mockImplementation(async (key: string, val: unknown) => {
          storageStore.set(key, val)
        }),
        remove: vi.fn().mockImplementation(async (key: string) => {
          storageStore.delete(key)
        }),
      },
      rpc: {
        register: vi.fn().mockImplementation(async (def, handlers) => {
          if (def === DiscoveryRpcDefinition) {
            Object.assign(rpcHandlers, handlers)
          }
        }),
      },
    }

    return { ctx, storageStore, rpcHandlers }
  }

  describe("cacheInspect", () => {
    it("reports fresh cache with model count and TTL", async () => {
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ id: "m1" }, { id: "m2" }] }),
      } as Response)

      const { ctx, storageStore, rpcHandlers } = createTestSetup()

      const cacheKeyA = discoveryCacheKey("opencode.models-discovery.v2", "provider-a")
      storageStore.set(cacheKeyA, {
        version: 1,
        fetchedAt: new Date().toISOString(),
        identity: { providerID: "provider-a" },
        rawModels: [{ id: "m1" }, { id: "m2" }],
        enrichments: {},
      })

      try {
        await plugin.setup(ctx as never)
        const inspect = rpcHandlers.cacheInspect as (input?: unknown) => Promise<RpcCacheInspectOutput>
        const result = await inspect()

        expect(result.entries).toHaveLength(2)
        const entryA = result.entries.find((e) => e.providerID === "provider-a")
        expect(entryA).toMatchObject({
          providerID: "provider-a",
          status: "fresh",
          modelCount: 2,
          ttlSeconds: 3600,
        })

        const entryB = result.entries.find((e) => e.providerID === "provider-b")
        expect(entryB).toMatchObject({
          providerID: "provider-b",
          status: "empty",
        })
      } finally {
        fetcher.mockRestore()
      }
    })

    it("reports expired cache when fetchedAt is beyond TTL", async () => {
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const { ctx, storageStore, rpcHandlers } = createTestSetup()

      try {
        await plugin.setup(ctx as never)

        const cacheKeyA = discoveryCacheKey("opencode.models-discovery.v2", "provider-a")
        const expiredDate = new Date(Date.now() - 7200 * 1000).toISOString()
        storageStore.set(cacheKeyA, {
          version: 1,
          fetchedAt: expiredDate,
          identity: { providerID: "provider-a" },
          rawModels: [{ id: "old-model" }],
          enrichments: {},
        })

        const inspect = rpcHandlers.cacheInspect as (input?: unknown) => Promise<RpcCacheInspectOutput>
        const result = await inspect({ providerID: "provider-a" })

        expect(result.entries).toHaveLength(1)
        expect(result.entries[0]).toMatchObject({
          providerID: "provider-a",
          status: "expired",
          modelCount: 1,
        })
      } finally {
        fetcher.mockRestore()
      }
    })

    it("reports corrupt cache when entry structure is invalid", async () => {
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const { ctx, storageStore, rpcHandlers } = createTestSetup()

      try {
        await plugin.setup(ctx as never)

        const cacheKeyA = discoveryCacheKey("opencode.models-discovery.v2", "provider-a")
        storageStore.set(cacheKeyA, { invalid: "corrupt_data" })

        const inspect = rpcHandlers.cacheInspect as (input?: unknown) => Promise<RpcCacheInspectOutput>
        const result = await inspect({ providerID: "provider-a" })

        expect(result.entries).toHaveLength(1)
        expect(result.entries[0]).toMatchObject({
          providerID: "provider-a",
          status: "corrupt",
        })
      } finally {
        fetcher.mockRestore()
      }
    })
  })

  describe("cacheClear", () => {
    it("clears single provider cache and preserves user overrides and other providers", async () => {
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const { ctx, storageStore, rpcHandlers } = createTestSetup()
      const cacheKeyA = discoveryCacheKey("opencode.models-discovery.v2", "provider-a")
      const cacheKeyB = discoveryCacheKey("opencode.models-discovery.v2", "provider-b")
      const overrideKey = "discovery-override:provider-a:model-1"

      storageStore.set(cacheKeyA, { version: 1, rawModels: [] })
      storageStore.set(cacheKeyB, { version: 1, rawModels: [] })
      storageStore.set(overrideKey, { name: "Custom Name", enabled: true })

      try {
        await plugin.setup(ctx as never)
        const clear = rpcHandlers.cacheClear as (input?: unknown) => Promise<RpcCacheClearOutput>
        const result = await clear({ providerID: "provider-a" })

        expect(result.cleared).toBe(1)
        expect(storageStore.has(cacheKeyA)).toBe(false)
        expect(storageStore.has(cacheKeyB)).toBe(true)
        expect(storageStore.has(overrideKey)).toBe(true)
      } finally {
        fetcher.mockRestore()
      }
    })

    it("clears all provider caches while preserving user overrides", async () => {
      const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response)

      const { ctx, storageStore, rpcHandlers } = createTestSetup()
      const cacheKeyA = discoveryCacheKey("opencode.models-discovery.v2", "provider-a")
      const cacheKeyB = discoveryCacheKey("opencode.models-discovery.v2", "provider-b")
      const overrideKey = "discovery-override:provider-a:model-1"

      storageStore.set(cacheKeyA, { version: 1, rawModels: [] })
      storageStore.set(cacheKeyB, { version: 1, rawModels: [] })
      storageStore.set(overrideKey, { name: "Custom Name", enabled: true })

      try {
        await plugin.setup(ctx as never)
        const clear = rpcHandlers.cacheClear as (input?: unknown) => Promise<RpcCacheClearOutput>
        const result = await clear()

        expect(result.cleared).toBe(2)
        expect(storageStore.has(cacheKeyA)).toBe(false)
        expect(storageStore.has(cacheKeyB)).toBe(false)
        expect(storageStore.has(overrideKey)).toBe(true)
      } finally {
        fetcher.mockRestore()
      }
    })
  })
})
