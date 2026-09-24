export interface RefreshResult {
  readonly providers: number
  readonly models: number
}

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

const noInput = {
  type: "object",
  properties: {},
  additionalProperties: false,
}

export async function registerDiscoveryTools(
  ctx: DiscoveryToolsContext,
  refresh: () => Promise<RefreshResult>,
  status: () => RefreshResult,
): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: "models_discovery_refresh",
      description: "Refresh models discovered from configured OpenAI-compatible providers.",
      input: noInput,
      execute: async () => {
        const result = await refresh()
        return { content: `Discovered ${result.models} models from ${result.providers} providers.` }
      },
    })
    tools.add({
      name: "models_discovery_status",
      description: "Show the current OpenAI-compatible model discovery inventory.",
      input: noInput,
      execute: async () => {
        const result = status()
        return { content: `Current discovery inventory has ${result.models} models from ${result.providers} providers.` }
      },
    })
  })
}
