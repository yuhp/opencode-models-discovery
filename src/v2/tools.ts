import type { DiscoveredV2Model } from "./catalog.js"

export interface RefreshResult {
  readonly providers: number
  readonly models: number
}

export function formatRefreshResult(result: RefreshResult): string {
  return `Model discovery refreshed: discovered ${result.models} models from ${result.providers} providers.`
}

export function formatRefreshFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error))
  return `Model discovery refresh failed: ${message}`
}

export interface DiscoveryStatusInput {
  readonly providerID?: string
  readonly details?: boolean
  readonly rawCache?: boolean
}

export interface DiscoveryStatusProviderReport {
  readonly id: string
  readonly name?: string
  readonly enabled: boolean
  readonly cacheConfig?: { readonly enabled: boolean; readonly ttlSeconds: number }
  readonly storageCache?: {
    readonly exists: boolean
    readonly fresh: boolean
    readonly fetchedAt?: string
    readonly rawModelCount?: number
    readonly rawModels?: readonly Record<string, unknown>[]
    readonly enrichments?: Record<string, unknown>
  }
  readonly models: readonly DiscoveredV2Model[]
}

export function formatStatusReport(
  providers: readonly DiscoveryStatusProviderReport[],
  options?: DiscoveryStatusInput,
): string {
  const filtered = options?.providerID
    ? providers.filter((p) => p.id === options.providerID)
    : providers

  const totalModels = filtered.reduce((sum, p) => sum + p.models.length, 0)
  const totalProviders = filtered.length

  const lines: string[] = [
    `Current discovery inventory has ${totalModels} models from ${totalProviders} providers.`,
  ]

  if (filtered.length === 0) {
    if (options?.providerID) {
      lines.push(`\nProvider "${options.providerID}" not found in discovered inventory.`)
    }
    return lines.join("\n")
  }

  for (const provider of filtered) {
    lines.push(`\n### Provider: \`${provider.id}\`${provider.name ? ` (${provider.name})` : ""}`)
    lines.push(`- Discovery: ${provider.enabled ? "enabled" : "disabled"}`)

    if (provider.cacheConfig?.enabled) {
      const cacheStatus = provider.storageCache?.exists
        ? `${provider.storageCache.fresh ? "fresh" : "expired"} (fetched at ${provider.storageCache.fetchedAt ?? "unknown"}, ${provider.storageCache.rawModelCount ?? 0} raw models)`
        : "no storage cache entry"
      lines.push(`- Cache: enabled (TTL: ${provider.cacheConfig.ttlSeconds}s) | Storage: ${cacheStatus}`)
    } else {
      lines.push(`- Cache: disabled`)
    }

    lines.push(`- Discovered models count: ${provider.models.length}`)

    const showDetails = options?.details === true || Boolean(options?.providerID)
    if (showDetails && provider.models.length > 0) {
      lines.push(`\n  Models:`)
      for (const model of provider.models) {
        const contextStr = model.limit?.context ? model.limit.context.toLocaleString() : "unknown"
        const outputStr = model.limit?.output ? model.limit.output.toLocaleString() : "unknown"
        const toolsStr = model.capabilities?.tools ? "tools: yes" : "tools: no"
        const reasoningStr = model.reasoning ? ", reasoning: yes" : ""
        lines.push(`  - \`${model.id}\` (${model.name}): context limit: ${contextStr}, output limit: ${outputStr} (${toolsStr}${reasoningStr})`)
      }
    }

    if (options?.rawCache === true && provider.storageCache?.exists) {
      lines.push(`\n  Storage Raw Cache:`)
      const rawPayload = {
        fetchedAt: provider.storageCache.fetchedAt,
        fresh: provider.storageCache.fresh,
        rawModels: provider.storageCache.rawModels,
        enrichments: provider.storageCache.enrichments,
      }
      lines.push("```json")
      lines.push(JSON.stringify(rawPayload, null, 2))
      lines.push("```")
    }
  }

  return lines.join("\n")
}

export type DiscoveryStatusReporter = (input?: DiscoveryStatusInput) => Promise<string | RefreshResult> | string | RefreshResult

export interface DiscoveryToolsContext {
  readonly tool: {
    transform(callback: (tools: { add(tool: {
      name: string
      description: string
      input: Record<string, unknown>
      execute(input: unknown): Promise<{ content: string }>
    }): void }) => void): Promise<unknown>
  }
}

const statusInputSchema = {
  type: "object",
  properties: {
    providerID: {
      type: "string",
      description: "Optional provider ID to inspect a specific provider.",
    },
    details: {
      type: "boolean",
      description: "Whether to list discovered models with their limits (context, output) and capabilities.",
    },
    rawCache: {
      type: "boolean",
      description: "Whether to inspect raw cached models and enrichments from storage.",
    },
  },
  additionalProperties: false,
}

const noInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
}

export async function registerDiscoveryTools(
  ctx: DiscoveryToolsContext,
  refresh: () => Promise<RefreshResult>,
  status: DiscoveryStatusReporter,
): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "models_discovery_refresh",
      description: "Refresh models discovered from configured OpenAI-compatible providers.",
      input: noInput,
      execute: async () => {
        try {
          const result = await refresh()
          return { content: formatRefreshResult(result) }
        } catch (error) {
          return { content: formatRefreshFailure(error) }
        }
      },
    })
    tools.add({
      name: "models_discovery_status",
      description: "Show the current OpenAI-compatible model discovery inventory, with options to inspect limits and storage cache.",
      input: statusInputSchema,
      execute: async (input) => {
        const typedInput = input && typeof input === "object" ? (input as DiscoveryStatusInput) : undefined
        const result = await status(typedInput)
        if (typeof result === "string") {
          return { content: result }
        }
        return { content: `Current discovery inventory has ${result.models} models from ${result.providers} providers.` }
      },
    })
  })
}
