import { describe, expect, it, vi } from "vitest"
import { DiscoveryRpcDefinition } from "../../src/v2/rpc.js"
import { setupV2 } from "../../src/v2/index.js"

describe("DiscoveryRpcDefinition", () => {
  it("defines the required RPC methods with correct schemas", () => {
    expect(DiscoveryRpcDefinition.id).toBe("opencode.models-discovery")
    expect(DiscoveryRpcDefinition.methods).toHaveProperty("refresh")
    expect(DiscoveryRpcDefinition.methods).toHaveProperty("cacheInspect")
    expect(DiscoveryRpcDefinition.methods).toHaveProperty("cacheClear")
    expect(DiscoveryRpcDefinition.methods).toHaveProperty("overrideList")
    expect(DiscoveryRpcDefinition.methods).toHaveProperty("overrideSet")
    expect(DiscoveryRpcDefinition.methods).toHaveProperty("overrideDelete")
    expect(DiscoveryRpcDefinition.events).toHaveProperty("discoveryFailed")
  })

  it("registers RPC handlers on host during setupV2", async () => {
    let registeredDefinition: typeof DiscoveryRpcDefinition | undefined
    let registeredHandlers: Record<string, Function> | undefined

    const registerMock = vi.fn().mockImplementation(async (def, handlers) => {
      registeredDefinition = def
      registeredHandlers = handlers
      return { events: { emit: vi.fn() } }
    })

    const mockStorage = new Map<string, unknown>()
    mockStorage.set("opencode.models-discovery.v2:provider:test-prov", {
      version: 1,
      identity: { providerID: "test-prov", baseURL: "http://localhost:11434", endpoint: "/v1/models" },
      fetchedAt: new Date().toISOString(),
      rawModels: [{ id: "m1" }, { id: "m2" }],
      enrichments: {},
    })

    const ctx = {
      provider: {
        list: vi.fn().mockResolvedValue([
          {
            id: "test-prov",
            name: "Test Provider",
            package: "@opencode/ai/providers/openai-compatible",
            settings: {
              baseURL: "http://localhost:11434",
              modelsDiscovery: { enabled: true, cache: { enabled: true, ttlSeconds: 3600 } },
            },
          },
        ]),
        transform: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      integration: {
        transform: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
        connection: {
          active: vi.fn().mockResolvedValue(undefined),
          resolve: vi.fn().mockResolvedValue(undefined),
        },
      },
      tool: { transform: vi.fn() },
      command: { transform: vi.fn(), reload: vi.fn().mockResolvedValue(undefined) },
      event: { subscribe: vi.fn().mockReturnValue({ [Symbol.asyncIterator]: async function* () {} }) },
      storage: {
        get: vi.fn().mockImplementation(async (k: string) => mockStorage.get(k)),
        set: vi.fn().mockImplementation(async (k: string, v: unknown) => { mockStorage.set(k, v) }),
        remove: vi.fn().mockImplementation(async (k: string) => { mockStorage.delete(k) }),
      },
      rpc: {
        register: registerMock,
      },
    }

    await setupV2(ctx as any)

    expect(registerMock).toHaveBeenCalledTimes(1)
    expect(registeredDefinition?.id).toBe("opencode.models-discovery")
    expect(registeredHandlers).toBeDefined()

    // Test cacheInspect handler
    const inspectResult = await registeredHandlers!["cacheInspect"]({ providerID: "test-prov" }, {} as any)
    expect(inspectResult.entries).toHaveLength(1)
    expect(inspectResult.entries[0]).toMatchObject({
      providerID: "test-prov",
      status: "fresh",
      modelCount: 2,
    })

    // Test cacheClear handler
    const clearResult = await registeredHandlers!["cacheClear"]({ providerID: "test-prov" }, {} as any)
    expect(clearResult.cleared).toBe(1)
    expect(mockStorage.has("opencode.models-discovery.v2:provider:test-prov")).toBe(false)

    // Test refresh handler
    const refreshResult = await registeredHandlers!["refresh"]({ force: true }, {} as any)
    expect(refreshResult).toHaveProperty("providers")
    expect(refreshResult).toHaveProperty("models")
    expect(refreshResult).toHaveProperty("failures")
  })

  it("reports provider error and emits discoveryFailed event when 401 occurs", async () => {
    let registeredHandlers: Record<string, Function> | undefined
    const emitMock = vi.fn().mockResolvedValue(undefined)

    const registerMock = vi.fn().mockImplementation(async (_def, handlers) => {
      registeredHandlers = handlers
      return { events: { emit: emitMock } }
    })

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response)

    let eventSubscriber: ((event: unknown) => void) | undefined
    const eventStream = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            return new Promise<{ value: unknown; done: boolean }>((resolve) => {
              eventSubscriber = (event) => resolve({ value: event, done: false })
            })
          },
        }
      },
    }

    const ctx = {
      provider: {
        list: vi.fn().mockResolvedValue([
          {
            id: "bad-prov",
            name: "Bad Provider",
            package: "@opencode/ai/providers/openai-compatible",
            settings: {
              baseURL: "http://localhost:11434/v1",
              modelsDiscovery: { enabled: true },
            },
          },
        ]),
        transform: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
      },
      integration: {
        transform: vi.fn(),
        reload: vi.fn().mockResolvedValue(undefined),
        connection: {
          active: vi.fn().mockResolvedValue(undefined),
          resolve: vi.fn().mockResolvedValue(undefined),
        },
      },
      tool: { transform: vi.fn() },
      command: { transform: vi.fn(), reload: vi.fn().mockResolvedValue(undefined) },
      event: { subscribe: vi.fn().mockReturnValue(eventStream) },
      rpc: { register: registerMock },
    }

    try {
      const cleanup = await setupV2(ctx as any)

      // Test refresh handler includes the failure
      const refreshResult = await registeredHandlers!["refresh"]({ force: true }, {} as any)
      expect(refreshResult.failures).toHaveLength(1)
      expect(refreshResult.failures[0]).toMatchObject({
        providerID: "bad-prov",
        status: 401,
        isAuthError: true,
      })

      // Test status handler includes the provider error
      const statusResult = await registeredHandlers!["status"]({}, {} as any)
      expect(statusResult.providers[0]?.error).toMatchObject({
        providerID: "bad-prov",
        status: 401,
        isAuthError: true,
      })
      expect(statusResult.report).toContain("Status: Error")
      expect(statusResult.report).toContain("Hint: Authentication failed. Please verify the API key with /connect.")

      // Trigger credential.updated event and verify discoveryFailed is emitted
      expect(eventSubscriber).toBeDefined()
      eventSubscriber?.({ type: "credential.updated" })

      // Wait a tick for async event handler
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(emitMock).toHaveBeenCalledWith(
        "discoveryFailed",
        expect.objectContaining({
          providerID: "bad-prov",
          status: 401,
          isAuthError: true,
        }),
      )

      cleanup()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
