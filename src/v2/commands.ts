import { formatRefreshFailure, formatRefreshResult, type RefreshResult } from "./tools.js"

export interface DiscoveryCommandsContext {
  readonly command: {
    transform(callback: (commands: { add(command: {
      name: string
      description: string
      execute(input: { sessionID: string; prompt?: { text?: string } | string }): Promise<void>
    }): void }) => void): Promise<unknown>
    reload(): Promise<void>
  }
  readonly session: {
    synthetic(input: { sessionID: string; text: string }): Promise<unknown>
  }
}

export async function registerRefreshCommand(
  ctx: DiscoveryCommandsContext,
  refresh: (force?: boolean) => Promise<RefreshResult>,
): Promise<void> {
  await ctx.command.transform((commands) => {
    commands.add({
      name: "models-discovery-refresh",
      description: "Refresh models discovered from configured providers (optional: force).",
      execute: async (input) => {
        const promptRaw = typeof input.prompt === "string" ? input.prompt : (input.prompt?.text ?? "")
        const force = promptRaw.toLowerCase().includes("force")
        const text = await refresh(force).then(formatRefreshResult, formatRefreshFailure)
        await ctx.session.synthetic({ sessionID: input.sessionID, text })
      },
    })
  })
  await ctx.command.reload()
}
