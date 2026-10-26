import { createServer, type Server } from "node:http"
import { describe, expect, it } from "vitest"
import { discoverInventory } from "../../src/v2/discovery.js"
import { parseProviderDiscoveryOptions } from "../../src/v2/provider-config.js"

async function startMockProvider(): Promise<{ server: Server; baseURL: string; requests: Array<{ path: string; authorization?: string; body?: string }> }> {
  const requests: Array<{ path: string; authorization?: string; body?: string }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk: Buffer) => chunks.push(chunk))
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8")
      requests.push({ path: request.url ?? "", authorization: request.headers.authorization, ...(body ? { body } : {}) })
      response.setHeader("content-type", "application/json")

      if (request.url === "/v1/models" && request.method === "GET") {
        response.end(JSON.stringify({ data: [{ id: "remote/model-alpha", name: "Remote Alpha" }] }))
        return
      }
      if (request.url === "/v1/chat/completions" && request.method === "POST") {
        response.end(JSON.stringify({ id: "completion-1", model: "remote/model-alpha", choices: [{ message: { content: "ok" } }] }))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ error: "not found" }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Mock provider did not bind to a TCP port")
  return { server, baseURL: `http://127.0.0.1:${address.port}/v1`, requests }
}

describe("V2 local OpenAI-compatible integration", () => {
  it("discovers models and sends a runtime request with the expected credential and model ID", async () => {
    const mock = await startMockProvider()
    try {
      const provider = {
        id: "local",
        package: "@opencode/ai/providers/openai-compatible",
        apiKey: "example-integration-key",
        settings: { baseURL: mock.baseURL },
      }
      const discovery = new Map([["local", parseProviderDiscoveryOptions({ enabled: true })!]])
      const inventory = await discoverInventory([provider], discovery, fetch)
      const model = inventory.get("local")?.get("remote/model-alpha")

      expect(model).toMatchObject({ id: "remote/model-alpha", modelID: "remote/model-alpha" })
      expect(mock.requests[0]).toMatchObject({ path: "/v1/models", authorization: "Bearer example-integration-key" })

      const response = await fetch(`${mock.baseURL}/chat/completions`, {
        method: "POST",
        headers: { authorization: "Bearer example-integration-key", "content-type": "application/json" },
        body: JSON.stringify({ model: model?.modelID, messages: [{ role: "user", content: "hello" }] }),
      })
      expect(response.ok).toBe(true)
      expect(await response.json()).toMatchObject({ model: "remote/model-alpha" })
      expect(mock.requests[1]).toMatchObject({
        path: "/v1/chat/completions",
        authorization: "Bearer example-integration-key",
        body: JSON.stringify({ model: "remote/model-alpha", messages: [{ role: "user", content: "hello" }] }),
      })
    } finally {
      await new Promise<void>((resolve, reject) => mock.server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it("uses a fresh cache entry and bypasses it for force refresh", async () => {
    const mock = await startMockProvider()
    const cache = new Map<string, unknown>()
    const storage = {
      get: async (key: string) => cache.get(key),
      set: async (key: string, value: unknown) => { cache.set(key, value) },
    }
    const provider = {
      id: "local",
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: mock.baseURL },
    }
    const discovery = new Map([["local", parseProviderDiscoveryOptions({ enabled: true, cache: { enabled: true } })!]])

    try {
      await discoverInventory([provider], discovery, fetch, storage)
      await discoverInventory([provider], discovery, fetch, storage)
      await discoverInventory([provider], discovery, fetch, storage, { force: true })
      expect(mock.requests.filter((request) => request.path === "/v1/models")).toHaveLength(2)
    } finally {
      await new Promise<void>((resolve, reject) => mock.server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
