import type { ModelInfoEnricher, ModelInfoEnricherOptions } from './types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function createVLLMModelInfoEnricher(_data: unknown, _options?: ModelInfoEnricherOptions): ModelInfoEnricher {
  return {
    shouldSkipModel(): boolean {
      return false
    },
    applyModelInfo(modelConfig: any, _modelId: string, rawModel?: Record<string, unknown>): void {
      const maxModelLen = rawModel?.max_model_len
      if (hasUsableNumber(maxModelLen)) {
        modelConfig.limit = {
          context: maxModelLen,
          output: maxModelLen,
        }
      }
    },
  }
}
