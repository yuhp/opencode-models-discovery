import { createBifrostEnricher } from './bifrost'
import { createLiteLLMEnricher } from './litellm'
import { createLMStudioEnricher } from './lmstudio'
import { createLlamaSwapEnricher } from './llamaswap'
import { createModelsDevEnricher } from './models-dev'
import { createOmniRouteEnricher } from './omniroute'
import { createVLLMEnricher } from './vllm'
import { createAIProxyEnricher } from './aiproxy'
import { createOpenRouterEnricher } from './openrouter'
import { createOllamaEnricher } from './ollama'
import { ModelInfoFormat } from '../../types/plugin-config'
import type { ModelEnricher, ModelEnricherDeferredContext, ModelEnrichmentContext } from '../../core/model-enrichment'

type ModelEnricherFactory = (data: unknown, options?: ModelEnrichmentContext) => ModelEnricher
type DeferredModelEnricherFactory = (context: ModelEnricherDeferredContext) => ModelEnricher

const MODEL_ENRICHERS: Partial<Record<ModelInfoFormat, ModelEnricherFactory>> = {
  [ModelInfoFormat.ModelsDev]: (data) => createModelsDevEnricher(data),
  [ModelInfoFormat.Bifrost]: (data) => createBifrostEnricher(data),
  [ModelInfoFormat.VLLM]: (data) => createVLLMEnricher(data),
  [ModelInfoFormat.LlamaSwap]: (data) => createLlamaSwapEnricher(data),
  [ModelInfoFormat.OmniRoute]: (data) => createOmniRouteEnricher(data),
  [ModelInfoFormat.LMStudio]: (data) => createLMStudioEnricher(data),
  [ModelInfoFormat.LiteLLM]: (data) => createLiteLLMEnricher(data),
  [ModelInfoFormat.AIProxy]: (data) => createAIProxyEnricher(data),
  [ModelInfoFormat.OpenRouter]: (data) => createOpenRouterEnricher(data),
}

/**
 * Formats whose metadata requires a second per-model request after the probe
 * list is known. Their factories only bind request context; network work
 * happens later in ModelEnricher.prepare().
 */
const DEFERRED_MODEL_ENRICHERS: Partial<Record<ModelInfoFormat, DeferredModelEnricherFactory>> = {
  [ModelInfoFormat.Ollama]: (context) => createOllamaEnricher(context),
}

/** Creates the neutral contract used by the shared discovery pipeline. */
export function createModelEnricher(
  format: ModelInfoFormat,
  data: unknown,
  options?: ModelEnrichmentContext,
): ModelEnricher | undefined {
  return MODEL_ENRICHERS[format]?.(data, options)
}

/** Creates a request-bound enricher whose hydration runs in prepare(). */
export function createDeferredModelEnricher(
  format: ModelInfoFormat,
  context: ModelEnricherDeferredContext,
): ModelEnricher | undefined {
  return DEFERRED_MODEL_ENRICHERS[format]?.(context)
}

export function isSupportedModelInfoFormat(format: ModelInfoFormat): boolean {
  return MODEL_ENRICHERS[format] !== undefined || DEFERRED_MODEL_ENRICHERS[format] !== undefined
}

export { createModelsDevEnricher } from './models-dev'
export type { ModelEnricher, ModelEnrichmentContext, ModelEnrichmentResult } from '../../core/model-enrichment'
