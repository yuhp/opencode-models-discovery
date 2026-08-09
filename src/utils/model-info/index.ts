import { createBifrostModelInfoEnricher } from './bifrost'
import { createLiteLLMModelInfoEnricher } from './litellm'
import { createLMStudioModelInfoEnricher } from './lmstudio'
import { createModelsDevModelInfoEnricher } from './models-dev'
import { createOmniRouteModelInfoEnricher } from './omni-route'
import { createVLLMModelInfoEnricher } from './vllm'
import { ModelInfoFormat } from '../../types/plugin-config'
import type { ModelInfoEnricher, ModelInfoEnricherOptions } from './types'

type ModelInfoEnricherFactory = (data: unknown, options?: ModelInfoEnricherOptions) => ModelInfoEnricher

const MODEL_INFO_ENRICHERS: Partial<Record<ModelInfoFormat, ModelInfoEnricherFactory>> = {
  [ModelInfoFormat.Bifrost]: createBifrostModelInfoEnricher,
  [ModelInfoFormat.LiteLLM]: createLiteLLMModelInfoEnricher,
  [ModelInfoFormat.ModelsDev]: createModelsDevModelInfoEnricher,
  [ModelInfoFormat.OmniRoute]: createOmniRouteModelInfoEnricher,
  [ModelInfoFormat.VLLM]: createVLLMModelInfoEnricher,
  [ModelInfoFormat.LMStudio]: createLMStudioModelInfoEnricher,
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
