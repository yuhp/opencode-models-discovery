import { createLiteLLMModelInfoEnricher } from './litellm'
import { createModelsDevModelInfoEnricher } from './models-dev'
import { createVLLMModelInfoEnricher } from './vllm'
import { ModelInfoFormat } from '../../types/plugin-config'
import type { ModelInfoEnricher, ModelInfoEnricherOptions } from './types'

type ModelInfoEnricherFactory = (data: unknown, options?: ModelInfoEnricherOptions) => ModelInfoEnricher

const MODEL_INFO_ENRICHERS: Partial<Record<ModelInfoFormat, ModelInfoEnricherFactory>> = {
  [ModelInfoFormat.LiteLLM]: createLiteLLMModelInfoEnricher,
  [ModelInfoFormat.ModelsDev]: createModelsDevModelInfoEnricher,
  [ModelInfoFormat.VLLM]: createVLLMModelInfoEnricher,
}

export function createModelInfoEnricher(
  format: ModelInfoFormat,
  data: unknown,
  options?: ModelInfoEnricherOptions
): ModelInfoEnricher | undefined {
  return MODEL_INFO_ENRICHERS[format]?.(data, options)
}

export function isSupportedModelInfoFormat(format: ModelInfoFormat): boolean {
  return MODEL_INFO_ENRICHERS[format] !== undefined
}

export type { ModelInfoEnricher, ModelInfoEnricherOptions }
