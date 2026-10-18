/* eslint-disable no-console */
import { type ConfiguredProvider, type DiscoveredV2Model, type Inventory } from "./catalog.js"
import { type ProviderDiscoveryOptions } from "./provider-config.js"
import { mapToDiscoveredV2Model } from "../core/model-mapper.js"
import { discoverModelDrafts } from "../core/discovery-pipeline.js"
import { isDiscoveredRawModel } from "../core/model-types.js"
import type { ModelEnrichmentResult, ModelEnricher } from "../core/model-enrichment.js"
import { createDiscoveryCacheEntry, discoveryCacheKey, readDiscoveryCache, writeDiscoveryCache, type DiscoveryCacheBackend, type DiscoveryCacheEntry } from "../core/discovery-cache.js"
import { resolveModelInfoEnricher } from "../core/enricher-resolver.js"
import { ModelInfoFormat } from "../types/plugin-config.js"

export interface DiscoveryLogger {
  warn(message: string, context?: Record<string, unknown>): void
  info?(message: string, context?: Record<string, unknown>): void
  debug?(message: string, context?: Record<string, unknown>): void
  error?(message: string, context?: Record<string, unknown>): void
}

const defaultLogger: DiscoveryLogger = {
  warn(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.warn(`[opencode-models-discovery] ${message}`, context)
    } else {
      console.warn(`[opencode-models-discovery] ${message}`)
    }
  },
  info(message, context) {
    if (context && Object.keys(context).length > 0) {
      console.info(`[opencode-models-discovery] ${message}`, context)
    } else {
      console.info(`[opencode-models-discovery] ${message}`)
    }
  },
}

export interface CatalogProvider extends ConfiguredProvider {
  /** Ephemeral request credential resolved by the plugin refresh orchestration. */
  readonly apiKey?: string
}

function cachedEnricher(enrichments: Record<string, ModelEnrichmentResult>): ModelEnricher {
  return {
    enrich(model) {
      return enrichments[model.id] ?? {}
    },
  }
}

function parseModelsPayload(payload: unknown): readonly unknown[] | undefined {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : undefined
  return Array.isArray(data) ? data : undefined
}

