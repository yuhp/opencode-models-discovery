import type { Plugin } from "@opencode/plugin/tui"

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
  setup: async (_context) => {
    // TUI setup entrypoint
  },
})
