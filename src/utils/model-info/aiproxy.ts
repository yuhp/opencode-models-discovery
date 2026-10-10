import type { ModelEnricher, ModelEnrichmentResult } from '../../core/model-enrichment'
import { createModelsDevEnricher } from './models-dev'

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function reasoningVariants(value: unknown): Record<string, { reasoningEffort: string }> | undefined {
  if (!Array.isArray(value)) return undefined

  const variants: Record<string, { reasoningEffort: string }> = {}
  for (const tier of value) {
    if (typeof tier !== 'string') continue
    const effort = tier.trim().toLowerCase()
    if (REASONING_EFFORTS.has(effort)) variants[effort] = { reasoningEffort: effort }
  }
  return variants
}

export function createAIProxyEnricher(data: unknown): ModelEnricher {
  const modelsDevEnricher = createModelsDevEnricher(data)

  return {
    enrich(model, context): ModelEnrichmentResult {
      const base = modelsDevEnricher.enrich(model, context)
      const result: any = {
        ...base,
        ...(base.limit ? { limit: { ...base.limit } } : {}),
        ...(base.cost && typeof base.cost === 'object' ? { cost: { ...(base.cost as Record<string, unknown>) } } : {}),
      }

      const limits = object(model.limits)
      const inputLimit = limits?.max_input_tokens
      const outputLimit = limits?.max_output_tokens
      const existingLimit = result.limit
      if (existingLimit && positiveNumber(existingLimit.context) && (positiveNumber(inputLimit) || positiveNumber(outputLimit))) {
        result.limit = {
          ...existingLimit,
          ...(positiveNumber(inputLimit) ? { input: inputLimit } : {}),
          ...(positiveNumber(outputLimit) ? { output: outputLimit } : {}),
        }
      }

      const pricing = object(model.pricing)
      if (pricing) {
        const input = pricing.input_per_1m_usd
        const output = pricing.output_per_1m_usd
        const cacheRead = pricing.cache_read_per_1m_usd
        const updates = {
          ...(nonNegativeNumber(input) ? { input } : {}),
          ...(nonNegativeNumber(output) ? { output } : {}),
          ...(nonNegativeNumber(cacheRead) ? { cache_read: cacheRead } : {}),
        }
        if (Object.keys(updates).length > 0) {
          result.cost = { ...(result.cost ?? {}), ...updates }
        }
      }

      const capabilities = object(model.capabilities)
      if (typeof capabilities?.reasoning === 'boolean') {
        result.reasoning = capabilities.reasoning
      }

      const variants = reasoningVariants(capabilities?.effort_tiers)
      if (variants) {
        result.variants = variants
        if (Object.keys(variants).length > 0) result.reasoning = true
      }

      return result
    },
  }
}
