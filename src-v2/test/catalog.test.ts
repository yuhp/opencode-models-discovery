import { describe, expect, it, vi } from "vitest"
import { createProviderController, type Inventory } from "../catalog.js"

function inventory(modelID = "spike-model"): Inventory {
  return new Map([["local", new Map([[modelID, {
    id: modelID,
    modelID,
    name: "Spike model",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    limit: { context: 32_768, output: 8_192 },
  }]])]])
}

function provider(id = "local") {
  return {
    id,
    package: "@opencode-ai/ai/providers/openai-compatible",
    settings: { baseURL: "http://127.0.0.1:1234/v1" },
  }
}

describe("V2 provider controller", () => {
  it("registers a zero-model provider and replays replacement inventory", async () => {
    const reload = vi.fn().mockResolvedValue(undefined)
    const added: Array<{ info: Record<string, unknown>; models: unknown[] }> = []
    const controller = createProviderController(
      { provider: { reload } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue(undefined),
      add: vi.fn((definition) => added.push(definition)),
      update: vi.fn(),
      models: { set: vi.fn() },
    }

    controller.transform(editor as never)
    expect(added[0]?.models).toEqual([])

    await controller.replaceInventory(inventory())
    await controller.replaceInventory(inventory("replacement-model"))

    expect(reload).toHaveBeenCalledTimes(2)
    expect(controller.status()).toEqual({ providers: 1, models: 1 })
  })

  it("preserves existing source models when adding discovered models", async () => {
    const set = vi.fn()
    const existing = { modelID: "explicit-model" }
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({
        provider: { id: "local" },
        models: new Map([["explicit-model", existing]]),
      }),
      add: vi.fn(),
      update: vi.fn(),
      models: { set },
    }

    await controller.replaceInventory(inventory("discovered-model"))
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [existing, expect.objectContaining({ modelID: "discovered-model" })])
  })

  it("preserves explicit provider settings and disabled activation", async () => {
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({
        provider: {
          id: "local",
          settings: { baseURL: "http://explicit.example/v1", apiKey: "explicit-secret" },
          integrationID: "explicit.integration",
          activation: "disabled",
        },
        models: new Map(),
      }),
      add: vi.fn(),
      update: vi.fn(),
      models: { set: vi.fn() },
    }

    controller.transform(editor as never)

    expect(editor.update).not.toHaveBeenCalled()
    expect(editor.add).not.toHaveBeenCalled()
    expect(editor.models.set).not.toHaveBeenCalled()
  })

  it("deduplicates discovered models by catalog id rather than modelID", async () => {
    const set = vi.fn()
    const controller = createProviderController(
      { provider: { reload: vi.fn() } } as never,
      [provider()],
      (id) => `integration.${id}`,
    )
    const editor = {
      get: vi.fn().mockReturnValue({
        models: new Map([["explicit-key", { id: "same-id", modelID: "explicit-alias" }]]),
      }),
      add: vi.fn(),
      update: vi.fn(),
      models: { set },
    }

    await controller.replaceInventory(inventory("same-id"))
    controller.transform(editor as never)

    expect(set).toHaveBeenCalledWith("local", [{ id: "same-id", modelID: "explicit-alias" }])
  })
})
