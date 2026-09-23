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
  options: ReadonlyMap<string, ProviderDiscoveryOptions>,
  fetcher: typeof fetch = fetch,
): Promise<Inventory> {
  const inventory: Inventory = new Map()

  for (const provider of providers) {
    const config = options.get(provider.id)
    const baseURL = provider.settings?.baseURL
    if (!config?.enabled || !isOpenAICompatible(provider) || typeof baseURL !== "string") continue

    let url: string
    try {
      url = new URL(config.endpoint, new URL(baseURL).origin).toString()
    } catch {
      continue
    }

    try {
      const apiKey = provider.apiKey ?? provider.settings?.apiKey
      const response = await fetcher(url, {
        headers: {
          "Content-Type": "application/json",
          ...(typeof apiKey === "string" && apiKey.length > 0 ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        signal: AbortSignal.timeout(config.timeoutMs),
      })
      if (!response.ok) continue
      const body = await response.json() as { data?: unknown }
      if (!Array.isArray(body.data)) continue

      const models = new Map(body.data.flatMap((value): [string, DiscoveredV2Model][] => {
        if (!value || typeof value !== "object" || typeof (value as OpenAIModel).id !== "string") return []
        const model = value as OpenAIModel
        if (model.id.toLowerCase().includes("embed") || !included(model, config)) return []
        return [[model.id, modelToCatalog(model, config)]]
      }))
      inventory.set(provider.id, models)
    } catch {
      // Provider failures are non-fatal and do not affect other providers.
    }
  }

  return inventory
}
