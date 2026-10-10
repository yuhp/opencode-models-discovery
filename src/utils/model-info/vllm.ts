import type { ModelEnricher } from '../../core/model-enrichment'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function createVLLMEnricher(_data: unknown): ModelEnricher {
  return {
    enrich(model) {
      const maxModelLen = model.max_model_len
      if (hasUsableNumber(maxModelLen)) {
        return { limit: {
          context: maxModelLen,
          output: maxModelLen,
        } }
      }
      return {}
    },
  }
}
