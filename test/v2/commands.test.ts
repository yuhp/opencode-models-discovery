import { describe, expect, it, vi } from "vitest"
import { registerDiscoveryCommands, type DiscoveryCommandsContext, type DiscoveryCommandsOps } from "../../src/v2/commands.js"

describe("V2 discovery commands", () => {
  function createMockCommandsContext() {
    const commands: Array<{
      name: string
      description?: string
      execute: (input: { sessionID: string; prompt?: unknown }) => Promise<void>
    }> = []

    const transform = vi.fn().mockImplementation(async (callback) => {
      callback({
        add: (cmd: typeof commands[number]) => commands.push(cmd),
      })
    })
    const reload = vi.fn().mockResolvedValue(undefined)
    const synthetic = vi.fn().mockResolvedValue(undefined)

    const ctx: DiscoveryCommandsContext = {
      command: { transform, reload },
      session: { synthetic },
    }

    return { ctx, commands, transform, reload, synthetic }
  }

  function createMockOps(overrides: Partial<DiscoveryCommandsOps> = {}): DiscoveryCommandsOps {
    return {
      refresh: vi.fn().mockResolvedValue({ providers: 2, models: 10 }),
      status: vi.fn().mockResolvedValue("Current discovery inventory has 10 models from 2 providers."),
      cacheInspect: vi.fn().mockResolvedValue({
        entries: [
          {
            providerID: "local-prov",
            status: "fresh",
            fetchedAt: "2026-10-10T12:00:00Z",
            ttlSeconds: 86400,
            modelCount: 5,
          },
        ],
      }),
      cacheClear: vi.fn().mockResolvedValue({ cleared: 1 }),
      ...overrides,
    }
  }

  it("registers models-discovery-refresh and models-discovery-console on ctx.command", async () => {
    const { ctx, commands, transform, reload } = createMockCommandsContext()
    const ops = createMockOps()

    await registerDiscoveryCommands(ctx, ops)

    expect(transform).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(commands.map((c) => c.name)).toEqual([
      "models-discovery-refresh",
      "models-discovery-console",
    ])
  })

  it("skips registration gracefully when ctx.command is missing", async () => {
    const ctx: DiscoveryCommandsContext = {}
    const ops = createMockOps()

    await expect(registerDiscoveryCommands(ctx, ops)).resolves.toBeUndefined()
  })

  describe("models-discovery-refresh command", () => {
    it("executes refresh and sends result to session with resume: false", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const refreshCmd = commands.find((c) => c.name === "models-discovery-refresh")
      expect(refreshCmd).toBeDefined()

      await refreshCmd!.execute({ sessionID: "ses-123" })

      expect(ops.refresh).toHaveBeenCalledWith(false)
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Model discovery refreshed: discovered 10 models from 2 providers.",
        resume: false,
      })
    })

    it("passes force: true when prompt contains --force", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const refreshCmd = commands.find((c) => c.name === "models-discovery-refresh")

      await refreshCmd!.execute({ sessionID: "ses-123", prompt: "--force" })

      expect(ops.refresh).toHaveBeenCalledWith(true)
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Model discovery refreshed: discovered 10 models from 2 providers.",
        resume: false,
      })
    })

    it("handles object prompt input such as { text: 'force' }", async () => {
      const { ctx, commands } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const refreshCmd = commands.find((c) => c.name === "models-discovery-refresh")

      await refreshCmd!.execute({ sessionID: "ses-123", prompt: { text: "force" } })

      expect(ops.refresh).toHaveBeenCalledWith(true)
    })

    it("formats failures when refresh throws an error", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps({
        refresh: vi.fn().mockRejectedValue(new Error("Network timeout")),
      })

      await registerDiscoveryCommands(ctx, ops)
      const refreshCmd = commands.find((c) => c.name === "models-discovery-refresh")

      await refreshCmd!.execute({ sessionID: "ses-123" })

      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Model discovery refresh failed: Network timeout",
        resume: false,
      })
    })
  })

  describe("models-discovery-console command", () => {
    it("reports full status by default", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")
      expect(consoleCmd).toBeDefined()

      await consoleCmd!.execute({ sessionID: "ses-123" })

      expect(ops.status).toHaveBeenCalledWith({
        providerID: undefined,
        details: true,
        rawCache: false,
      })
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Current discovery inventory has 10 models from 2 providers.",
        resume: false,
      })
    })

    it("filters status by provider when --provider is specified", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")

      await consoleCmd!.execute({ sessionID: "ses-123", prompt: "--provider custom-gw" })

      expect(ops.status).toHaveBeenCalledWith({
        providerID: "custom-gw",
        details: true,
        rawCache: false,
      })
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Current discovery inventory has 10 models from 2 providers.",
        resume: false,
      })
    })

    it("passes rawCache: true when --raw-cache is specified", async () => {
      const { ctx, commands } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")

      await consoleCmd!.execute({ sessionID: "ses-123", prompt: "status --raw-cache" })

      expect(ops.status).toHaveBeenCalledWith({
        providerID: undefined,
        details: true,
        rawCache: true,
      })
    })

    it("inspects cache when 'cache' argument is provided", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")

      await consoleCmd!.execute({ sessionID: "ses-123", prompt: "cache inspect" })

      expect(ops.cacheInspect).toHaveBeenCalledWith(undefined)
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "### Discovery Cache Status:\n- `local-prov`: fresh, TTL: 86400s, 5 models, fetched at 2026-10-10T12:00:00Z",
        resume: false,
      })
    })

    it("clears cache for specific provider when 'cache clear <provider>' is provided", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps()

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")

      await consoleCmd!.execute({ sessionID: "ses-123", prompt: "cache clear my-prov" })

      expect(ops.cacheClear).toHaveBeenCalledWith("my-prov")
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: 'Cleared discovery cache for provider "my-prov".',
        resume: false,
      })
    })

    it("clears all caches when 'cache clear-all' is provided", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps({
        cacheClear: vi.fn().mockResolvedValue({ cleared: 3 }),
      })

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")

      await consoleCmd!.execute({ sessionID: "ses-123", prompt: "cache clear-all" })

      expect(ops.cacheClear).toHaveBeenCalledWith()
      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Cleared all discovery caches (3 providers cleared).",
        resume: false,
      })
    })

    it("handles errors when status retrieval fails", async () => {
      const { ctx, commands, synthetic } = createMockCommandsContext()
      const ops = createMockOps({
        status: vi.fn().mockRejectedValue(new Error("Storage corrupted")),
      })

      await registerDiscoveryCommands(ctx, ops)
      const consoleCmd = commands.find((c) => c.name === "models-discovery-console")

      await consoleCmd!.execute({ sessionID: "ses-123" })

      expect(synthetic).toHaveBeenCalledWith({
        sessionID: "ses-123",
        text: "Failed to retrieve discovery status: Storage corrupted",
        resume: false,
      })
    })
  })
})
