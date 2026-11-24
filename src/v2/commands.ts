import { formatRefreshFailure, formatRefreshResult, type RefreshResult } from "./tools.js"
import type { DiscoveryStatusInput } from "./tools.js"
import type { RpcCacheClearOutput, RpcCacheInspectOutput } from "./rpc.js"

export interface DiscoveryCommandsContext {
  readonly command?: {
    transform(callback: (commands: {
      add(command: {
        name: string
        description?: string
        execute(input: {
          sessionID: string
          prompt?: unknown
          delivery?: unknown
        }): Promise<void>
      }): void
    }) => void): Promise<unknown>
    reload?(): Promise<void>
  }
  readonly session?: {
    synthetic(input: {
      sessionID: string
      text: string
      resume?: boolean
    }): Promise<unknown>
  }
}

export interface DiscoveryCommandsOps {
  readonly refresh: (force?: boolean) => Promise<RefreshResult>
  readonly status: (options?: DiscoveryStatusInput) => Promise<string>
  readonly cacheInspect?: (providerID?: string) => Promise<RpcCacheInspectOutput>
  readonly cacheClear?: (providerID?: string) => Promise<RpcCacheClearOutput>
}

function extractPromptText(prompt: unknown): string {
  if (typeof prompt === "string") return prompt
  if (prompt && typeof prompt === "object") {
    if ("text" in prompt && typeof (prompt as { text: unknown }).text === "string") {
      return (prompt as { text: string }).text
    }
  }
  return ""
}

async function sendSessionFeedback(
  ctx: DiscoveryCommandsContext,
  sessionID: string | undefined,
  text: string,
): Promise<void> {
  if (!sessionID || !ctx.session?.synthetic) return
  try {
    await ctx.session.synthetic({
      sessionID,
      text,
      resume: false,
    })
  } catch {
    // Non-fatal if session feedback fails
  }
}

export async function registerDiscoveryCommands(
  ctx: DiscoveryCommandsContext,
  ops: DiscoveryCommandsOps,
): Promise<void> {
  if (!ctx.command || typeof ctx.command.transform !== "function") return

  await ctx.command.transform((commands) => {
    commands.add({
      name: "models-discovery-refresh",
      description: "Refresh models discovered from configured providers (optional: --force).",
      execute: async (input) => {
        const raw = extractPromptText(input.prompt).trim().toLowerCase()
        const force = raw.includes("force")
        try {
          const result = await ops.refresh(force)
          const text = formatRefreshResult(result)
          await sendSessionFeedback(ctx, input.sessionID, text)
        } catch (error) {
          const text = formatRefreshFailure(error)
          await sendSessionFeedback(ctx, input.sessionID, text)
        }
      },
    })

    commands.add({
      name: "models-discovery-console",
      description: "Show model discovery status, models, and cache (optional: status, cache, --provider <id>, --raw-cache).",
      execute: async (input) => {
        const raw = extractPromptText(input.prompt).trim()
        const lower = raw.toLowerCase()

        const isCacheAction = /(?:^|\s)cache(?:\s|$)/i.test(raw)

        if (isCacheAction) {
          if (lower.includes("clear-all") || (lower.includes("clear") && lower.includes("all"))) {
            if (!ops.cacheClear) {
              await sendSessionFeedback(ctx, input.sessionID, "Cache operations are not supported in this runtime.")
              return
            }
            const result = await ops.cacheClear()
            await sendSessionFeedback(ctx, input.sessionID, `Cleared all discovery caches (${result.cleared} providers cleared).`)
            return
          }

          if (lower.includes("clear")) {
            if (!ops.cacheClear) {
              await sendSessionFeedback(ctx, input.sessionID, "Cache operations are not supported in this runtime.")
              return
            }
            const providerMatch = raw.match(/(?:--provider(?:-id)?|provider(?:-id)?|clear)\s+([^\s]+)/i)
            const targetProvider = providerMatch?.[1] && !["all", "clear", "clear-all"].includes(providerMatch[1].toLowerCase())
              ? providerMatch[1]
              : undefined
            if (targetProvider) {
              await ops.cacheClear(targetProvider)
              await sendSessionFeedback(ctx, input.sessionID, `Cleared discovery cache for provider "${targetProvider}".`)
              return
            }
          }

          if (!ops.cacheInspect) {
            await sendSessionFeedback(ctx, input.sessionID, "Cache inspection is not supported in this runtime.")
            return
          }
          const providerMatch = raw.match(/(?:--provider(?:-id)?|provider(?:-id)?)\s+([^\s]+)/i)
          const providerID = providerMatch?.[1]
          const inspect = await ops.cacheInspect(providerID)
          if (inspect.entries.length === 0) {
            await sendSessionFeedback(ctx, input.sessionID, "No configured discovery providers found.")
            return
          }
          const lines = ["### Discovery Cache Status:"]
          for (const entry of inspect.entries) {
            const fetched = entry.fetchedAt ? `, fetched at ${entry.fetchedAt}` : ""
            const models = entry.modelCount !== undefined ? `, ${entry.modelCount} models` : ""
            const ttl = entry.ttlSeconds ? `, TTL: ${entry.ttlSeconds}s` : ""
            lines.push(`- \`${entry.providerID}\`: ${entry.status}${ttl}${models}${fetched}`)
          }
          await sendSessionFeedback(ctx, input.sessionID, lines.join("\n"))
          return
        }

        const providerMatch = raw.match(/(?:--provider(?:-id)?|provider(?:-id)?)\s+([^\s]+)/i)
        const providerID = providerMatch?.[1]
        const rawCache = lower.includes("raw-cache") || lower.includes("rawcache")
        const details = true

        try {
          const report = await ops.status({ providerID, details, rawCache })
          await sendSessionFeedback(ctx, input.sessionID, report)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          await sendSessionFeedback(ctx, input.sessionID, `Failed to retrieve discovery status: ${message}`)
        }
      },
    })
  })

  if (typeof ctx.command.reload === "function") {
    try {
      await ctx.command.reload()
    } catch {
      // Non-fatal if command reload is unsupported
    }
  }
}
