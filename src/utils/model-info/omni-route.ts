import type { ModelInfoEnricher } from './types'
import type { ModelsDevModel } from '../models-dev-fetcher'

const SUPPORTED_MODALITIES = new Set(['text', 'audio', 'image', 'video', 'pdf'])

// Deterministic tie-break for models.dev fallback lookups: when a bare model
// name is served by several models.dev providers, prefer the first-party
// vendor entry over gateway resellers so limits and prices stay canonical.
const FALLBACK_PROVIDER_PRECEDENCE = [
  'anthropic',
  'openai',
  'google',
  'xai',
  'deepseek',
  'moonshotai',
  'zai',
  'zhipuai',
  'alibaba',
  'qwen',
  'xiaomi',
  'minimax',
  'mistral',
  'meta',
]

// Mirrors OpenCode's built-in Anthropic-style thinking-budget variants.
const HIGH_THINKING_BUDGET = 16000
const MAX_THINKING_BUDGET = 31999

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function firstUsableNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (hasUsableNumber(value)) return value
  }
  return undefined
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }
  return undefined
}

function getModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const modalities = [...new Set(value
    .filter((modality): modality is string => typeof modality === 'string')
    .map((modality) => modality.trim().toLowerCase())
    .map((modality) => modality === 'speech' ? 'audio' : modality)
    .filter((modality) => SUPPORTED_MODALITIES.has(modality)))]
  return modalities.length > 0 ? modalities : undefined
}

function getCapabilities(rawModel?: Record<string, unknown>): Record<string, unknown> | undefined {
  const capabilities = rawModel?.capabilities
  return isObject(capabilities) ? capabilities : undefined
}

function getEffortTiers(capabilities?: Record<string, unknown>): string[] {
  const tiers = capabilities?.effort_tiers
  if (!Array.isArray(tiers)) return []

  return [...new Set(tiers
    .filter((tier): tier is string => typeof tier === 'string')
    .map((tier) => tier.trim())
    .filter((tier) => tier.length > 0))]
}

function createEffortVariants(efforts: string[]): Record<string, { reasoningEffort: string }> {
  return Object.fromEntries(efforts.map((effort) => [effort, { reasoningEffort: effort }]))
}

function createInlineCost(pricing: unknown): Record<string, number> | undefined {
  if (!isObject(pricing)) return undefined

  // OmniRoute pricing is USD per million tokens, matching OpenCode's cost unit.
  const input = parseNonNegativeNumber(pricing.input)
  const output = parseNonNegativeNumber(pricing.output)
  if (input === undefined || output === undefined) return undefined

  const cacheRead = parseNonNegativeNumber(pricing.cached)
  const cacheWrite = parseNonNegativeNumber(pricing.cache_creation)
  return {
    input,
    output,
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
  }
}

function createFallbackCost(cost: ModelsDevModel['cost']): Record<string, number> | undefined {
  const input = parseNonNegativeNumber(cost?.input)
  const output = parseNonNegativeNumber(cost?.output)
  if (input === undefined || output === undefined) return undefined

  const cacheRead = parseNonNegativeNumber(cost?.cache_read)
  const cacheWrite = parseNonNegativeNumber(cost?.cache_write)
  return {
    input,
    output,
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
  }
}

function splitCacheKey(key: string): { provider?: string; model: string } {
  const separatorIndex = key.indexOf('/')
  if (separatorIndex === -1) return { model: key }

  return {
    provider: key.slice(0, separatorIndex).toLowerCase(),
    model: key.slice(separatorIndex + 1),
  }
}

export function lookupOmniRouteFallbackModel(
  cache: Map<string, ModelsDevModel>,
  modelId: string
): ModelsDevModel | undefined {
  let cleanId = modelId.replace(/:[a-zA-Z0-9_-]+$/g, '')
  const parts = cleanId.split('/')
  if (parts.length > 2) {
    cleanId = parts.slice(-2).join('/')
  }

  const exactMatch = cache.get(cleanId) ?? cache.get(cleanId.toLowerCase())
  if (exactMatch) return exactMatch

  const requestedModelLower = splitCacheKey(cleanId).model.toLowerCase()
  const matches: Array<{ provider?: string; value: ModelsDevModel }> = []
  for (const [key, value] of cache.entries()) {
    const candidate = splitCacheKey(key)
    if (candidate.model.toLowerCase() === requestedModelLower) {
      matches.push({ provider: candidate.provider, value })
    }
  }

  if (matches.length === 1) return matches[0]?.value

  for (const preferred of FALLBACK_PROVIDER_PRECEDENCE) {
    const match = matches.find((candidate) => candidate.provider === preferred)
    if (match) return match.value
  }

  return undefined
}

