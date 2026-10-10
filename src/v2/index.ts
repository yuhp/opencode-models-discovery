import { Plugin } from "@opencode/plugin"
import { createProviderController, type ConfiguredProvider } from "./catalog.js"
import { discoverInventory, type CatalogProvider } from "./discovery.js"
import { parseProviderDiscoveryOptions, type ProviderDiscoveryOptions } from "./provider-config.js"
import { registerDiscoveryTools, type DiscoveryStatusInput, type DiscoveryStatusProviderReport, formatStatusReport } from "./tools.js"
import type { RefreshResult } from "./tools.js"
import { createV2StorageCache } from "./storage-cache.js"
import { discoveryCacheKey, isDiscoveryCacheFresh } from "../core/discovery-cache.js"
import { resolveProviderCredential } from "./credential-resolver.js"
import { DiscoveryRpcDefinition, type RpcCacheEntry } from "./rpc.js"

export function integrationID(providerID: string): string {
  return providerID
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

  const listInput = ctx.location ? { location: ctx.location } : undefined
  try {
    let configured = fromList(providerList(await ctx.provider.list(listInput as never)))
    if (configured.providers.length === 0) {
      await ctx.provider.reload()
      configured = fromList(providerList(await ctx.provider.list(listInput as never)))
    }
    if (configured.providers.length > 0) return configured
  } catch {
    // Provider listing is unavailable; discovery remains inactive for this setup.
  }

  return { providers: [], discovery: new Map() }
}

async function resolveProviderCredentials(ctx: Plugin.Context, providers: readonly CatalogProvider[]): Promise<CatalogProvider[]> {
  return Promise.all(providers.map(async (provider) => {
    const apiKey = await resolveProviderCredential(ctx, provider, integrationID)
    return { ...provider, apiKey }
  }))
}

