import { createBifrostEnricher } from './bifrost'
import { createLiteLLMEnricher } from './litellm'
import { createLMStudioEnricher } from './lmstudio'
import { createLlamaSwapEnricher } from './llamaswap'
import { createModelsDevEnricher } from './models-dev'
import { createOmniRouteEnricher } from './omniroute'
import { createVLLMEnricher } from './vllm'
import { createAIProxyEnricher } from './aiproxy'
import { ModelInfoFormat } from '../../types/plugin-config'
import type { ModelEnricher, ModelEnrichmentContext } from '../../core/model-enrichment'

type ModelEnricherFactory = (data: unknown, options?: ModelEnrichmentContext) => ModelEnricher

const MODEL_ENRICHERS: Partial<Record<ModelInfoFormat, ModelEnricherFactory>> = {
  [ModelInfoFormat.ModelsDev]: (data) => createModelsDevEnricher(data),
  [ModelInfoFormat.Bifrost]: (data) => createBifrostEnricher(data),
  [ModelInfoFormat.VLLM]: (data) => createVLLMEnricher(data),
  [ModelInfoFormat.LlamaSwap]: (data) => createLlamaSwapEnricher(data),
  [ModelInfoFormat.OmniRoute]: (data) => createOmniRouteEnricher(data),
  [ModelInfoFormat.LMStudio]: (data) => createLMStudioEnricher(data),
  [ModelInfoFormat.LiteLLM]: (data) => createLiteLLMEnricher(data),
  [ModelInfoFormat.AIProxy]: (data) => createAIProxyEnricher(data),
}

/** Creates the neutral contract used by the shared discovery pipeline. */
export function createModelEnricher(
  format: ModelInfoFormat,
  data: unknown,
  options?: ModelEnrichmentContext,
): ModelEnricher | undefined {
  return MODEL_ENRICHERS[format]?.(data, options)
}

export function isSupportedModelInfoFormat(format: ModelInfoFormat): boolean {
  return MODEL_ENRICHERS[format] !== undefined
}

export { createModelsDevEnricher } from './models-dev'
export type { ModelEnricher, ModelEnrichmentContext, ModelEnrichmentResult } from '../../core/model-enrichment'
