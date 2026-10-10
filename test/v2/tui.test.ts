import { describe, expect, it, vi } from "vitest"
import tuiPlugin from "../../src/tui.js"
import { DiscoveryRpcDefinition } from "../../src/v2/rpc.js"

describe("V2 TUI Plugin", () => {
  function createMockTuiContext(rpcOverrides: Record<string, unknown> = {}) {
    const refresh = vi.fn().mockResolvedValue({ providers: 2, models: 10 })
    const rpcClient = {
      refresh,
      ...rpcOverrides,
    }
    const rpc = vi.fn().mockImplementation((def) => {
      if (def === DiscoveryRpcDefinition) return rpcClient
      return {}
    })
    const toastShow = vi.fn()
    let keymapLayerFactory: (() => { mode?: string; priority?: number; commands?: unknown[] }) | undefined
    const keymapLayer = vi.fn().mockImplementation((factory) => {
      keymapLayerFactory = factory
    })

    const ctx = {
      location: { directory: "/test/dir" },
      data: { location: { default: () => ({ directory: "/test/dir" }) } },
      client: { rpc },
      ui: { toast: { show: toastShow } },
      keymap: { layer: keymapLayer },
    }

    return {
      ctx,
      rpcClient,
      toastShow,
      getKeymapLayer: () => keymapLayerFactory?.(),
    }
  }

  it("registers global keymap layer with single refresh slash command and no aliases", async () => {
    const { ctx, getKeymapLayer } = createMockTuiContext()
    await tuiPlugin.setup(ctx as never)

    const layer = getKeymapLayer()
    expect(layer).toBeDefined()
    expect(layer?.mode).toBe("global")
    expect(layer?.commands).toHaveLength(1)

    const [refreshCmd] = layer?.commands as Array<{
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
})
