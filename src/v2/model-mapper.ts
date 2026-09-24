import { formatModelName } from "../utils/format-model-name.js"
import { type DiscoveredV2Model } from "./catalog.js"
import { type ProviderDiscoveryOptions } from "./provider-config.js"
import { type ModelInfoEnricher } from "../utils/model-info/types.js"

export interface RawOpenAIModel {
  readonly id: string
  readonly [key: string]: unknown
}

function resolveModelName(
  model: RawOpenAIModel,
  options: ProviderDiscoveryOptions,
  enricher?: ModelInfoEnricher,
): string {
  if (!options.smartModelName) {
    return model.id
  }
  return enricher?.getModelName?.(model.id, model) ?? formatModelName(model as any)
}

export function mapToDiscoveredV2Model(
  model: RawOpenAIModel,
  options: ProviderDiscoveryOptions,
  enricher?: ModelInfoEnricher,
): DiscoveredV2Model {
  // Temporary V1-shaped config object to let existing format enrichers mutate
  const intermediateV1: Record<string, any> = {
    id: model.id,
    name: resolveModelName(model, options, enricher),
    capabilities: {
      tools: true,
      input: ["text"],
      output: ["text"],
    },
    limit: {
      context: 200_000,
      output: 32_000,
    },
  }

  // Apply enricher (models.dev, bifrost, litellm, lmstudio, vllm, llamaswap, omniroute)
  enricher?.applyModelInfo(intermediateV1, model.id, model)

  // Map to V2 Model.Info shape
  const name = typeof intermediateV1.name === "string" && intermediateV1.name.length > 0
    ? intermediateV1.name
    : model.id

  // Capabilities mapping
  const capabilities: Record<string, unknown> = {
    tools: intermediateV1.tool_call !== false && intermediateV1.capabilities?.tools !== false,
  }

  // Input modalities
  const inputModalities = intermediateV1.modalities?.input ?? intermediateV1.capabilities?.input ?? ["text"]
  if (Array.isArray(inputModalities) && inputModalities.length > 0) {
    capabilities.input = inputModalities
  }

  // Output modalities
  const outputModalities = intermediateV1.modalities?.output ?? intermediateV1.capabilities?.output ?? ["text"]
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    capabilities.output = outputModalities
  }

  // Limits mapping
  const limit: Record<string, unknown> = {}
  const rawLimit = intermediateV1.limit ?? {}
  if (typeof rawLimit.context === "number" && rawLimit.context > 0) {
    limit.context = rawLimit.context
  } else {
    limit.context = 200_000
  }
  if (typeof rawLimit.output === "number" && rawLimit.output > 0) {
    limit.output = rawLimit.output
  } else {
    limit.output = 32_000
  }
  if (typeof rawLimit.input === "number" && rawLimit.input > 0) {
    limit.input = rawLimit.input
  }

  const result: Record<string, any> = {
    id: model.id,
    modelID: model.id,
    name,
    capabilities,
    limit,
  }

  // Reasoning capability: from enricher or rawModel
  const isReasoning = typeof intermediateV1.reasoning === "boolean"
    ? intermediateV1.reasoning
    : (
        model.supports_reasoning === true ||
        (model.capabilities && typeof model.capabilities === "object" && (model.capabilities as Record<string, unknown>).reasoning === true) ||
        /(?:^|[-_/])(r1|reasoner|thinking|reasoning)(?:[-_/]|$)/i.test(model.id)
      )

  if (isReasoning) {
    result.reasoning = true
    result.compatibility = {
      ...result.compatibility,
      reasoningField: "reasoning_content",
    }
  }

  // Variants mapping: convert V1 Record<string, Variant> to V2 Array<{ id, settings }>
  if (Array.isArray(intermediateV1.variants)) {
    result.variants = intermediateV1.variants
  } else if (intermediateV1.variants && typeof intermediateV1.variants === "object") {
    result.variants = Object.entries(intermediateV1.variants).map(([id, settings]) => ({
      id,
      settings: settings as Record<string, unknown>,
    }))
  } else if (isReasoning && !result.variants) {
    // If reasoning is supported but no variants provided, define default reasoning effort variants
    result.variants = [
      { id: "low", settings: { reasoningEffort: "low" } },
      { id: "medium", settings: { reasoningEffort: "medium" } },
      { id: "high", settings: { reasoningEffort: "high" } },
    ]
  }

  // Attachment capability
  if (typeof intermediateV1.attachment === "boolean") {
    result.attachment = intermediateV1.attachment
  }

  // Cost mapping (V1 cost.input/output -> V2 cost object)
  if (intermediateV1.cost && typeof intermediateV1.cost === "object") {
    result.cost = intermediateV1.cost
  }

  return result as DiscoveredV2Model
}
