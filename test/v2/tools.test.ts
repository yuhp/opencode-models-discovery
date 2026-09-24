import { describe, expect, it } from "vitest"
import { registerDiscoveryTools } from "../../src/v2/tools.js"

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
    await expect(tools[0]?.execute({})).resolves.toEqual({ content: "Discovered 2 models from 1 providers." })
    await expect(tools[1]?.execute({})).resolves.toEqual({ content: "Current discovery inventory has 2 models from 1 providers." })
  })
})
