import { describe, expect, it } from "vitest"
import { discoverModelDrafts } from "../../src/core/discovery-pipeline.js"
import { mapToDiscoveredV2Model } from "../../src/core/model-mapper.js"
import { parseProviderDiscoveryOptions } from "../../src/v2/provider-config.js"
import { createModelEnricher } from "../../src/utils/model-info/index.js"
import { ModelInfoFormat } from "../../src/types/plugin-config.js"

const filter = { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] }

function discover(raw: Record<string, unknown>, smartModelName = true, enricher?: ReturnType<typeof createModelEnricher>) {
  return discoverModelDrafts([raw], {
    filter,
    smartModelName,
    enricher,
    enrichmentContext: { filterNonChat: true },
  })[0]!
}

describe("V2 model-mapper", () => {
  it("maps basic model with default smartModelName formatting", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true, smartModelName: true })!
    const mapped = mapToDiscoveredV2Model(discover({ id: "deepseek-ai/deepseek-coder-33b-instruct" }), options)

    expect(mapped.id).toBe("deepseek-ai/deepseek-coder-33b-instruct")
    expect(mapped.modelID).toBe("deepseek-ai/deepseek-coder-33b-instruct")
    expect(mapped.name).toBe("Deepseek Coder 33B Instruct")
    expect(mapped.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
    expect(mapped.limit).toEqual({ context: 200_000, output: 32_000 })
  })

  it("leaves raw ID as name when smartModelName is false", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true, smartModelName: false })!
    const mapped = mapToDiscoveredV2Model(discover({ id: "gpt-4o-mini" }, false), options)
    expect(mapped.name).toBe("gpt-4o-mini")
  })

  it("enriches capabilities, limits, and reasoning from bifrost inline metadata", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true, smartModelName: true, modelInfoFormat: ModelInfoFormat.Bifrost })!
    const enricher = createModelEnricher(ModelInfoFormat.Bifrost, null)
    const mapped = mapToDiscoveredV2Model(discover({
      id: "bifrost-model",
      context_length: 128_000,
      max_output_tokens: 16_384,
      supports_function_calling: true,
      architecture: { input_modalities: ["text", "image"] },
      supports_reasoning: true,
    }, true, enricher), options)

    expect(mapped.limit.context).toBe(128_000)
    expect(mapped.limit.output).toBe(16_384)
    expect(mapped.capabilities.tools).toBe(true)
    expect(mapped.capabilities.input).toContain("image")
    expect((mapped as any).reasoning).toBe(true)
  })

  it("enriches limits from vllm max_model_len", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true, modelInfoFormat: ModelInfoFormat.VLLM })!
    const enricher = createModelEnricher(ModelInfoFormat.VLLM, null)
    const mapped = mapToDiscoveredV2Model(discover({ id: "qwen-2.5-72b", max_model_len: 32_768 }, true, enricher), options)
    expect(mapped.limit.context).toBe(32_768)
    expect(mapped.limit.output).toBe(32_768)
  })

  it("enriches limits and modalities from litellm model info endpoint", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true, smartModelName: true, modelInfoFormat: ModelInfoFormat.LiteLLM })!
    const litellmData = { data: [{ model_name: "custom-litellm", model_info: {
      max_tokens: 4_096,
      max_input_tokens: 100_000,
      supports_function_calling: true,
      supports_vision: true,
      mode: "chat",
      input_cost_per_token: 0.00000075,
      output_cost_per_token: 0.00000375,
      cache_read_input_token_cost: 0.000000075,
    } }] }
    const enricher = createModelEnricher(ModelInfoFormat.LiteLLM, litellmData, { filterNonChat: true })
    const mapped = mapToDiscoveredV2Model(discover({ id: "custom-litellm" }, true, enricher), options)

    expect(mapped.limit.context).toBe(100_000)
    expect(mapped.limit.output).toBe(4_096)
    expect(mapped.capabilities.input).toContain("image")
    expect(mapped.capabilities.tools).toBe(true)
    expect(mapped.cost).toEqual([{ input: 0.75, output: 3.75, cache: { read: 0.075, write: 0 } }])
  })

  it("filters non-chat models when filterNonChat is active", () => {
    const litellmData = { data: [
      { model_name: "chat-model", model_info: { mode: "chat" } },
      { model_name: "embed-model", model_info: { mode: "embedding" } },
    ] }
    const enricher = createModelEnricher(ModelInfoFormat.LiteLLM, litellmData, { filterNonChat: true })
    expect(enricher?.enrich({ id: "chat-model" }, { filterNonChat: true })).toEqual({})
    expect(enricher?.enrich({ id: "embed-model" }, { filterNonChat: true })).toEqual({ skip: true })
  })

  it("converts variants and configures compatibility.reasoningField for thinking models", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true, smartModelName: true, modelInfoFormat: ModelInfoFormat.LiteLLM })!
    const litellmData = { data: [{ model_name: "deepseek-reasoner", model_info: {
      supports_reasoning: true,
      supported_openai_params: ["reasoning_effort"],
      supports_low_reasoning_effort: true,
      supports_high_reasoning_effort: true,
      mode: "chat",
    } }] }
    const enricher = createModelEnricher(ModelInfoFormat.LiteLLM, litellmData, { filterNonChat: true })
    const mapped = mapToDiscoveredV2Model(discover({ id: "deepseek-reasoner" }, true, enricher), options)

    expect(mapped.reasoning).toBe(true)
    expect(mapped.compatibility).toEqual({ reasoningField: "reasoning_content" })
    expect(mapped.variants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "low", settings: { reasoningEffort: "low" } }),
      expect.objectContaining({ id: "high", settings: { reasoningEffort: "high" } }),
    ]))
  })

  it("does not guess reasoning purely from model id naming", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true })!
    const mapped = mapToDiscoveredV2Model(discover({ id: "deepseek-r1-distill" }), options)

    expect(mapped.reasoning).toBeUndefined()
    expect(mapped.compatibility?.reasoningField).toBeUndefined()
    expect(mapped.variants).toBeUndefined()
  })

  it("injects reasoning capability and default variants when explicitly flagged by raw model", () => {
    const options = parseProviderDiscoveryOptions({ enabled: true })!
    const mapped = mapToDiscoveredV2Model(discover({ id: "deepseek-r1-distill", supports_reasoning: true }), options)

    expect(mapped.reasoning).toBe(true)
    expect(mapped.compatibility?.reasoningField).toBe("reasoning_content")
    expect(mapped.variants).toEqual([
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "medium", settings: { reasoningEffort: "medium" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ])
  })
})
