import { describe, expect, it } from "vitest"
import { formatStatusReport, registerDiscoveryTools, type DiscoveryStatusProviderReport } from "../../src/v2/tools.js"

describe("V2 discovery tools", () => {
  it("registers status and refresh tools with model-visible results", async () => {
    const tools: Array<{ name: string; execute: (input: unknown) => Promise<{ content: string }> }> = []
    await registerDiscoveryTools({
      tool: {
        transform: async (callback) => {
          callback({ add: (tool) => tools.push(tool) })
          return { dispose: async () => {} }
        },
      },
    }, async () => ({ providers: 1, models: 2 }), () => ({ providers: 1, models: 2 }))

    expect(tools.map((tool) => tool.name)).toEqual(["models_discovery_refresh", "models_discovery_status"])
    await expect(tools[0]?.execute({})).resolves.toEqual({ content: "Model discovery refreshed: discovered 2 models from 1 providers." })
    await expect(tools[1]?.execute({})).resolves.toEqual({ content: "Current discovery inventory has 2 models from 1 providers." })
  })

  it("formats detailed status report with model limits, capabilities, and storage cache", () => {
    const reports: DiscoveryStatusProviderReport[] = [
      {
        id: "local",
        name: "Local Gateway",
        enabled: true,
        cacheConfig: { enabled: true, ttlSeconds: 3600 },
        storageCache: {
          exists: true,
          fresh: true,
          fetchedAt: "2026-10-09T08:00:00.000Z",
          rawModelCount: 1,
          rawModels: [{ id: "qwen-3", object: "model" }],
          enrichments: { "qwen-3": { limit: { context: 32768, output: 8192 } } },
        },
        models: [
          {
            id: "local/qwen-3",
            modelID: "qwen-3",
            name: "Qwen 3",
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 32768, output: 8192 },
            reasoning: true,
          },
        ],
      },
    ]

    const overview = formatStatusReport(reports)
    expect(overview).toContain("Current discovery inventory has 1 models from 1 providers.")
    expect(overview).toContain("### Provider: `local` (Local Gateway)")
    expect(overview).toContain("Cache: enabled (TTL: 3600s) | Storage: fresh (fetched at 2026-10-09T08:00:00.000Z, 1 raw models)")
    expect(overview).not.toContain("context limit: 32,768")

    const detailed = formatStatusReport(reports, { details: true })
    expect(detailed).toContain("`local/qwen-3` (Qwen 3): context limit: 32,768, output limit: 8,192 (tools: yes, reasoning: yes)")

    const rawCached = formatStatusReport(reports, { rawCache: true })
    expect(rawCached).toContain("Storage Raw Cache:")
    expect(rawCached).toContain('"rawModels"')
    expect(rawCached).toContain('"qwen-3"')
  })
})