function createFallbackVariants(
  info: ModelsDevModel | undefined,
  outputLimit: number | undefined
): Record<string, unknown> | undefined {
  const options = info?.reasoning_options
  if (!Array.isArray(options) || options.length === 0) return undefined

  const effortValues = options.find((option) => option?.type === 'effort' && Array.isArray(option.values))?.values ?? []
  const efforts = [...new Set(effortValues.filter((value) => typeof value === 'string' && value.trim().length > 0))]
  if (efforts.length > 0) {
    return createEffortVariants(efforts)
  }

  const budgetOption = options.find((option) => option?.type === 'budget_tokens')
  if (!budgetOption) return undefined

  const minBudget = hasUsableNumber(budgetOption.min) ? budgetOption.min : 1024
  const capBudget = (budget: number): number => {
    const capped = hasUsableNumber(outputLimit) ? Math.min(budget, outputLimit - 1) : budget
    return Math.max(minBudget, capped)
  }
  const highBudget = hasUsableNumber(outputLimit)
    ? Math.min(HIGH_THINKING_BUDGET, Math.floor(outputLimit / 2 - 1))
    : HIGH_THINKING_BUDGET

  return {
    high: { thinking: { type: 'enabled', budgetTokens: capBudget(highBudget) } },
    max: { thinking: { type: 'enabled', budgetTokens: capBudget(MAX_THINKING_BUDGET) } },
  }
}

export function createOmniRouteModelInfoEnricher(data: unknown): ModelInfoEnricher {
  const cache = data instanceof Map ? data as Map<string, ModelsDevModel> : new Map<string, ModelsDevModel>()

  return {
    shouldSkipModel(): boolean {
      return false
    },
    getModelName(modelId: string, rawModel?: Record<string, unknown>): string | undefined {
      const inlineName = rawModel?.name
      if (typeof inlineName === 'string' && inlineName.length > 0) return inlineName

      return lookupOmniRouteFallbackModel(cache, modelId)?.name
    },
    applyModelInfo(modelConfig: any, modelId: string, rawModel?: Record<string, unknown>): void {
      const capabilities = getCapabilities(rawModel)
      const fallback = lookupOmniRouteFallbackModel(cache, modelId)

      // Context and output limits: inline OmniRoute fields win, models.dev fills gaps per field.
      const context = firstUsableNumber(rawModel?.context_length, fallback?.limit?.context)
      const input = firstUsableNumber(rawModel?.max_input_tokens, fallback?.limit?.input)
      const output = firstUsableNumber(rawModel?.max_output_tokens, fallback?.limit?.output)
      if (hasUsableNumber(context)) {
        modelConfig.limit = {
          context,
          ...(hasUsableNumber(input) ? { input } : {}),
          // OpenCode requires both fields when a limit object is present. Zero preserves its output-token fallback.
          output: hasUsableNumber(output) ? output : 0,
        }
      }

      const inputModalities = getModalities(rawModel?.input_modalities) ?? getModalities(fallback?.modalities?.input)
      const outputModalities = getModalities(rawModel?.output_modalities) ?? getModalities(fallback?.modalities?.output)
      if (inputModalities || outputModalities) {
        modelConfig.modalities = {
          ...(inputModalities ? { input: inputModalities } : {}),
          ...(outputModalities ? { output: outputModalities } : {}),
        }
      }

      const reasoning = firstBoolean(capabilities?.reasoning, capabilities?.thinking, capabilities?.supportsThinking, fallback?.reasoning)
      if (reasoning !== undefined) modelConfig.reasoning = reasoning
      const toolCall = firstBoolean(capabilities?.tool_calling, fallback?.tool_call)
      if (toolCall !== undefined) modelConfig.tool_call = toolCall
      const attachment = firstBoolean(capabilities?.attachment, fallback?.attachment)
      if (attachment !== undefined) modelConfig.attachment = attachment
      const temperature = firstBoolean(capabilities?.temperature, fallback?.temperature)
      if (temperature !== undefined) modelConfig.temperature = temperature
      const structuredOutput = firstBoolean(capabilities?.structured_output, fallback?.structured_output)
      if (structuredOutput !== undefined) modelConfig.structured_output = structuredOutput

      const cost = createInlineCost(rawModel?.pricing) ?? createFallbackCost(fallback?.cost)
      if (cost) modelConfig.cost = cost

      const family = rawModel?.family
      if (typeof family === 'string' && family.length > 0) modelConfig.family = family
      const releaseDate = rawModel?.release_date
      if (typeof releaseDate === 'string' && releaseDate.length > 0) modelConfig.release_date = releaseDate

      // Reasoning-effort variants: OmniRoute's advertised effort tiers win.
      // When the catalog does not serve effort levels, models.dev
      // reasoning_options keep variants working (effort values or thinking budgets).
      const effortTiers = getEffortTiers(capabilities)
      if (effortTiers.length > 0) {
        modelConfig.variants = createEffortVariants(effortTiers)
        modelConfig.reasoning = true
      } else if (modelConfig.reasoning === true) {
        const fallbackVariants = createFallbackVariants(fallback, hasUsableNumber(output) ? output : undefined)
        if (fallbackVariants) modelConfig.variants = fallbackVariants
      }
    },
  }
}
