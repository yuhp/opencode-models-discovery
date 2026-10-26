import { ModelInfoFormat } from '../types/plugin-config'
import { createDeferredModelEnricher, createModelEnricher, isSupportedModelInfoFormat, type ModelEnricher } from '../utils/model-info/index'
import { fetchModelsDevData, DEFAULT_MODELS_DEV_URL } from '../utils/models-dev-fetcher'
import { buildModelInfoURL } from './model-info-url'

export { buildModelInfoURL } from './model-info-url'

export const DEFAULT_LITELLM_ENDPOINT = '/v1/model/info'
export const DEFAULT_LMSTUDIO_ENDPOINT = '/api/v1/models'
export const DEFAULT_ENRICHER_TIMEOUT_MS = 5000

export interface ModelInfoResolutionOptions {
  readonly format?: ModelInfoFormat | string
  readonly endpoint?: string
  readonly filterNonChat?: boolean
  readonly timeoutMs?: number
}

export interface ModelInfoResolverLogger {
  warn(message: string, context?: Record<string, unknown>): void
  info?(message: string, context?: Record<string, unknown>): void
}

export interface ModelInfoResolverContext {
  readonly baseURL: string
  readonly apiKey?: string
  readonly providerName?: string
  readonly fetcher?: typeof fetch
  readonly logger?: ModelInfoResolverLogger
}

/**
 * Shared model-info enricher resolution across V1 and V2 adapters.
 * Dispatches to static indexes, inline/local formats, or remote provider endpoints.
 */
export async function resolveModelInfoEnricher(
  context: ModelInfoResolverContext,
  options: ModelInfoResolutionOptions,
): Promise<ModelEnricher | undefined> {
  const rawFormat = options.format
  if (!rawFormat) return undefined

  const format = rawFormat as ModelInfoFormat
  if (!isSupportedModelInfoFormat(format)) {
    context.logger?.warn('Unsupported provider model info format', {
      provider: context.providerName,
      format: rawFormat,
    })
    return undefined
  }

  const filterNonChat = options.filterNonChat !== false

  if (format === ModelInfoFormat.ModelsDev || format === ModelInfoFormat.AIProxy) {
    const endpoint = options.endpoint ?? DEFAULT_MODELS_DEV_URL
    const data = await fetchModelsDevData(endpoint)
    const enricher = createModelEnricher(format, data, { filterNonChat })
    context.logger?.info?.('Loaded models.dev data', {
      provider: context.providerName,
      endpoint,
      count: data.size,
    })
    return enricher
  }

  if (
    format === ModelInfoFormat.Bifrost ||
    format === ModelInfoFormat.VLLM ||
    format === ModelInfoFormat.LlamaSwap ||
    format === ModelInfoFormat.OmniRoute ||
    format === ModelInfoFormat.OpenRouter
  ) {
    return createModelEnricher(format, null)
  }

  const deferred = createDeferredModelEnricher(format, {
    baseURL: context.baseURL,
    apiKey: context.apiKey,
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs ?? DEFAULT_ENRICHER_TIMEOUT_MS,
    fetcher: context.fetcher,
    logger: context.logger,
  })
  if (deferred) return deferred

  if (format === ModelInfoFormat.LiteLLM || format === ModelInfoFormat.LMStudio) {
    const defaultEndpoint = format === ModelInfoFormat.LiteLLM ? DEFAULT_LITELLM_ENDPOINT : DEFAULT_LMSTUDIO_ENDPOINT
    const targetEndpoint = options.endpoint ?? defaultEndpoint
    const infoUrl = buildModelInfoURL(context.baseURL, targetEndpoint)

    const headers = new Headers({ accept: 'application/json' })
    if (context.apiKey) {
      headers.set('authorization', `Bearer ${context.apiKey}`)
    }

    const fetcher = context.fetcher ?? globalThis.fetch
    const timeoutMs = options.timeoutMs ?? DEFAULT_ENRICHER_TIMEOUT_MS

    try {
      const res = await fetcher(infoUrl, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.ok) {
        const data = await res.json()
        return createModelEnricher(format, data, { filterNonChat })
      }
      context.logger?.warn('Provider model info discovery failed', {
        provider: context.providerName,
        baseURL: context.baseURL,
        endpoint: targetEndpoint,
        format,
        status: res.status,
      })
      return undefined
    } catch (error) {
      context.logger?.warn('Provider model info discovery failed', {
        provider: context.providerName,
        baseURL: context.baseURL,
        endpoint: targetEndpoint,
        format,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  return undefined
}
