import { describe, expect, it, vi } from "vitest"
import { discoverInventory } from "../../src/v2/discovery.js"
import { parseProviderDiscoveryOptions } from "../../src/v2/provider-config.js"

const options = new Map([["local", parseProviderDiscoveryOptions({
  enabled: true,
  smartModelName: true,
  models: {
    includeBy: [{ field: "id", match: "^qwen" }],
    excludeRegex: ["vision"],
  },
})!]])

describe("V2 provider discovery", () => {
  it("persists raw models in storage and reprocesses them on a fresh cache hit", async () => {
    const cache = new Map<string, unknown>()
    const storage = {
      get: vi.fn(async (key: string) => cache.get(key)),
      set: vi.fn(async (key: string, value: unknown) => { cache.set(key, value) }),
    }
    const cachedOptions = new Map([[
      "local",
      parseProviderDiscoveryOptions({ enabled: true, smartModelName: true, cache: { enabled: true }, models: { excludeRegex: ["vision"] } })!,
    ]])
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "qwen/qwen3" }, { id: "qwen-vision" }] }),
    })
    const provider = {
      id: "local",
      package: "@opencode-ai/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:1234/v1" },
    }

    const first = await discoverInventory([provider], cachedOptions, fetcher, storage)
    const second = await discoverInventory([provider], cachedOptions, fetcher, storage)

    expect(first.get("local")?.get("qwen/qwen3")?.name).toBe("Qwen3")
    expect(first.get("local")?.has("qwen-vision")).toBe(false)
    expect(second).toEqual(first)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(storage.set).toHaveBeenCalledTimes(1)

    const changedOptions = new Map([[
      "local",
      parseProviderDiscoveryOptions({ enabled: true, smartModelName: true, cache: { enabled: true } })!,
    ]])
    const changed = await discoverInventory([provider], changedOptions, fetcher, storage)
    expect(changed.get("local")?.has("qwen-vision")).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("discovers, filters, and maps OpenAI-compatible models", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "qwen-coder" },
          { id: "qwen-vision" },
          { id: "text-embedding-3-small" },
          { id: "other-model" },
        ],
      }),
    })

    const inventory = await discoverInventory([{
      id: "local",
      package: "@opencode-ai/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:1234/v1", apiKey: "test-key" },
    }], options, fetcher)

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:1234/v1/models", expect.objectContaining({
      headers: expect.any(Object),
    }))
    expect(inventory.get("local")).toEqual(new Map([["qwen-coder", expect.objectContaining({
      id: "qwen-coder",
      modelID: "qwen-coder",
      name: "Qwen Coder",
    })]]))
  })

  it("disambiguates colliding smart model names with their owners", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "github-copilot/gpt-5.6-sol" },
          { id: "openai/gpt-5.6-sol" },
          { id: "qwen/qwen3-30b" },
        ],
      }),
    })

    const inventory = await discoverInventory([{
      id: "local",
      package: "@opencode-ai/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:1234/v1" },
    }], new Map([[
      "local",
      parseProviderDiscoveryOptions({ enabled: true, smartModelName: true })!,
    ]]), fetcher)

    expect(inventory.get("local")?.get("github-copilot/gpt-5.6-sol")?.name).toBe("GPT 5.6 Sol (Github Copilot)")
    expect(inventory.get("local")?.get("openai/gpt-5.6-sol")?.name).toBe("GPT 5.6 Sol (Openai)")
    expect(inventory.get("local")?.get("qwen/qwen3-30b")?.name).toBe("Qwen3 30B")
  })

  it("prefers an ephemeral managed credential over settings.apiKey", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })

    await discoverInventory([{
      id: "local",
      package: "@opencode-ai/ai/providers/openai-compatible",
      apiKey: "managed-key",
      settings: { baseURL: "http://127.0.0.1:1234/v1", apiKey: "configured-key" },
    }], options, fetcher)

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:1234/v1/models", expect.objectContaining({
      headers: expect.any(Object),
    }))
  })

  it("discovers models from an anthropic provider package when explicitly enabled", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "claude-sonnet" }] }),
    })

    const inventory = await discoverInventory([{
      id: "anthropic",
      package: "@opencode/ai/providers/anthropic",
      settings: { baseURL: "http://127.0.0.1:1234/v1" },
    }], new Map([[
      "anthropic",
      parseProviderDiscoveryOptions({ enabled: true })!,
    ]]), fetcher)

    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:1234/v1/models", expect.objectContaining({
      headers: expect.any(Object),
    }))
    expect(inventory.get("anthropic")?.get("claude-sonnet")?.modelID).toBe("claude-sonnet")
  })

  it("continues discovery when another provider fails", async () => {
    const providerOptions = new Map(options)
    providerOptions.set("unavailable", parseProviderDiscoveryOptions({ enabled: true })!)
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "qwen-available" }] }) })

    const inventory = await discoverInventory([
       { id: "unavailable", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:9000/v1" } },
       { id: "local", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:1234/v1" } },
    ], providerOptions, fetcher)

    expect(inventory.has("unavailable")).toBe(false)
    expect(inventory.get("local")?.get("qwen-available")?.modelID).toBe("qwen-available")
  })
})
