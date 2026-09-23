import type { LMStudioInventoryModel } from '../../types'
import type { ModelInfoEnricher } from './types'

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

function getModelInfo(models: Map<string, LMStudioInventoryModel>, modelId: string): LMStudioInventoryModel | undefined {
  return models.get(modelId)
}

export function createLMStudioModelInfoEnricher(data: unknown): ModelInfoEnricher {
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
    shouldSkipModel(): boolean {
      return false
    },
    getModelName(modelId: string): string | undefined {
      const displayName = getModelInfo(models, modelId)?.display_name
      return typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined
    },
    applyModelInfo(modelConfig: any, modelId: string): void {
      const model = getModelInfo(models, modelId)
      if (!model) return

      const contextLimit = getLoadedContextLimit(model) ?? (hasUsableNumber(model.max_context_length) ? model.max_context_length : undefined)
      if (contextLimit) {
        // OpenCode requires both fields when a limit object is present. Zero preserves its output-token fallback.
        modelConfig.limit = { context: contextLimit, output: 0 }
      }

      const capabilities = model.capabilities && typeof model.capabilities === 'object'
        ? model.capabilities as Record<string, unknown>
        : undefined
      if (capabilities?.vision === true) {
        const input = Array.isArray(modelConfig.modalities?.input) ? modelConfig.modalities.input : []
        const output = Array.isArray(modelConfig.modalities?.output) ? modelConfig.modalities.output : []
        modelConfig.modalities = {
          input: [...new Set([...input, 'image'])],
          ...(output.length > 0 ? { output } : {}),
        }
      }
      if (capabilities?.trained_for_tool_use === true) modelConfig.tool_call = true

      const reasoningOptions = getReasoningOptions(model)
      if (reasoningOptions.length > 0) {
        modelConfig.reasoning = true
        const variants = getReasoningVariants(reasoningOptions)
        if (variants) modelConfig.variants = variants
      }
    },
  }
}
