import { describe, expect, it, vi } from "vitest"
import { discoverInventory } from "../../src/v2/discovery.js"
import { parseProviderDiscoveryOptions } from "../../src/v2/provider-config.js"
import { ModelInfoFormat } from "../../src/types/plugin-config.js"
import { modelsDevTestUtils } from "../../src/utils/models-dev-fetcher.js"

describe("V2 provider discovery with metadata enrichment", () => {
  it("enriches models using bifrost inline metadata", async () => {
    const options = new Map([
      ["local", parseProviderDiscoveryOptions({
        enabled: true,
        smartModelName: true,
        modelInfoFormat: ModelInfoFormat.Bifrost,
      })!],
    ])

    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "bifrost-chat",
          context_length: 64_000,
          max_output_tokens: 8_192,
          architecture: {
            input_modalities: ["text", "image"],
          },
          supports_reasoning: true,
        }],
      }),
    })

    const inventory = await discoverInventory([{
      id: "local",
      package: "@opencode-ai/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:1234/v1" },
    }], options, fetcher as unknown as typeof fetch)

    const model = inventory.get("local")?.get("bifrost-chat")
    expect(model).toBeDefined()
    expect(model?.limit.context).toBe(64_000)
    expect(model?.limit.output).toBe(8_192)
    expect(model?.capabilities.input).toContain("image")
    expect((model as any).reasoning).toBe(true)
  })

  it("queries external litellm endpoint and filters non-chat models", async () => {
    const options = new Map([
      ["local", parseProviderDiscoveryOptions({
        enabled: true,
        smartModelName: true,
        modelInfoFormat: ModelInfoFormat.LiteLLM,
        filterNonChat: true,
      })!],
    ])

    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/model/info")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { model_name: "chat-gpt", model_info: { max_tokens: 4096, max_input_tokens: 128000, mode: "chat" } },
              { model_name: "text-embed", model_info: { mode: "embedding" } },
            ],
          }),
        } as Response
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: "chat-gpt" },
            { id: "text-embed" },
          ],
        }),
      } as Response
    })

    const inventory = await discoverInventory([{
      id: "local",
      package: "@opencode-ai/ai/providers/openai-compatible",
      settings: { baseURL: "http://127.0.0.1:1234/v1" },
    }], options, fetcher as unknown as typeof fetch)

    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:1234/v1/model/info",
      expect.anything()
    )
    const models = inventory.get("local")!
    expect(models.has("chat-gpt")).toBe(true)
    expect(models.has("text-embed")).toBe(false)
    expect(models.get("chat-gpt")?.limit.context).toBe(128_000)
  })

  it("composes models.dev metadata with AIProxy inline data without sharing provider credentials", async () => {
    modelsDevTestUtils.resetCache()
    const catalogFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        openai: {
          models: {
            "gpt-6-luna": {
              id: "gpt-6-luna",
              name: "GPT-6 Luna",
              reasoning: true,
              tool_call: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 1_050_000, input: 922_000, output: 128_000 },
            },
          },
        },
      }),
    })
    vi.stubGlobal("fetch", catalogFetcher)

    const options = new Map([
      ["aiproxy", parseProviderDiscoveryOptions({
        enabled: true,
        smartModelName: true,
        modelInfoFormat: ModelInfoFormat.AIProxy,
      })!],
    ])
    const providerFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "gpt-6-luna",
            limits: { max_input_tokens: 922_000, max_output_tokens: 128_000 },
            pricing: { input_per_1m_usd: 0.1, output_per_1m_usd: 0.5 },
            capabilities: { reasoning: true, effort_tiers: ["low", "high", "xhigh", "max"] },
          },
          {
            id: "unlisted-provider-model",
            limits: { max_input_tokens: 16_000, max_output_tokens: 4_000 },
            pricing: { input_per_1m_usd: 0, output_per_1m_usd: 0.25 },
          },
        ],
      }),
    })

    try {
      const inventory = await discoverInventory([{
        id: "aiproxy",
        package: "aisdk:@ai-sdk/openai",
        apiKey: "provider-secret",
        settings: { baseURL: "https://aiproxy.example/api" },
      }], options, providerFetcher as unknown as typeof fetch)

      expect(catalogFetcher).toHaveBeenCalledTimes(1)
      expect(catalogFetcher.mock.calls[0]?.[1]).not.toHaveProperty("headers")
      const models = inventory.get("aiproxy")!
      expect([...models.keys()]).toEqual(["gpt-6-luna", "unlisted-provider-model"])
      expect(models.get("gpt-6-luna")).toMatchObject({
        name: "GPT-6 Luna",
        reasoning: true,
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        limit: { context: 1_050_000, input: 922_000, output: 128_000 },
        cost: [{ input: 0.1, output: 0.5 }],
        variants: [
          { id: "low", settings: { reasoningEffort: "low" } },
          { id: "high", settings: { reasoningEffort: "high" } },
          { id: "xhigh", settings: { reasoningEffort: "xhigh" } },
          { id: "max", settings: { reasoningEffort: "max" } },
        ],
      })
      expect(models.get("unlisted-provider-model")).toMatchObject({
        limit: { context: 200_000, output: 32_000 },
        cost: [{ input: 0, output: 0.25 }],
      })
    } finally {
      vi.unstubAllGlobals()
      modelsDevTestUtils.resetCache()
    }
  })

  it("keeps AIProxy inline enrichment when models.dev is unavailable", async () => {
    modelsDevTestUtils.resetCache()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("catalog unavailable")))
    const options = new Map([
      ["aiproxy", parseProviderDiscoveryOptions({ enabled: true, modelInfoFormat: ModelInfoFormat.AIProxy })!],
    ])
    const providerFetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{
          id: "gpt-6-luna",
          pricing: { input_per_1m_usd: 0.1, output_per_1m_usd: 0.5 },
          capabilities: { reasoning: true, effort_tiers: ["xhigh", "max"] },
        }],
      }),
    })

    try {
      const inventory = await discoverInventory([{
        id: "aiproxy",
        package: "aisdk:@ai-sdk/openai",
        settings: { baseURL: "https://aiproxy.example/api" },
      }], options, providerFetcher as unknown as typeof fetch)

      expect(inventory.get("aiproxy")?.get("gpt-6-luna")).toMatchObject({
        cost: [{ input: 0.1, output: 0.5 }],
        variants: [
          { id: "xhigh", settings: { reasoningEffort: "xhigh" } },
          { id: "max", settings: { reasoningEffort: "max" } },
        ],
      })
    } finally {
      vi.unstubAllGlobals()
      modelsDevTestUtils.resetCache()
    }
  })
})
