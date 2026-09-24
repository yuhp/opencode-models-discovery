import type { ModelInfoEnricher } from './types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function getModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const supportedModalities = new Set(['text', 'audio', 'image', 'video', 'pdf'])
  const modalities = [...new Set(value
    .filter((modality): modality is string => typeof modality === 'string')
    .map((modality) => modality.trim().toLowerCase())
    .map((modality) => modality === 'speech' ? 'audio' : modality)
    .filter((modality) => supportedModalities.has(modality)))]
  return modalities.length > 0 ? modalities : undefined
}

const SUPPORTED_REASONING_TIERS: Record<string, true> = {
  none: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
}

// Bifrost reports reasoning metadata per model as
// `reasoning: { supported_efforts: [...], default_effort: "..." }`
// (core/schemas/models.go, ModelReasoning struct). Map it to OpenCode variants
// the same way the LiteLLM and OmniRoute enrichers do.
function getReasoningVariants(rawModel: Record<string, unknown> | undefined): Record<string, { reasoningEffort: string; default?: boolean }> | undefined {
  const reasoning = rawModel?.reasoning
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) return undefined

  const block = reasoning as Record<string, unknown>
  if (!Array.isArray(block.supported_efforts) || block.supported_efforts.length === 0) return undefined

  const variants: Record<string, { reasoningEffort: string; default?: boolean }> = {}
  for (const tier of block.supported_efforts) {
    if (typeof tier !== 'string') continue
    const normalized = tier.trim().toLowerCase()
    if (!SUPPORTED_REASONING_TIERS[normalized] || variants[normalized]) continue
    variants[normalized] = { reasoningEffort: normalized }
  }

  const defaultEffort = typeof block.default_effort === 'string'
    ? block.default_effort.trim().toLowerCase()
    : undefined
  if (defaultEffort && variants[defaultEffort]) {
    variants[defaultEffort].default = true
  }

  return Object.keys(variants).length > 0 ? variants : undefined
}

export function createBifrostModelInfoEnricher(_data: unknown): ModelInfoEnricher {
  return {
    shouldSkipModel(): boolean {
      return false
    },
    getModelName(_modelId: string, rawModel?: Record<string, unknown>): string | undefined {
      const name = rawModel?.normalized_name
      return typeof name === 'string' && name.length > 0 ? name : undefined
    },
    applyModelInfo(modelConfig: any, _modelId: string, rawModel?: Record<string, unknown>): void {
      const context = rawModel?.context_length
      const input = rawModel?.max_input_tokens
      const output = rawModel?.max_output_tokens
      // Bifrost often declares context_length only (max_input_tokens and
      // max_output_tokens are both omitempty in its schema). Map the limit rather
      // than dropping it; OpenCode requires limit.output to exist (#73), so emit
      // 0 as the fallback when Bifrost does not declare max_output_tokens.
      if (hasUsableNumber(context)) {
        modelConfig.limit = {
          context,
          ...(hasUsableNumber(input) ? { input } : {}),
          output: hasUsableNumber(output) ? output : 0,
        }
      }

      const architecture = rawModel?.architecture
      if (architecture && typeof architecture === 'object' && !Array.isArray(architecture)) {
        const inputModalities = getModalities((architecture as Record<string, unknown>).input_modalities)
        const outputModalities = getModalities((architecture as Record<string, unknown>).output_modalities)
        if (inputModalities || outputModalities) {
          modelConfig.modalities = {
            ...(inputModalities ? { input: inputModalities } : {}),
            ...(outputModalities ? { output: outputModalities } : {}),
          }
        }
      }

      const pricing = rawModel?.pricing
      if (pricing && typeof pricing === 'object' && !Array.isArray(pricing)) {
        const inputCost = parseNonNegativeNumber((pricing as Record<string, unknown>).prompt)
        const outputCost = parseNonNegativeNumber((pricing as Record<string, unknown>).completion)
        if (inputCost !== undefined && outputCost !== undefined) {
          modelConfig.cost = {
            input: inputCost * 1_000_000,
            output: outputCost * 1_000_000,
          }
        }
      }

      const variants = getReasoningVariants(rawModel)
      if (variants) {
        modelConfig.reasoning = true
        modelConfig.variants = variants
      }
    },
  }
}
