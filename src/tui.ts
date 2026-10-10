import type { Plugin } from "@opencode/plugin/tui"
import { DiscoveryRpcDefinition, type RpcRefreshOutput } from "./v2/rpc.js"

export type TuiCleanup = () => Promise<void> | void

export interface TuiPluginDefinition {
  readonly id: string
  readonly setup: (context: Plugin.Context) => Promise<TuiCleanup | void> | TuiCleanup | void
}

export function defineTuiPlugin(plugin: TuiPluginDefinition): TuiPluginDefinition {
  return plugin
}

export default defineTuiPlugin({
  id: "opencode.models-discovery",
  setup: async (context) => {
    const rpc = context.client.rpc(DiscoveryRpcDefinition)

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
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
            const location = context.location ?? context.data?.location?.default()
            try {
              const result = (await rpc.refresh({ force }, { location })) as RpcRefreshOutput
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Discovered ${result.models} models across ${result.providers} providers${force ? " (bypassed cache)" : ""}.`,
                variant: "success",
              })
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : typeof error === "object" && error !== null
                    ? (error as { message?: string }).message ?? JSON.stringify(error)
                    : String(error)
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Refresh failed: ${message}`,
                variant: "error",
              })
            }
          },
        },
      ],
    }))
  },
})
