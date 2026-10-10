import { describe, expect, it, vi } from "vitest"
import tuiPlugin from "../../src/tui.js"
import { DiscoveryRpcDefinition } from "../../src/v2/rpc.js"

describe("V2 TUI Plugin", () => {
  function createMockTuiContext(rpcOverrides: Record<string, unknown> = {}) {
    const refresh = vi.fn().mockResolvedValue({ providers: 2, models: 10 })
    const cacheInspect = vi.fn().mockResolvedValue({
      entries: [
        {
          providerID: "openai-local",
          status: "fresh",
          modelCount: 5,
          ttlSeconds: 86400,
          fetchedAt: "2026-10-10T12:00:00Z",
        },
      ],
    })
    const cacheClear = vi.fn().mockResolvedValue({ cleared: 1 })
    const rpcClient = {
      refresh,
      cacheInspect,
      cacheClear,
      ...rpcOverrides,
    }
    const rpc = vi.fn().mockImplementation((def) => {
      if (def === DiscoveryRpcDefinition) return rpcClient
      return {}
    })
    const toastShow = vi.fn()
    const dialogAlert = vi.fn().mockResolvedValue(undefined)
    const dialogConfirm = vi.fn().mockResolvedValue(true)
    const dialogSelect = vi.fn().mockResolvedValue(undefined)
    const dialogPrompt = vi.fn().mockResolvedValue(undefined)

    let keymapLayerFactory: (() => { mode?: string; priority?: number; commands?: unknown[] }) | undefined
    const keymapLayer = vi.fn().mockImplementation((factory) => {
      keymapLayerFactory = factory
    })

    const ctx = {
      location: { directory: "/test/dir" },
      data: { location: { default: () => ({ directory: "/test/dir" }) } },
      client: { rpc },
      ui: {
        toast: { show: toastShow },
        dialog: {
          alert: dialogAlert,
          confirm: dialogConfirm,
          select: dialogSelect,
          prompt: dialogPrompt,
        },
      },
      keymap: { layer: keymapLayer },
    }

    return {
      ctx,
      rpcClient,
      toastShow,
      dialogAlert,
      dialogConfirm,
      dialogSelect,
      dialogPrompt,
      getKeymapLayer: () => keymapLayerFactory?.(),
    }
  }

  it("registers global keymap layer with refresh and cache commands", async () => {
    const { ctx, getKeymapLayer } = createMockTuiContext()
    await tuiPlugin.setup(ctx as never)

    const layer = getKeymapLayer()
    expect(layer).toBeDefined()
    expect(layer?.mode).toBe("global")
    expect(layer?.commands).toHaveLength(2)

    const [refreshCmd, cacheCmd] = layer?.commands as Array<{
      id: string
      title: string
      slash?: { name: string; aliases?: string[]; arguments?: boolean }
      palette?: boolean
    }>

    expect(refreshCmd).toMatchObject({
      id: "models-discovery.refresh",
      title: "Models Discovery: Refresh",
      slash: {
        name: "models-discovery-refresh",
        arguments: true,
      },
      palette: true,
    })
    expect(refreshCmd.slash?.aliases).toBeUndefined()

    expect(cacheCmd).toMatchObject({
      id: "models-discovery.cache",
      title: "Models Discovery: Cache Operations",
      slash: {
        name: "models-discovery-cache",
        arguments: true,
      },
      palette: true,
    })
    expect(cacheCmd.slash?.aliases).toBeUndefined()
  })

  it("executes refresh via RPC and displays success toast", async () => {
    const { ctx, rpcClient, toastShow, getKeymapLayer } = createMockTuiContext()
    await tuiPlugin.setup(ctx as never)

    const [refreshCmd] = getKeymapLayer()?.commands as Array<{
      run: (input?: string) => Promise<void>
    }>

    await refreshCmd.run()

    expect(rpcClient.refresh).toHaveBeenCalledWith({ force: false }, { location: { directory: "/test/dir" } })
    expect(toastShow).toHaveBeenCalledWith({
      title: "Models Discovery",
      message: "Discovered 10 models across 2 providers.",
      variant: "success",
    })
  })

  it("passes force flag when input contains --force or force", async () => {
    const { ctx, rpcClient, toastShow, getKeymapLayer } = createMockTuiContext()
    await tuiPlugin.setup(ctx as never)

    const [refreshCmd] = getKeymapLayer()?.commands as Array<{
      run: (input?: string) => Promise<void>
    }>

    await refreshCmd.run("--force")

    expect(rpcClient.refresh).toHaveBeenCalledWith({ force: true }, { location: { directory: "/test/dir" } })
    expect(toastShow).toHaveBeenCalledWith({
      title: "Models Discovery",
      message: "Discovered 10 models across 2 providers (bypassed cache).",
      variant: "success",
    })

    await refreshCmd.run("force")
    expect(rpcClient.refresh).toHaveBeenCalledWith({ force: true }, { location: { directory: "/test/dir" } })
  })

  it("shows error toast when RPC call fails", async () => {
    const { ctx, rpcClient, toastShow, getKeymapLayer } = createMockTuiContext()
    rpcClient.refresh.mockRejectedValueOnce(new Error("Network timeout"))

    await tuiPlugin.setup(ctx as never)

    const [refreshCmd] = getKeymapLayer()?.commands as Array<{
      run: () => Promise<void>
    }>

    await refreshCmd.run()

    expect(toastShow).toHaveBeenCalledWith({
      title: "Models Discovery",
      message: "Refresh failed: Network timeout",
      variant: "error",
    })
  })

  it("formats non-Error RPC failure objects gracefully", async () => {
    const { ctx, rpcClient, toastShow, getKeymapLayer } = createMockTuiContext()
    rpcClient.refresh.mockRejectedValueOnce({
      type: "rpc.unavailable",
      message: "RPC is unavailable: opencode.models-discovery",
    })

    await tuiPlugin.setup(ctx as never)

    const [refreshCmd] = getKeymapLayer()?.commands as Array<{
      run: () => Promise<void>
    }>

    await refreshCmd.run()

    expect(toastShow).toHaveBeenCalledWith({
      title: "Models Discovery",
      message: "Refresh failed: RPC is unavailable: opencode.models-discovery",
      variant: "error",
    })
  })

  describe("Cache Operations command", () => {
    it("opens select dialog and inspects cache when selected", async () => {
      const { ctx, rpcClient, dialogSelect, dialogAlert, getKeymapLayer } = createMockTuiContext()
      dialogSelect.mockResolvedValueOnce("inspect")
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(dialogSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Models Discovery Cache",
          options: expect.arrayContaining([
            expect.objectContaining({ value: "inspect" }),
            expect.objectContaining({ value: "refresh" }),
            expect.objectContaining({ value: "clear-one" }),
            expect.objectContaining({ value: "clear-all" }),
          ]),
        }),
      )
      expect(rpcClient.cacheInspect).toHaveBeenCalledWith({}, { location: { directory: "/test/dir" } })
      expect(dialogAlert).toHaveBeenCalledWith({
        title: "Discovery Cache Status",
        message: expect.stringContaining("Provider: openai-local | Status: fresh | Models: 5 | TTL: 86400s"),
      })
    })

    it("supports direct inspect shortcut via input argument", async () => {
      const { ctx, rpcClient, dialogSelect, dialogAlert, getKeymapLayer } = createMockTuiContext()
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run("inspect")

      expect(dialogSelect).not.toHaveBeenCalled()
      expect(rpcClient.cacheInspect).toHaveBeenCalledWith({}, { location: { directory: "/test/dir" } })
      expect(dialogAlert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Discovery Cache Status" }),
      )
    })

    it("displays message when no providers are configured during inspect", async () => {
      const { ctx, rpcClient, dialogSelect, dialogAlert, getKeymapLayer } = createMockTuiContext({
        cacheInspect: vi.fn().mockResolvedValue({ entries: [] }),
      })
      dialogSelect.mockResolvedValueOnce("inspect")
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(dialogAlert).toHaveBeenCalledWith({
        title: "Discovery Cache Status",
        message: "No configured discovery providers found.",
      })
    })

    it("triggers force refresh and displays toast", async () => {
      const { ctx, rpcClient, dialogSelect, toastShow, getKeymapLayer } = createMockTuiContext()
      dialogSelect.mockResolvedValueOnce("refresh")
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(rpcClient.refresh).toHaveBeenCalledWith({ force: true }, { location: { directory: "/test/dir" } })
      expect(toastShow).toHaveBeenCalledWith({
        title: "Models Discovery",
        message: "Discovered 10 models across 2 providers (bypassed cache).",
        variant: "success",
      })
    })

    it("clears single provider cache after user confirmation", async () => {
      const { ctx, rpcClient, dialogSelect, dialogConfirm, toastShow, getKeymapLayer } = createMockTuiContext()
      dialogSelect
        .mockResolvedValueOnce("clear-one")
        .mockResolvedValueOnce("openai-local")
      dialogConfirm.mockResolvedValueOnce(true)
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(rpcClient.cacheInspect).toHaveBeenCalledWith({}, { location: { directory: "/test/dir" } })
      expect(dialogConfirm).toHaveBeenCalledWith({
        title: "Clear Provider Cache",
        message: 'Are you sure you want to clear the discovery cache for provider "openai-local"?',
        label: { confirm: "Clear", cancel: "Cancel" },
      })
      expect(rpcClient.cacheClear).toHaveBeenCalledWith(
        { providerID: "openai-local" },
        { location: { directory: "/test/dir" } },
      )
      expect(toastShow).toHaveBeenCalledWith({
        title: "Models Discovery",
        message: 'Cleared discovery cache for provider "openai-local".',
        variant: "success",
      })
    })

    it("aborts clear single provider if user cancels confirmation", async () => {
      const { ctx, rpcClient, dialogSelect, dialogConfirm, toastShow, getKeymapLayer } = createMockTuiContext()
      dialogSelect
        .mockResolvedValueOnce("clear-one")
        .mockResolvedValueOnce("openai-local")
      dialogConfirm.mockResolvedValueOnce(false)
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(rpcClient.cacheClear).not.toHaveBeenCalled()
      expect(toastShow).not.toHaveBeenCalled()
    })

    it("clears all provider caches after confirmation", async () => {
      const { ctx, rpcClient, dialogSelect, dialogConfirm, toastShow, getKeymapLayer } = createMockTuiContext({
        cacheClear: vi.fn().mockResolvedValue({ cleared: 3 }),
      })
      dialogSelect.mockResolvedValueOnce("clear-all")
      dialogConfirm.mockResolvedValueOnce(true)
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(dialogConfirm).toHaveBeenCalledWith({
        title: "Clear All Discovery Caches",
        message: "Are you sure you want to clear discovery caches for all configured providers?",
        label: { confirm: "Clear All", cancel: "Cancel" },
      })
      expect(rpcClient.cacheClear).toHaveBeenCalledWith({}, { location: { directory: "/test/dir" } })
      expect(toastShow).toHaveBeenCalledWith({
        title: "Models Discovery",
        message: "Cleared all discovery caches (3 providers cleared).",
        variant: "success",
      })
    })

    it("aborts clear all provider caches if user cancels confirmation", async () => {
      const { ctx, rpcClient, dialogSelect, dialogConfirm, toastShow, getKeymapLayer } = createMockTuiContext()
      dialogSelect.mockResolvedValueOnce("clear-all")
      dialogConfirm.mockResolvedValueOnce(false)
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(rpcClient.cacheClear).not.toHaveBeenCalled()
      expect(toastShow).not.toHaveBeenCalled()
    })

    it("shows error toast when cache operation RPC fails", async () => {
      const { ctx, rpcClient, dialogSelect, toastShow, getKeymapLayer } = createMockTuiContext()
      dialogSelect.mockResolvedValueOnce("inspect")
      rpcClient.cacheInspect.mockRejectedValueOnce(new Error("Storage corrupted"))
      await tuiPlugin.setup(ctx as never)

      const commands = getKeymapLayer()?.commands as Array<{
        id: string
        run: (input?: string) => Promise<void>
      }>
      const cacheCmd = commands.find((c) => c.id === "models-discovery.cache")

      await cacheCmd?.run()

      expect(toastShow).toHaveBeenCalledWith({
        title: "Models Discovery",
        message: "Cache operation failed: Storage corrupted",
        variant: "error",
      })
    })
  })
})
