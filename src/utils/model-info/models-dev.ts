import type { ModelInfoEnricher } from './types'
import { lookupModelsDevData, type ModelsDevModel } from '../models-dev-fetcher'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function applyModelsDevModelInfo(modelConfig: any, info: ModelsDevModel | undefined): void {
  if (!info) return

  const contextLimit = hasUsableNumber(info.limit?.context) ? info.limit.context : info.limit?.input
  const outputLimit = info.limit?.output
  if (hasUsableNumber(contextLimit)) {
    // OpenCode requires both fields when a limit object is present. Zero preserves
    // its output-token fallback when models.dev has no output limit.
    modelConfig.limit = {
      context: contextLimit,
      ...(hasUsableNumber(info.limit?.input) ? { input: info.limit.input } : {}),
      output: hasUsableNumber(outputLimit) ? outputLimit : 0,
    }
  }

  if (typeof info.attachment === 'boolean') modelConfig.attachment = info.attachment
  if (typeof info.reasoning === 'boolean') modelConfig.reasoning = info.reasoning
  if (typeof info.tool_call === 'boolean') modelConfig.tool_call = info.tool_call
  if (typeof info.structured_output === 'boolean') modelConfig.structured_output = info.structured_output
  if (typeof info.temperature === 'boolean') modelConfig.temperature = info.temperature
  if (info.modalities?.input?.length || info.modalities?.output?.length) {
    modelConfig.modalities = {
      ...(info.modalities.input?.length ? { input: info.modalities.input } : {}),
      ...(info.modalities.output?.length ? { output: info.modalities.output } : {}),
    }
  }
}

export function createModelsDevModelInfoEnricher(data: unknown): ModelInfoEnricher {
  const cache = data instanceof Map ? data as Map<string, ModelsDevModel> : new Map<string, ModelsDevModel>()

  return {
    shouldSkipModel(): boolean {
      return false
    },
    getModelName(modelId: string): string | undefined {
      return lookupModelsDevData(modelId, cache)?.name
    },
    applyModelInfo(modelConfig: any, modelId: string): void {
      applyModelsDevModelInfo(modelConfig, lookupModelsDevData(modelId, cache))
    },
  }
}
