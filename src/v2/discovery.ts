import { type ConfiguredProvider, type DiscoveredV2Model, type Inventory } from "./catalog.js"
import { type ModelFieldFilter, type ProviderDiscoveryOptions } from "./provider-config.js"

export interface CatalogProvider extends ConfiguredProvider {
  /** Ephemeral request credential resolved by the plugin refresh orchestration. */
  readonly apiKey?: string
}

interface OpenAIModel {
  readonly id: string
  readonly [key: string]: unknown
}

function isOpenAICompatible(provider: CatalogProvider): boolean {
  return provider.package === "@opencode-ai/ai/providers/openai-compatible" || provider.package.includes("openai-compatible")
}

function matchesFieldFilter(model: OpenAIModel, filter: ModelFieldFilter): boolean {
  const value = model[filter.field]
  if (filter.match !== undefined) return typeof value === "string" && new RegExp(filter.match).test(value)
  return value === filter.equals
}

function included(model: OpenAIModel, config: ProviderDiscoveryOptions): boolean {
  if (config.includeBy.length > 0 && !config.includeBy.some((filter) => matchesFieldFilter(model, filter))) return false
  if (config.excludeBy.some((filter) => matchesFieldFilter(model, filter))) return false
  if (config.includeRegex.length > 0 && !config.includeRegex.some((filter) => filter.test(model.id))) return false
  return !config.excludeRegex.some((filter) => filter.test(model.id))
}

function displayName(id: string, smart: boolean): string {
  if (!smart) return id
  const leaf = id.split("/").at(-1) ?? id
  return leaf.split(/[-_]/).filter(Boolean).map((part) => {
    if (/^(gpt|api|vl)$/i.test(part)) return part.toUpperCase()
    return part[0]?.toUpperCase() + part.slice(1).toLowerCase()
  }).join(" ")
}

function modelToCatalog(model: OpenAIModel, config: ProviderDiscoveryOptions): DiscoveredV2Model {
  return {
    id: model.id,
    modelID: model.id,
    name: displayName(model.id, config.smartModelName),
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 200_000, output: 32_000 },
  }
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

    const resolvedApiKey = provider.apiKey
      ?? (typeof provider.settings.apiKey === "string" ? provider.settings.apiKey : undefined)

    const url = new URL(config.endpoint, new URL(baseURL).origin).toString()
    const headers = new Headers({ accept: "application/json" })
    if (resolvedApiKey) headers.set("authorization", `Bearer ${resolvedApiKey}`)

    try {
      const response = await fetcher(url, {
        headers,
        signal: AbortSignal.timeout(config.timeoutMs),
      })
      if (!response.ok) return

      const payload = await response.json() as { data?: unknown }
      if (!Array.isArray(payload?.data)) return

      const models = new Map<string, DiscoveredV2Model>()
      for (const entry of payload.data) {
        if (!entry || typeof entry !== "object" || typeof (entry as { id?: unknown }).id !== "string") continue
        const candidate = entry as OpenAIModel
        if (!included(candidate, config)) continue
        models.set(candidate.id, modelToCatalog(candidate, config))
      }

      inventory.set(provider.id, models)
    } catch {
      // Network and parsing failures are non-fatal; existing discovered models remain untouched.
    }
  }))

  return inventory
}
