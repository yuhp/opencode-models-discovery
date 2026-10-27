import { beforeEach, describe, expect, it, vi } from "vitest"

const prepareModelEnricher = vi.hoisted(() => vi.fn(async () => {}))

vi.mock("../../src/core/model-enrichment.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/model-enrichment.js")>()
  return { ...actual, prepareModelEnricher }
})

import { discoverInventory } from "../../src/v2/discovery.js"
import { parseProviderDiscoveryOptions } from "../../src/v2/provider-config.js"
import { ModelInfoFormat } from "../../src/types/plugin-config.js"

const provider = {
  id: "local",
  package: "@opencode/ai/providers/openai-compatible",
  settings: { baseURL: "http://127.0.0.1:1234/v1" },
}

describe("V2 deferred enricher preparation", () => {
  beforeEach(() => {
    prepareModelEnricher.mockClear()
  })

  it("prepares a resolved enricher with the discovered model ids", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "alpha" }, { id: "beta" }] }),
    })
    const options = new Map([
      ["local", parseProviderDiscoveryOptions({
        enabled: true,
        modelInfoFormat: ModelInfoFormat.Bifrost,
      })!],
    ])

    await discoverInventory([provider], options, fetcher as unknown as typeof fetch)

    expect(prepareModelEnricher).toHaveBeenCalledOnce()
    expect(prepareModelEnricher).toHaveBeenCalledWith(
      expect.objectContaining({ enrich: expect.any(Function) }),
      ["alpha", "beta"],
    )
  })

  it("does not prepare again on a fresh cache hit", async () => {
    const cache = new Map<string, unknown>()
    const storage = {
      get: vi.fn(async (key: string) => cache.get(key)),
      set: vi.fn(async (key: string, value: unknown) => { cache.set(key, value) }),
    }
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "alpha" }] }),
    })
    const options = new Map([
      ["local", parseProviderDiscoveryOptions({
        enabled: true,
        modelInfoFormat: ModelInfoFormat.Bifrost,
        cache: { enabled: true },
      })!],
    ])

    await discoverInventory([provider], options, fetcher as unknown as typeof fetch, storage)
    await discoverInventory([provider], options, fetcher as unknown as typeof fetch, storage)

    expect(prepareModelEnricher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
