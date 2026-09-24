import { Plugin } from "@opencode/plugin"
import { createProviderController, type ConfiguredProvider } from "./catalog.js"
import { discoverInventory, type CatalogProvider } from "./discovery.js"
import { parseProviderDiscoveryOptions, type ProviderDiscoveryOptions } from "./provider-config.js"
import { registerDiscoveryTools } from "./tools.js"

const integrationPrefix = "opencode.models-discovery"

export function integrationID(providerID: string): string {
  return `${integrationPrefix}.${providerID}`
}

interface ListedProvider {
  readonly id?: unknown
  readonly name?: unknown
  readonly package?: unknown
  readonly settings?: unknown
}

function providerList(value: unknown): ListedProvider[] {
  const entries = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
      ? (value as { data: unknown[] }).data
      : []
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const record = entry as { provider?: unknown }
    const provider = record.provider && typeof record.provider === "object" ? record.provider : entry
    return [provider as ListedProvider]
  })
}

async function configuredProviders(ctx: Plugin.Context): Promise<{
  providers: ConfiguredProvider[]
  discovery: Map<string, ProviderDiscoveryOptions>
}> {
  const fromList = (listed: ListedProvider[]) => {
    const providers: ConfiguredProvider[] = []
    const discovery = new Map<string, ProviderDiscoveryOptions>()
    for (const entry of listed) {
      if (typeof entry.id !== "string" || typeof entry.package !== "string") continue
      if (!entry.settings || typeof entry.settings !== "object" || Array.isArray(entry.settings)) continue
      const settings = entry.settings as Record<string, unknown>
      const parsed = parseProviderDiscoveryOptions(settings.modelsDiscovery)
      if (!parsed) continue
      providers.push({
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : undefined,
        package: entry.package,
        settings,
      })
      discovery.set(entry.id, parsed)
    }
    return { providers, discovery }
  }

  try {
    let configured = fromList(providerList(await ctx.provider.list()))
    if (configured.providers.length === 0) {
      await ctx.provider.reload()
      configured = fromList(providerList(await ctx.provider.list()))
    }
    if (configured.providers.length > 0) return configured
  } catch {
    // Provider listing is unavailable; discovery remains inactive for this setup.
  }

  return { providers: [], discovery: new Map() }
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

export async function setupV2(ctx: Plugin.Context): Promise<() => void> {
  const providers: ConfiguredProvider[] = []
  const discovery = new Map<string, ProviderDiscoveryOptions>()
  const controller = createProviderController(ctx, providers, integrationID)

  const syncConfiguredProviders = async (): Promise<boolean> => {
    const configured = await configuredProviders(ctx)
    if (configured.providers.length === 0) return false
    providers.splice(0, providers.length, ...configured.providers)
    discovery.clear()
    for (const [id, options] of configured.discovery) discovery.set(id, options)
    const integrations = providers.map((provider) => ({ id: integrationID(provider.id), name: provider.name ?? provider.id }))

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
    return true
  }

  await syncConfiguredProviders()

  let refreshChain = Promise.resolve()
  const refresh = () => {
    const run = refreshChain.then(async () => {
      const integrations = providers.map((provider) => integrationID(provider.id))
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
  if (providers.length === 0) {
    void (async () => {
      for (let attempt = 0; attempt < 10 && !abort.signal.aborted; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (await syncConfiguredProviders()) {
          await refresh()
          break
        }
      }
    })()
  }
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
}

export default Plugin.define({
  id: "opencode.models-discovery",
  setup: setupV2,
})

export { createProviderController, type DiscoveredV2Model, type Inventory } from "./catalog.js"
