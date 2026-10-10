import type { LMStudioInventoryModel } from '../../types'
import type { ModelEnricher } from '../../core/model-enrichment'
import { createModelLimits } from '../../core/model-types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function getModelKey(model: LMStudioInventoryModel): string | undefined {
  return typeof model.key === 'string' && model.key.length > 0 ? model.key : undefined
}

function getLoadedContextLimit(model: LMStudioInventoryModel): number | undefined {
  const limits = (model.loaded_instances ?? [])
    .map(instance => instance.config?.context_length)
    .filter(hasUsableNumber)

  return limits.length > 0 ? Math.max(...limits) : undefined
}

function getReasoningOptions(model: LMStudioInventoryModel): string[] {
  return model.capabilities?.reasoning?.allowed_options ?? []
}

function getReasoningVariants(options: string[]): Record<string, { reasoningEffort: string }> | undefined {
  const reasoningEfforts: Record<string, string> = {
    off: 'none',
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
  }
  const variants: Record<string, { reasoningEffort: string }> = {}
  for (const option of options) {
    const reasoningEffort = reasoningEfforts[option]
    if (reasoningEffort) variants[option] = { reasoningEffort }
  }
  return Object.keys(variants).length > 0 ? variants : undefined
}

export function createLMStudioEnricher(data: unknown): ModelEnricher {
  const models = new Map<string, LMStudioInventoryModel>()
  const inventory = data as { models?: unknown[] } | undefined
  if (Array.isArray(inventory?.models)) {
    for (const model of inventory.models) {
      if (!model || typeof model !== 'object') continue
      const typedModel = model as LMStudioInventoryModel
      const key = getModelKey(typedModel)
      if (key) models.set(key, typedModel)
    }
  }

  return {
    enrich(model) {
      const inventoryModel = models.get(model.id)
      if (!inventoryModel) return {}

      const result: {
        metadataName?: string
        limit?: { context: number; output: number }
        modalities?: { input: string[]; output: string[] }
        toolCall?: boolean
        reasoning?: boolean
        variants?: Record<string, { reasoningEffort: string }>
      } = {}

      const displayName = inventoryModel.display_name
      if (typeof displayName === 'string' && displayName.length > 0) result.metadataName = displayName

      const contextLimit = getLoadedContextLimit(inventoryModel) ?? (hasUsableNumber(inventoryModel.max_context_length) ? inventoryModel.max_context_length : undefined)
      const limits = createModelLimits(contextLimit)
      if (limits) {
        result.limit = limits
      }

      const capabilities = inventoryModel.capabilities && typeof inventoryModel.capabilities === 'object'
        ? inventoryModel.capabilities as Record<string, unknown>
        : undefined
      if (capabilities?.vision === true) {
        result.modalities = { input: ['text', 'image'], output: ['text'] }
      }
      if (capabilities?.trained_for_tool_use === true) result.toolCall = true

      const reasoningOptions = getReasoningOptions(inventoryModel)
      if (reasoningOptions.length > 0) {
        result.reasoning = true
        const variants = getReasoningVariants(reasoningOptions)
        if (variants) result.variants = variants
      }

      return result
    },
  }
}
