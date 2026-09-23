import { Plugin } from "@opencode/plugin"
import { createProviderController, type ConfiguredProvider } from "./catalog.js"
import { discoverInventory, type CatalogProvider } from "./discovery.js"
import { parseProviderDiscoveryOptions, type ProviderDiscoveryOptions } from "./provider-config.js"
import { registerDiscoveryTools } from "./tools.js"

const integrationPrefix = "opencode.models-discovery"

export function integrationID(providerID: string): string {
  return `${integrationPrefix}.${providerID}`
}

interface ProviderOption extends ConfiguredProvider {
  readonly enabled?: unknown
  readonly endpoint?: unknown
  readonly models?: unknown
  readonly discovery?: unknown
  readonly modelsDiscovery?: unknown
}

function configuredProviders(options: unknown): {
  providers: ConfiguredProvider[]
  discovery: Map<string, ProviderDiscoveryOptions>
} {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return { providers: [], discovery: new Map() }
  }

  const raw = (options as { providers?: unknown }).providers
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { providers: [], discovery: new Map() }
  }

  const providers: ConfiguredProvider[] = []
  const discovery = new Map<string, ProviderDiscoveryOptions>()
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    const option = value as Partial<ProviderOption> & { options?: Record<string, unknown>; settings?: Record<string, unknown>; npm?: string }
    const settings = option.settings ?? option.options
    const packageName = option.package ?? option.npm
    if (typeof packageName !== "string" || !settings || typeof settings !== "object") continue
    const discoveryConfig = option.modelsDiscovery
      ?? option.discovery
      ?? (option.enabled !== undefined || option.endpoint !== undefined || option.models !== undefined ? option : settings.modelsDiscovery)
    const parsed = parseProviderDiscoveryOptions(discoveryConfig)
    if (!parsed) continue
    providers.push({ id, name: option.name, package: packageName, settings })
    discovery.set(id, parsed)
  }
  return { providers, discovery }
}

async function resolveProviderCredentials(ctx: Plugin.Context, providers: readonly CatalogProvider[]): Promise<CatalogProvider[]> {
  return Promise.all(providers.map(async (provider) => {
    try {
      const connection = await ctx.integration.connection.active(integrationID(provider.id))
      const credential = connection ? await ctx.integration.connection.resolve(connection) : undefined
      if (credential?.type === "key") return { ...provider, apiKey: credential.key }
    } catch {
      // A missing managed credential must not block other providers.
    }
    return provider
  }))
}

export default Plugin.define({
  id: "opencode.models-discovery",
  setup: async (ctx) => {
    const { providers, discovery } = configuredProviders(ctx.options)
    const integrations = providers.map((provider) => ({ id: integrationID(provider.id), name: provider.name ?? provider.id }))
    const controller = createProviderController(ctx, providers, integrationID)

    await ctx.integration.transform((draft) => {
      for (const integration of integrations) {
        draft.update(integration.id, (current) => {
          current.id = integration.id
          current.name = integration.name
        })
        draft.method.update({
          integrationID: integration.id,
          method: { type: "key", label: "API key" },
        })
      }
    })
    await ctx.provider.transform(controller.transform)

    let refreshChain = Promise.resolve()
    const refresh = () => {
      const run = refreshChain.then(async () => {
        if (integrations.length > 0) await ctx.integration.reload()
        const resolved = await resolveProviderCredentials(ctx, providers)
        const inventory = await discoverInventory(resolved, discovery)
        await controller.replaceInventory(inventory)
        return controller.status()
      })
      refreshChain = run.then(() => undefined, () => undefined)
      return run
    }

    await registerDiscoveryTools(ctx, refresh, controller.status)
    await refresh()

    const abort = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: abort.signal })) {
          if (event.type === "config.updated") await refresh()
        }
      } catch {
        // Event streaming is advisory; manual refresh remains available.
      }
    })()

    return () => abort.abort()
  },
})

export { createProviderController, type DiscoveredV2Model, type Inventory } from "./catalog.js"
