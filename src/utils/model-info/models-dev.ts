import { lookupModelsDevData, type ModelsDevModel } from '../models-dev-fetcher'
import type { ModelEnricher } from '../../core/model-enrichment'
import { createModelLimits, type DiscoveredRawModel } from '../../core/model-types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function firstUsableNumber(...values: readonly unknown[]): number | undefined {
  return values.find(hasUsableNumber)
}

/**
 * Reads token limits advertised inline by an OpenAI-compatible /v1/models entry.
 *
 * Gateways that front several upstreams (CLIProxyAPI, LiteLLM poolers, custom
 * routers) advertise the limits they actually accept. Those values describe the
 * live endpoint, so they take precedence over the static models.dev catalog,
 * which can lag behind or overstate what a specific route enforces.
 */
function advertisedProviderLimits(model: DiscoveredRawModel): { context?: number; output?: number } | undefined {
  const context = firstUsableNumber(model.context_length, model.max_context_length)
  const output = firstUsableNumber(model.max_completion_tokens, model.max_output_tokens)
  if (context === undefined && output === undefined) return undefined
  return {
    ...(context !== undefined ? { context } : {}),
    ...(output !== undefined ? { output } : {}),
  }
}

export function createModelsDevEnricher(data: unknown): ModelEnricher {
  const cache = data instanceof Map ? data as Map<string, ModelsDevModel> : new Map<string, ModelsDevModel>()
  return {
    enrich(model) {
      const info = lookupModelsDevData(model.id, cache)
      const advertised = advertisedProviderLimits(model)
      const infoContext = hasUsableNumber(info?.limit?.context) ? info?.limit?.context : info?.limit?.input
      const contextLimit = advertised?.context ?? infoContext
      const limits = hasUsableNumber(contextLimit)
        ? createModelLimits(contextLimit, advertised?.output ?? info?.limit?.output, info?.limit?.input)
        : undefined
      return {
        metadataName: info?.name,
        ...(limits ? { limit: limits } : {}),
        ...(typeof info?.attachment === 'boolean' ? { attachment: info.attachment } : {}),
        ...(typeof info?.reasoning === 'boolean' ? { reasoning: info.reasoning } : {}),
        ...(typeof info?.tool_call === 'boolean' ? { toolCall: info.tool_call } : {}),
        ...(typeof info?.structured_output === 'boolean' ? { structuredOutput: info.structured_output } : {}),
        ...(typeof info?.temperature === 'boolean' ? { temperature: info.temperature } : {}),
        ...(info?.modalities ? { modalities: info.modalities } : {}),
      }
    },
  }
}
