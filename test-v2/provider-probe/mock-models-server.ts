import { createServer } from "node:http"

const port = Number(process.env.PROBE_MOCK_PORT ?? 40123)

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/v1/models") {
    console.error(JSON.stringify({ phase: "mock-models-request" }))
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({
      object: "list",
      data: [{
        id: "discovery-probe-chat",
        object: "model",
        owned_by: "probe",
      }],
    }))
    return
  }

  response.writeHead(404, { "content-type": "application/json" })
  response.end(JSON.stringify({ error: "not found" }))
})

server.listen(port, "127.0.0.1", () => {
  console.error(JSON.stringify({ phase: "mock-ready", port }))
})

const shutdown = () => server.close(() => process.exit(0))
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