export async function discoverInventory(
  providers: readonly CatalogProvider[],
  discovery: ReadonlyMap<string, ProviderDiscoveryOptions>,
  fetcher: typeof fetch = fetch,
  storage?: DiscoveryCacheBackend,
  options?: { readonly force?: boolean; readonly logger?: DiscoveryLogger },
): Promise<Inventory> {
  const inventory: Inventory = new Map()
  const logger = options?.logger ?? defaultLogger

  await Promise.all(providers.map(async (provider) => {
    const config = discovery.get(provider.id)
    if (!config) return

    const baseURL = typeof provider.settings.baseURL === "string" ? provider.settings.baseURL : undefined
    if (!baseURL) {
      logger.warn(`Model discovery skipped for provider "${provider.id}": missing or invalid settings.baseURL`, {
        provider: provider.id,
      })
      return
    }

    const cacheConfig = config.cache
    const cacheSupported = cacheConfig?.enabled === true && storage !== undefined
    const cacheReadable = cacheSupported && options?.force !== true
    const endpoint = config.endpoint
    let cached: DiscoveryCacheEntry | undefined
    if (cacheReadable) {
      cached = await readDiscoveryCache(storage, discoveryCacheKey("opencode.models-discovery.v2", provider.id), {
        providerID: provider.id,
        baseURL,
        endpoint,
        modelInfoFormat: config.modelInfoFormat,
        modelInfoEndpoint: config.modelInfoEndpoint,
      }, cacheConfig.ttlSeconds)
    }

    const resolvedApiKey = typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0
      ? provider.apiKey.trim()
      : (typeof provider.settings.apiKey === "string" && provider.settings.apiKey.trim().length > 0 ? provider.settings.apiKey.trim() : undefined)

    const url = new URL(config.endpoint, new URL(baseURL).origin).toString()
    const headers = new Headers({ accept: "application/json" })
    if (resolvedApiKey) headers.set("authorization", `Bearer ${resolvedApiKey}`)

    try {
      let rawModels: readonly unknown[]
      let enricher: ModelEnricher | undefined
      if (cached) {
        rawModels = cached.rawModels
        enricher = cachedEnricher(cached.enrichments)
      } else if (config.modelInfoFormat === ModelInfoFormat.Ollama) {
        const modelsResponse = await fetcher(url, {
          headers,
          signal: AbortSignal.timeout(config.timeoutMs),
        })
        if (!modelsResponse.ok) {
          logger.warn(`Model discovery request failed for provider "${provider.id}"`, {
            provider: provider.id,
            url,
            status: modelsResponse.status,
            statusText: modelsResponse.statusText,
          })
          return
        }

        const payload = await modelsResponse.json() as { data?: unknown }
        const models = parseModelsPayload(payload)
        if (!models) {
          logger.warn(`Model discovery returned invalid payload for provider "${provider.id}": expected array in "data" property`, {
            provider: provider.id,
            url,
            payloadType: typeof payload,
            keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : undefined,
          })
          return
        }
        rawModels = models
        enricher = await resolveModelInfoEnricher({
          baseURL,
          apiKey: resolvedApiKey,
          providerName: provider.id,
          fetcher,
          logger: {
            warn: (message, context) => logger.warn(message, context),
            info: (message, context) => logger.info?.(message, context),
          },
        }, {
          format: config.modelInfoFormat,
          endpoint: config.modelInfoEndpoint,
          filterNonChat: config.filterNonChat,
          timeoutMs: config.timeoutMs,
          modelIds: models.filter(isDiscoveredRawModel).map((model) => model.id),
        })
      } else {
        const [modelsResponse, resolvedEnricher] = await Promise.all([
          fetcher(url, {
            headers,
            signal: AbortSignal.timeout(config.timeoutMs),
          }),
          resolveModelInfoEnricher({
            baseURL,
            apiKey: resolvedApiKey,
            providerName: provider.id,
            fetcher,
            logger: {
              warn: (message, context) => logger.warn(message, context),
              info: (message, context) => logger.info?.(message, context),
            },
          }, {
            format: config.modelInfoFormat,
            endpoint: config.modelInfoEndpoint,
            filterNonChat: config.filterNonChat,
            timeoutMs: config.timeoutMs,
          }),
        ])

        if (!modelsResponse.ok) {
          logger.warn(`Model discovery request failed for provider "${provider.id}"`, {
            provider: provider.id,
            url,
            status: modelsResponse.status,
            statusText: modelsResponse.statusText,
          })
          return
        }

        const payload = await modelsResponse.json() as { data?: unknown }
        const models = parseModelsPayload(payload)
        if (!models) {
          logger.warn(`Model discovery returned invalid payload for provider "${provider.id}": expected array in "data" property`, {
            provider: provider.id,
            url,
            payloadType: typeof payload,
            keys: payload && typeof payload === "object" && !Array.isArray(payload) ? Object.keys(payload) : undefined,
          })
          return
        }
        rawModels = models
        enricher = resolvedEnricher
      }

        const enrichments: Record<string, ModelEnrichmentResult> = {}
        const recordingEnricher = enricher
          ? { enrich(model: Parameters<ModelEnricher['enrich']>[0], context: Parameters<ModelEnricher['enrich']>[1]) {
              const result = enricher!.enrich(model, context)
              if (!cached) enrichments[model.id] = result
              return result
            } } satisfies ModelEnricher
          : undefined
        const drafts = discoverModelDrafts(rawModels, {
         filter: {
           includeBy: config.includeBy.map((filter) => ({ ...filter, match: filter.match ? new RegExp(filter.match) : undefined })),
           excludeBy: config.excludeBy.map((filter) => ({ ...filter, match: filter.match ? new RegExp(filter.match) : undefined })),
           includeRegex: config.includeRegex,
           excludeRegex: config.excludeRegex,
         },
         smartModelName: config.smartModelName,
          enricher: recordingEnricher,
         enrichmentContext: { filterNonChat: config.filterNonChat },
       })
        const models = new Map<string, DiscoveredV2Model>(drafts.map((draft) => [draft.id, mapToDiscoveredV2Model(draft, config)]))

        inventory.set(provider.id, models)
        if (cacheSupported && !cached) {
          await writeDiscoveryCache(storage, discoveryCacheKey("opencode.models-discovery.v2", provider.id), createDiscoveryCacheEntry({
              providerID: provider.id,
              baseURL,
              endpoint,
              modelInfoFormat: config.modelInfoFormat,
              modelInfoEndpoint: config.modelInfoEndpoint,
            }, rawModels.filter((model): model is Record<string, unknown> =>
                !!model && typeof model === "object" && !Array.isArray(model) && typeof (model as Record<string, unknown>).id === "string"
              ), enrichments))
        }
    } catch (error) {
      logger.warn(`Model discovery error for provider "${provider.id}"`, {
        provider: provider.id,
        url,
        error: error instanceof Error ? error.message : String(error),
      })
      // Network and parsing failures are non-fatal; existing discovered models remain untouched.
    }
  }))

  return inventory
}
