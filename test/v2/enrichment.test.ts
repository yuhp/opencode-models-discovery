import { describe, expect, it, vi } from "vitest"
import { discoverInventory } from "../../src/v2/discovery.js"
import { parseProviderDiscoveryOptions } from "../../src/v2/provider-config.js"
import { ModelInfoFormat } from "../../src/types/plugin-config.js"

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

    const models = inventory.get("local")!
    expect(models.has("chat-gpt")).toBe(true)
    expect(models.has("text-embed")).toBe(false)
    expect(models.get("chat-gpt")?.limit.context).toBe(128_000)
  })
})
