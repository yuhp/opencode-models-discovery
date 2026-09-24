import { type ConfiguredProvider, type DiscoveredV2Model, type Inventory } from "./catalog.js"
import { type ModelFieldFilter, type ProviderDiscoveryOptions } from "./provider-config.js"
import { mapToDiscoveredV2Model, type RawOpenAIModel } from "./model-mapper.js"
import { createModelInfoEnricher, type ModelInfoEnricher } from "../utils/model-info/index.js"
import { ModelInfoFormat } from "../types/plugin-config.js"
import { fetchModelsDevData, DEFAULT_MODELS_DEV_URL } from "../utils/models-dev-fetcher.js"

export interface CatalogProvider extends ConfiguredProvider {
  /** Ephemeral request credential resolved by the plugin refresh orchestration. */
  readonly apiKey?: string
}

function isOpenAICompatible(provider: CatalogProvider): boolean {
  return provider.package === "@opencode-ai/ai/providers/openai-compatible" || provider.package.includes("openai-compatible")
}

function matchesFieldFilter(model: RawOpenAIModel, filter: ModelFieldFilter): boolean {
  const value = model[filter.field]
  if (filter.match !== undefined) return typeof value === "string" && new RegExp(filter.match).test(value)
  return value === filter.equals
}

function included(model: RawOpenAIModel, config: ProviderDiscoveryOptions): boolean {
  if (config.includeBy.length > 0 && !config.includeBy.some((filter) => matchesFieldFilter(model, filter))) return false
  if (config.excludeBy.some((filter) => matchesFieldFilter(model, filter))) return false
  if (config.includeRegex.length > 0 && !config.includeRegex.some((filter) => filter.test(model.id))) return false
  return !config.excludeRegex.some((filter) => filter.test(model.id))
}

const DEFAULT_LITELLM_ENDPOINT = "/v1/model/info"
const DEFAULT_LMSTUDIO_ENDPOINT = "/api/v1/models"

async function resolveModelInfoEnricher(
  baseURL: string,
  apiKey: string | undefined,
  config: ProviderDiscoveryOptions,
  fetcher: typeof fetch,
): Promise<ModelInfoEnricher | undefined> {
  const format = config.modelInfoFormat
  if (!format) return undefined

  if (format === ModelInfoFormat.ModelsDev) {
    const endpoint = config.modelInfoEndpoint ?? DEFAULT_MODELS_DEV_URL
    const data = await fetchModelsDevData(endpoint)
    return createModelInfoEnricher(format, data, { filterNonChat: config.filterNonChat })
  }

  if (
    format === ModelInfoFormat.Bifrost ||
    format === ModelInfoFormat.VLLM ||
    format === ModelInfoFormat.LlamaSwap ||
    format === ModelInfoFormat.OmniRoute
  ) {
    return createModelInfoEnricher(format, null)
  }

  if (format === ModelInfoFormat.LiteLLM || format === ModelInfoFormat.LMStudio) {
    const defaultEndpoint = format === ModelInfoFormat.LiteLLM ? DEFAULT_LITELLM_ENDPOINT : DEFAULT_LMSTUDIO_ENDPOINT
    const targetEndpoint = config.modelInfoEndpoint ?? defaultEndpoint
    const infoUrl = /^https?:\/\//i.test(targetEndpoint)
      ? targetEndpoint
      : new URL(targetEndpoint.replace(/^\//, ""), baseURL.endsWith("/") ? baseURL : `${baseURL}/`).toString()

    const headers = new Headers({ accept: "application/json" })
    if (apiKey) headers.set("authorization", `Bearer ${apiKey}`)

    try {
      const res = await fetcher(infoUrl, {
        headers,
        signal: AbortSignal.timeout(config.timeoutMs),
      })
      if (res.ok) {
        const data = await res.json()
        return createModelInfoEnricher(format, data, { filterNonChat: config.filterNonChat })
      }
    } catch {
      // Endpoint query failed; fallback without enricher
    }
  }

  return undefined
}

export async function discoverInventory(
  providers: readonly CatalogProvider[],
  discovery: ReadonlyMap<string, ProviderDiscoveryOptions>,
  fetcher: typeof fetch = fetch,
): Promise<Inventory> {
  const inventory: Inventory = new Map()

  await Promise.all(providers.map(async (provider) => {
    const config = discovery.get(provider.id)
    if (!config || !isOpenAICompatible(provider)) return

    const baseURL = typeof provider.settings.baseURL === "string" ? provider.settings.baseURL : undefined
    if (!baseURL) return

    const resolvedApiKey = typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0
      ? provider.apiKey.trim()
      : (typeof provider.settings.apiKey === "string" && provider.settings.apiKey.trim().length > 0 ? provider.settings.apiKey.trim() : undefined)

    const url = new URL(config.endpoint, new URL(baseURL).origin).toString()
    const headers = new Headers({ accept: "application/json" })
    if (resolvedApiKey) headers.set("authorization", `Bearer ${resolvedApiKey}`)

    try {
      const [modelsResponse, enricher] = await Promise.all([
        fetcher(url, {
          headers,
          signal: AbortSignal.timeout(config.timeoutMs),
        }),
        resolveModelInfoEnricher(baseURL, resolvedApiKey, config, fetcher),
      ])

      if (!modelsResponse.ok) return

      const payload = await modelsResponse.json() as { data?: unknown }
      if (!Array.isArray(payload?.data)) return

      const models = new Map<string, DiscoveredV2Model>()
      for (const entry of payload.data) {
        if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string") continue
        const candidate = entry as RawOpenAIModel
        if (!included(candidate, config)) continue
        if (enricher?.shouldSkipModel(candidate.id)) continue

        models.set(candidate.id, mapToDiscoveredV2Model(candidate, config, enricher))
      }

      inventory.set(provider.id, models)
    } catch {
      // Network and parsing failures are non-fatal; existing discovered models remain untouched.
    }
  }))

  return inventory
}
