import type { Plugin } from "@opencode/plugin/tui"
import {
  DiscoveryRpcDefinition,
  type RpcCacheClearOutput,
  type RpcCacheInspectOutput,
  type RpcRefreshOutput,
  type RpcStatusOutput,
} from "./v2/rpc.js"

export type TuiCleanup = () => Promise<void> | void

export interface TuiPluginDefinition {
  readonly id: string
  readonly setup: (context: Plugin.Context) => Promise<TuiCleanup | void> | TuiCleanup | void
}

export function defineTuiPlugin(plugin: TuiPluginDefinition): TuiPluginDefinition {
  return plugin
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null
      ? (error as { message?: string }).message ?? JSON.stringify(error)
      : String(error)
}

export default defineTuiPlugin({
  id: "opencode.models-discovery",
  setup: async (context) => {
    const rpc = context.client.rpc(DiscoveryRpcDefinition)
    const getLocation = () => context.location ?? context.data?.location?.default()

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "models-discovery.status",
          title: "Models Discovery: Status",
          description: "Inspect resolved providers, models, limits, capabilities, and cache state",
          slash: {
            name: "models-discovery-status",
            arguments: true,
          },
          palette: true,
          run: async (input?: string) => {
            const raw = typeof input === "string" ? input.trim() : ""
            const providerID = raw
              .replace(/^--provider(?:-id)?[= ]/i, "")
              .replace(/^provider(?:-id)?[= ]/i, "")
              .trim()
            const location = getLocation()

            try {
              const result = (await rpc.status(
                { details: true, ...(providerID ? { providerID } : {}) },
                { location },
              )) as RpcStatusOutput
              if (context.ui?.dialog?.alert) {
                await context.ui.dialog.alert({
                  title: providerID ? `Models Discovery: ${providerID}` : "Models Discovery Status",
                  message: result.report,
                })
              } else {
                context.ui.toast.show({
                  title: "Models Discovery Status",
                  message: result.report,
                  variant: "info",
                })
              }
            } catch (error) {
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Status lookup failed: ${formatError(error)}`,
                variant: "error",
              })
            }
          },
        },
        {
          id: "models-discovery.refresh",
          title: "Models Discovery: Refresh",
          description: "Refresh models discovered from configured providers (optional: --force)",
          slash: {
            name: "models-discovery-refresh",
            arguments: true,
          },
          palette: true,
          run: async (input?: string) => {
            const raw = typeof input === "string" ? input.trim().toLowerCase() : ""
            const force = raw.includes("force")
            const location = getLocation()
            try {
              const result = (await rpc.refresh({ force }, { location })) as RpcRefreshOutput
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Discovered ${result.models} models across ${result.providers} providers${force ? " (bypassed cache)" : ""}.`,
                variant: "success",
              })
            } catch (error) {
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Refresh failed: ${formatError(error)}`,
                variant: "error",
              })
            }
          },
        },
        {
          id: "models-discovery.cache",
          title: "Models Discovery: Cache Operations",
          description: "Inspect or clear discovery cache entries",
          slash: {
            name: "models-discovery-cache",
            arguments: true,
          },
          palette: true,
          run: async (input?: string) => {
            const raw = typeof input === "string" ? input.trim().toLowerCase() : ""
            const location = getLocation()

            try {
              let action: string | undefined
              if (raw.includes("inspect") || raw === "status") {
                action = "inspect"
              } else if (raw.includes("refresh") || raw.includes("force")) {
                action = "refresh"
              } else if (raw.includes("clear-all") || (raw.includes("clear") && raw.includes("all"))) {
                action = "clear-all"
              } else if (raw.includes("clear")) {
                action = "clear-one"
              } else if (context.ui?.dialog) {
                action = await context.ui.dialog.select({
                  title: "Models Discovery Cache",
                  placeholder: "Choose a cache action",
                  options: [
                    {
                      title: "Inspect Cache Status",
                      value: "inspect",
                      description: "View status, TTL, and cached models across configured providers",
                    },
                    {
                      title: "Force Refresh (Bypass Cache)",
                      value: "refresh",
                      description: "Trigger discovery refresh immediately and bypass all cached models",
                    },
                    {
                      title: "Clear Provider Cache",
                      value: "clear-one",
                      description: "Select a specific provider and remove its cached discovery records",
                    },
                    {
                      title: "Clear All Discovery Caches",
                      value: "clear-all",
                      description: "Clear discovery caches for all configured providers",
                    },
                  ],
                })
              }

              if (!action) return

              if (action === "inspect") {
                const inspect = (await rpc.cacheInspect({}, { location })) as RpcCacheInspectOutput
                if (inspect.entries.length === 0) {
                  if (context.ui?.dialog?.alert) {
                    await context.ui.dialog.alert({
                      title: "Discovery Cache Status",
                      message: "No configured discovery providers found.",
                    })
                  } else {
                    context.ui.toast.show({
                      title: "Discovery Cache Status",
                      message: "No configured discovery providers found.",
                      variant: "info",
                    })
                  }
                  return
                }

                const summary = inspect.entries
                  .map((entry) => {
                    const parts = [
                      `Provider: ${entry.providerID}`,
                      `Status: ${entry.status}`,
                      entry.modelCount !== undefined ? `Models: ${entry.modelCount}` : undefined,
                      entry.ttlSeconds !== undefined ? `TTL: ${entry.ttlSeconds}s` : undefined,
                      entry.fetchedAt ? `Fetched: ${entry.fetchedAt}` : undefined,
                    ].filter(Boolean)
                    return parts.join(" | ")
                  })
                  .join("\n")

                if (context.ui?.dialog?.alert) {
                  await context.ui.dialog.alert({
                    title: "Discovery Cache Status",
                    message: summary,
                  })
                } else {
                  context.ui.toast.show({
                    title: "Discovery Cache Status",
                    message: summary,
                    variant: "info",
                  })
                }
              } else if (action === "refresh") {
                const result = (await rpc.refresh({ force: true }, { location })) as RpcRefreshOutput
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Discovered ${result.models} models across ${result.providers} providers (bypassed cache).`,
                  variant: "success",
                })
              } else if (action === "clear-one") {
                const inspect = (await rpc.cacheInspect({}, { location })) as RpcCacheInspectOutput
                if (inspect.entries.length === 0) {
                  context.ui.toast.show({
                    title: "Models Discovery",
                    message: "No discovery providers available to clear.",
                    variant: "info",
                  })
                  return
                }

                let selectedProvider: string | undefined
                if (context.ui?.dialog?.select) {
                  selectedProvider = await context.ui.dialog.select({
                    title: "Clear Provider Cache",
                    placeholder: "Select provider to clear",
                    options: inspect.entries.map((e) => ({
                      title: e.providerID,
                      value: e.providerID,
                      description: `Status: ${e.status}${e.modelCount !== undefined ? ` (${e.modelCount} models)` : ""}`,
                    })),
                  })
                } else {
                  selectedProvider = inspect.entries[0]?.providerID
                }

                if (!selectedProvider) return

                if (context.ui?.dialog?.confirm) {
                  const confirmed = await context.ui.dialog.confirm({
                    title: "Clear Provider Cache",
                    message: `Are you sure you want to clear the discovery cache for provider "${selectedProvider}"?`,
                    label: { confirm: "Clear", cancel: "Cancel" },
                  })
                  if (!confirmed) return
                }

                await rpc.cacheClear({ providerID: selectedProvider }, { location })
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Cleared discovery cache for provider "${selectedProvider}".`,
                  variant: "success",
                })
              } else if (action === "clear-all") {
                if (context.ui?.dialog?.confirm) {
                  const confirmed = await context.ui.dialog.confirm({
                    title: "Clear All Discovery Caches",
                    message: "Are you sure you want to clear discovery caches for all configured providers?",
                    label: { confirm: "Clear All", cancel: "Cancel" },
                  })
                  if (!confirmed) return
                }

                const result = (await rpc.cacheClear({}, { location })) as RpcCacheClearOutput
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Cleared all discovery caches (${result.cleared} providers cleared).`,
                  variant: "success",
                })
              }
            } catch (error) {
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Cache operation failed: ${formatError(error)}`,
                variant: "error",
              })
            }
          },
        },
      ],
    }))
  },
})
