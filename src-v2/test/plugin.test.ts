import { describe, expect, it, vi } from "vitest"
import plugin from "../index.js"

function closedEvents() {
  return { subscribe: vi.fn().mockReturnValue({
    async *[Symbol.asyncIterator]() {},
  }) }
}

function context(overrides: Record<string, unknown> = {}) {
  const providerTransform = vi.fn().mockImplementation(async (callback) => {
    callback({
      get: vi.fn().mockReturnValue(undefined),
      add: vi.fn(),
      update: vi.fn(),
      models: { set: vi.fn() },
    })
  })
  const providerReload = vi.fn().mockResolvedValue(undefined)
  const integrationTransform = vi.fn().mockImplementation(async (callback) => {
    callback({ update: vi.fn(), method: { update: vi.fn() } })
  })
  const integrationReload = vi.fn().mockResolvedValue(undefined)
  const toolTransform = vi.fn().mockImplementation(async (callback) => callback({ add: vi.fn() }))
  return {
    app: { version: "2.0.14" },
    options: {
      providers: {
        local: {
          package: "@opencode-ai/ai/providers/openai-compatible",
          settings: {
            baseURL: "http://127.0.0.1:1234/v1",
            modelsDiscovery: {},
          },
        },
      },
    },
    provider: { transform: providerTransform, reload: providerReload, list: vi.fn().mockResolvedValue({ data: [] }) },
    integration: {
      transform: integrationTransform,
      reload: integrationReload,
      connection: { active: vi.fn().mockResolvedValue(undefined), resolve: vi.fn() },
    },
    event: closedEvents(),
    tool: { transform: toolTransform },
    ...overrides,
  }
}

describe("V2 plugin entrypoint", () => {
  it("registers provider and integration transforms, then reloads after discovery", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "discovered-model" }] }),
    } as Response)
    const ctx = context()

    try {
      await plugin.setup(ctx as never)
      expect(ctx.integration.transform).toHaveBeenCalledTimes(1)
      expect(ctx.provider.transform).toHaveBeenCalledTimes(1)
      expect(ctx.integration.reload).toHaveBeenCalledTimes(1)
      expect(ctx.provider.reload).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      fetcher.mockRestore()
    }
  })

  it("uses a managed key only for discovery requests", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response)
    const ctx = context()
    const connection = ctx.integration.connection as { active: ReturnType<typeof vi.fn>; resolve: ReturnType<typeof vi.fn> }
    connection.active.mockResolvedValue({ type: "credential", id: "credential" })
    connection.resolve.mockResolvedValue({ type: "key", key: "managed-key" })

    try {
      await plugin.setup(ctx as never)
      expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer managed-key" }),
      }))
      expect(JSON.stringify({ status: { providers: 1, models: 0 } })).not.toContain("managed-key")
    } finally {
      fetcher.mockRestore()
    }
  })

  it("does not fail when no provider options are configured", async () => {
    const ctx = context({ options: {} })
    await expect(plugin.setup(ctx as never)).resolves.toBeTypeOf("function")
    expect(ctx.provider.reload).toHaveBeenCalledTimes(1)
  })

  it("serializes refreshes and does not refresh from its own provider reload", async () => {
    let releaseFirst: (() => void) | undefined
    const firstRefresh = new Promise<void>((resolve) => { releaseFirst = resolve })
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => {
        await firstRefresh
        return { ok: true, json: async () => ({ data: [] }) } as Response
      })
      .mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response)
    const events = {
      subscribe: vi.fn().mockReturnValue((async function* () {
        yield { type: "provider.updated" }
        yield { type: "config.updated" }
      })()),
    }
    const ctx = context({ event: events })

    try {
      const setup = plugin.setup(ctx as never)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fetcher).toHaveBeenCalledTimes(1)
      releaseFirst?.()
      await setup
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      fetcher.mockRestore()
    }
  })
})