export async function setupV2(ctx: Plugin.Context): Promise<() => void> {
  const providers: ConfiguredProvider[] = []
  const discovery = new Map<string, ProviderDiscoveryOptions>()
  const controller = createProviderController(ctx, providers, integrationID)
  let transformsRegistration: Promise<void> | undefined

  const ensureTransformsRegistered = async (): Promise<void> => {
    if (!transformsRegistration) {
      transformsRegistration = Promise.all([
        ctx.integration.transform((draft) => {
          for (const provider of providers) {
            const id = (provider.settings.integrationID as string | undefined) ?? integrationID(provider.id)
            if (!draft.get(id)) {
              draft.update(id, (current) => {
                current.id = id
                current.name = provider.name ?? provider.id
              })
            }
            draft.method.update({
              integrationID: id,
              method: { type: "key", label: "API key" },
            })
          }
        }),
        ctx.provider.transform(controller.transform),
      ]).then(async () => {
        try {
          await ctx.integration.reload()
        } catch {
          // Non-fatal if integration reload is unsupported
        }
      })
    }
    await transformsRegistration
  }

  const syncConfiguredProviders = async (): Promise<boolean> => {
    const configured = await configuredProviders(ctx)
    providers.splice(0, providers.length, ...configured.providers)
    discovery.clear()
    for (const [id, options] of configured.discovery) discovery.set(id, options)

    await ensureTransformsRegistered()
    return configured.providers.length > 0
  }

  const refreshInventoryInternal = async (force?: boolean): Promise<RefreshResult> => {
    const resolved = await resolveProviderCredentials(ctx, providers)
    providers.splice(0, providers.length, ...resolved)
    const inventory = await discoverInventory(
      resolved,
      discovery,
      fetch,
      ctx.storage ? createV2StorageCache(ctx.storage) : undefined,
      { force }
    )
    await controller.replaceInventory(inventory)
    return controller.status()
  }

  let activeRefresh: Promise<RefreshResult> | undefined
  let pendingRefreshForce = false

  const refreshFromCurrentConfig = (force?: boolean): Promise<RefreshResult> => {
    if (force) pendingRefreshForce = true
    if (activeRefresh) {
      return activeRefresh.then(() => refreshFromCurrentConfig(pendingRefreshForce))
    }
    const runForce = force || pendingRefreshForce
    pendingRefreshForce = false
    activeRefresh = (async () => {
      try {
        await ctx.provider.reload()
        await syncConfiguredProviders()
        return await refreshInventoryInternal(runForce)
      } finally {
        activeRefresh = undefined
      }
    })()
    return activeRefresh
  }

  const inspectStatus = async (options?: DiscoveryStatusInput): Promise<string> => {
    const inventory = controller.getInventory()
    const reports: DiscoveryStatusProviderReport[] = []
    const storageBackend = ctx.storage ? createV2StorageCache(ctx.storage) : undefined

    for (const provider of providers) {
      const providerDiscoveryOptions = discovery.get(provider.id)
      const modelsMap = inventory.get(provider.id)
      const models = modelsMap ? [...modelsMap.values()] : []
      const cacheConfig = providerDiscoveryOptions?.cache

      let storageCacheInfo: DiscoveryStatusProviderReport["storageCache"] | undefined
      if (storageBackend) {
        const cacheKey = discoveryCacheKey("opencode.models-discovery.v2", provider.id)
        try {
          const raw = await storageBackend.get(cacheKey)
          const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined
          if (entry && entry.version === 1) {
            const fetchedAt = typeof entry.fetchedAt === "string" ? entry.fetchedAt : undefined
            const ttl = cacheConfig?.ttlSeconds ?? 86400
            const fresh = fetchedAt ? isDiscoveryCacheFresh(fetchedAt, ttl) : false
            const rawModels = Array.isArray(entry.rawModels) ? (entry.rawModels as readonly Record<string, unknown>[]) : []
            const enrichments = entry.enrichments && typeof entry.enrichments === "object" ? (entry.enrichments as Record<string, unknown>) : {}

            storageCacheInfo = {
              exists: true,
              fresh,
              fetchedAt,
              rawModelCount: rawModels.length,
              rawModels: options?.rawCache ? rawModels : undefined,
              enrichments: options?.rawCache ? enrichments : undefined,
            }
          } else {
            storageCacheInfo = { exists: false, fresh: false }
          }
        } catch {
          storageCacheInfo = { exists: false, fresh: false }
        }
      }

      reports.push({
        id: provider.id,
        name: provider.name,
        enabled: providerDiscoveryOptions?.enabled ?? false,
        cacheConfig,
        storageCache: storageCacheInfo,
        models,
      })
    }

    return formatStatusReport(reports, options)
  }

  await ensureTransformsRegistered()
  await registerDiscoveryTools(ctx, refreshFromCurrentConfig, inspectStatus)

  if (ctx.rpc && typeof ctx.rpc.register === "function") {
    await ctx.rpc.register(DiscoveryRpcDefinition, {
      refresh: async (rawInput) => {
        const input = rawInput as { readonly force?: boolean } | undefined
        const result = await refreshFromCurrentConfig(input?.force === true)
        return { providers: result.providers, models: result.models }
      },
      cacheInspect: async (rawInput) => {
        const input = rawInput as { readonly providerID?: string } | undefined
        await syncConfiguredProviders()
        const storageBackend = ctx.storage ? createV2StorageCache(ctx.storage) : undefined
        const targetProviders = input?.providerID
          ? providers.filter((p) => p.id === input.providerID)
          : providers
        const entries: RpcCacheEntry[] = []

        if (input?.providerID && targetProviders.length === 0) {
          if (storageBackend) {
            const cacheKey = discoveryCacheKey("opencode.models-discovery.v2", input.providerID)
            try {
              const raw = await storageBackend.get(cacheKey)
              const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined
              if (entry && entry.version === 1) {
                const fetchedAt = typeof entry.fetchedAt === "string" ? entry.fetchedAt : undefined
                const rawModels = Array.isArray(entry.rawModels) ? entry.rawModels : []
                entries.push({
                  providerID: input.providerID,
                  status: fetchedAt ? (isDiscoveryCacheFresh(fetchedAt, 86400) ? "fresh" : "expired") : "expired",
                  fetchedAt,
                  ttlSeconds: 86400,
                  modelCount: rawModels.length,
                })
              } else {
                entries.push({ providerID: input.providerID, status: entry ? "corrupt" : "empty" })
              }
            } catch {
              entries.push({ providerID: input.providerID, status: "corrupt" })
            }
          } else {
            entries.push({ providerID: input.providerID, status: "empty" })
          }
          return { entries }
        }

        for (const provider of targetProviders) {
          const providerDiscoveryOptions = discovery.get(provider.id)
          const cacheConfig = providerDiscoveryOptions?.cache
          if (!storageBackend || !cacheConfig?.enabled) {
            entries.push({ providerID: provider.id, status: "empty" })
            continue
          }
          const cacheKey = discoveryCacheKey("opencode.models-discovery.v2", provider.id)
          try {
            const raw = await storageBackend.get(cacheKey)
            const entry = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined
            if (entry && entry.version === 1) {
              const fetchedAt = typeof entry.fetchedAt === "string" ? entry.fetchedAt : undefined
              const ttl = cacheConfig.ttlSeconds ?? 86400
              const fresh = fetchedAt ? isDiscoveryCacheFresh(fetchedAt, ttl) : false
              const rawModels = Array.isArray(entry.rawModels) ? entry.rawModels : []
              entries.push({
                providerID: provider.id,
                status: fresh ? "fresh" : "expired",
                fetchedAt,
                ttlSeconds: ttl,
                modelCount: rawModels.length,
              })
            } else {
              entries.push({ providerID: provider.id, status: entry ? "corrupt" : "empty" })
            }
          } catch {
            entries.push({ providerID: provider.id, status: "corrupt" })
          }
        }
        return { entries }
      },
      cacheClear: async (rawInput) => {
        const input = rawInput as { readonly providerID?: string } | undefined
        const storageBackend = ctx.storage ? createV2StorageCache(ctx.storage) : undefined
        if (!storageBackend?.remove) return { cleared: 0 }

        await syncConfiguredProviders()
        let clearedCount = 0
        const targetIDs = input?.providerID
          ? [input.providerID]
          : providers.map((p) => p.id)

        for (const providerID of targetIDs) {
          const cacheKey = discoveryCacheKey("opencode.models-discovery.v2", providerID)
          try {
            await storageBackend.remove(cacheKey)
            clearedCount++
          } catch {
            // Ignore individual delete errors
          }
        }
        return { cleared: clearedCount }
      },
      overrideList: async (_input) => {
        return { overrides: [] }
      },
      overrideSet: async (_input) => {
        return { success: true }
      },
      overrideDelete: async (_input) => {
        return { success: true }
      },
    })
  }

  await refreshFromCurrentConfig()

  const abort = new AbortController()
  if (providers.length === 0) {
    void (async () => {
      for (let attempt = 0; attempt < 10 && !abort.signal.aborted; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        const result = await refreshFromCurrentConfig()
        if (result.providers > 0) {
          break
        }
      }
    })()
  }
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({signal: abort.signal})) {
        if (
          event.type === "config.updated" ||
          event.type === "credential.updated" ||
          event.type === "credential.switched" ||
          event.type === "integration.updated"
        ) {
          try {
            // Configuration and credential updates are delivered independently from the provider
            // registry. Reload the registry first so provider.list() observes the
            // new state before rebuilding the discovery inventory.
            await refreshFromCurrentConfig()
          } catch {
            if (!abort.signal.aborted) {
              // should not happen, but if it does, we don't want to crash the plugin
            }
          }
        }
      }
    } catch {
      if (!abort.signal.aborted) {
        // should not happen, but if it does, we don't want to crash the plugin
      }
    }
})()

  return () => abort.abort()
}

export default Plugin.define({
  id: "opencode.models-discovery",
  setup: setupV2,
})

export { createProviderController, type DiscoveredV2Model, type Inventory } from "./catalog.js"
