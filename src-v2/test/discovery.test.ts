import { describe, expect, it, vi } from "vitest"
import { discoverInventory } from "../discovery.js"
import { parseProviderDiscoveryOptions } from "../provider-config.js"

const options = new Map([["local", parseProviderDiscoveryOptions({
  smartModelName: true,
  models: {
    includeBy: [{ field: "id", match: "^qwen" }],
    excludeRegex: ["vision"],
  },
})!]])

describe("V2 provider discovery", () => {
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
      headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }))
    expect(inventory.get("local")).toEqual(new Map([["qwen-coder", expect.objectContaining({
      id: "qwen-coder",
      modelID: "qwen-coder",
      name: "Qwen Coder",
    })]]))
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
      headers: expect.objectContaining({ Authorization: "Bearer managed-key" }),
    }))
  })

  it("continues discovery when another provider fails", async () => {
    const providerOptions = new Map(options)
    providerOptions.set("unavailable", parseProviderDiscoveryOptions({})!)
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "qwen-available" }] }) })

    const inventory = await discoverInventory([
       { id: "unavailable", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:9000/v1", modelsDiscovery: {} } },
       { id: "local", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:1234/v1" } },
    ], providerOptions, fetcher)

    expect(inventory.has("unavailable")).toBe(false)
    expect(inventory.get("local")?.get("qwen-available")?.modelID).toBe("qwen-available")
  })
})
