import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { setTimeout as delay } from "node:timers/promises"

const fixture = resolve(dirname(new URL(import.meta.url).pathname))
const cli = join(fixture, "node_modules/@opencode/cli/bin/opencode.exe")
const timeoutMs = 30_000
const mockPort = 40123 + Math.floor(Math.random() * 500)
const serverPort = mockPort + 1
const tempRoot = await mkdtemp(join(tmpdir(), "opencode-provider-probe-"))
const project = join(tempRoot, "project")
const home = join(tempRoot, "home")
const xdg = {
  XDG_CONFIG_HOME: join(tempRoot, "config"),
  XDG_DATA_HOME: join(tempRoot, "data"),
  XDG_CACHE_HOME: join(tempRoot, "cache"),
  XDG_STATE_HOME: join(tempRoot, "state"),
}
await Promise.all([project, home, join(project, ".git"), ...Object.values(xdg)].map((path) => mkdir(path, { recursive: true })))
await mkdir(join(project, "models-discovery"), { recursive: true })
for (const file of ["index.ts", "catalog.ts", "discovery.ts", "provider-config.ts", "tools.ts"]) {
  await copyFile(join(fixture, "../../src-v2", file), join(project, "models-discovery", file))
}
await writeFile(join(project, "models-discovery", "package.json"), JSON.stringify({
  name: "models-discovery",
  type: "module",
  exports: { ".": "./index.ts" },
}, null, 2))
await symlink(join(fixture, "node_modules"), join(project, "models-discovery", "node_modules"), "junction")

const config = JSON.parse(await readFile(join(fixture, "opencode.json"), "utf8"))
const pluginEntry = config.plugin[0]
const pluginOptions = pluginEntry[1]
const configuredProvider = pluginOptions.providers.probe
configuredProvider.settings.baseURL = `http://127.0.0.1:${mockPort}/v1`
const configuredProviderID = Object.keys(pluginOptions.providers)[0]
const configuredPackage = configuredProvider.package
const configuredModelID = "discovery-probe-chat"
pluginEntry[0] = "./models-discovery"
await writeFile(join(project, "opencode.json"), JSON.stringify(config, null, 2))

const inheritedOpencodeKeys = Object.keys(process.env).filter((key) => key.startsWith("OPENCODE"))
const env = { ...process.env, HOME: home, ...xdg, PROBE_MOCK_PORT: String(mockPort) }
for (const key of inheritedOpencodeKeys) delete env[key]
delete env.OPENCODE_DB
delete env.OPENCODE_PURE

const children = []
const output = { cli: [], mock: [] }
const spawnChild = (name, command, args) => {
  const child = spawn(command, args, { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] })
  children.push(child)
  child.once("error", (error) => output[name].push(`\nchild-error: ${error.message}\n`))
  child.stdout.on("data", (chunk) => output[name].push(chunk.toString()))
  child.stderr.on("data", (chunk) => output[name].push(chunk.toString()))
  return child
}

spawnChild("mock", process.execPath, ["--experimental-strip-types", join(fixture, "mock-models-server.ts")])
spawnChild("cli", cli, ["serve", "--hostname", "127.0.0.1", "--port", String(serverPort), "--log-level", "debug", "--print-logs"])

const allOutput = () => [...output.mock, ...output.cli]
  .join("")
  .replace(/server password \S+/g, "server password [redacted]")
const waitFor = async (predicate, label) => {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await predicate()) return
    await delay(100)
  }
  throw new Error(`Timed out waiting for ${label}\n${allOutput()}`)
}

try {
  await waitFor(() => allOutput().includes('"phase":"mock-ready"'), "mock server")
  await waitFor(() => allOutput().includes("server password "), "server authentication")
  const rawOutput = [...output.mock, ...output.cli].join("")
  const password = rawOutput.match(/server password ([^\s]+)/)?.[1]
  if (!password) throw new Error("OpenCode server password was not available")
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const location = encodeURIComponent(project)
  const bootstrap = await fetch(`http://127.0.0.1:${serverPort}/api/provider?location[directory]=${location}`, {
    headers: { authorization },
  })
  if (!bootstrap.ok) {
    throw new Error(`Bootstrap provider request returned HTTP ${bootstrap.status}: ${await bootstrap.text()}\n${allOutput()}`)
  }
  await bootstrap.arrayBuffer()
  const requestWithAuth = async (path) => {
    const response = await fetch(`http://127.0.0.1:${serverPort}${path}?location[directory]=${location}`, {
      headers: { authorization },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
    return response.json()
  }
  let providers
  let models
  await waitFor(async () => {
    try {
      providers = await requestWithAuth("/api/provider")
      models = await requestWithAuth("/api/model")
      const providerList = providers.data ?? providers
      const modelList = models.data ?? models
       return providerList.some((provider) => provider.id === configuredProviderID)
         && modelList.some((model) => model.providerID === configuredProviderID && model.modelID === configuredModelID)
    } catch {
      return false
    }
  }, "production plugin provider and model")
  const providerList = providers.data ?? providers
  const modelList = models.data ?? models
   const probeProvider = providerList.find((provider) => provider.id === configuredProviderID)
   const discovered = modelList.find((model) => model.providerID === configuredProviderID && model.modelID === configuredModelID)
   const pluginResponse = await requestWithAuth("/api/plugin")
   const pluginList = pluginResponse.data ?? pluginResponse
   const loaded = pluginList.some((plugin) => plugin.id === "opencode.models-discovery")
   const modelConfig = configuredProvider.models
   const requestCount = () => [...output.mock, ...output.cli].join("").match(/"phase":"mock-models-request"/g)?.length ?? 0
   const initialRequests = requestCount()
   await delay(1_200)
   const stableRequests = requestCount()
   const zeroSeed = modelConfig === undefined
   const fetched = initialRequests > 0
   if (!probeProvider || !loaded || !zeroSeed || !fetched || stableRequests !== initialRequests || !discovered) {
    console.error(JSON.stringify({
      result: "blocked",
      reason: "production discovery proof failed",
       probeProvider: Boolean(probeProvider), loaded, zeroSeed, fetched, initialRequests, stableRequests, discovered: Boolean(discovered),
    }))
    throw new Error("Production discovery proof failed")
  }
  console.log(JSON.stringify({
    versions: {
      cli: "2.0.14",
      plugin: JSON.parse(await readFile(join(fixture, "node_modules/@opencode/plugin/package.json"))).version,
    },
    isolated: { project, home, xdg, inheritedOpencodeKeys },
      proof: { setup: loaded, zeroSeed, fetched, requestCount: stableRequests, provider: { id: probeProvider.id, package: probeProvider.package }, model: { providerID: discovered.providerID, modelID: discovered.modelID }, config: { providerID: configuredProviderID, package: configuredPackage, modelsInput: modelConfig ?? null } },
  }, null, 2))
} finally {
  for (const child of children) child.kill("SIGTERM")
  await Promise.all(children.map((child) => new Promise((resolveExit) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolveExit()
    const force = setTimeout(() => child.kill("SIGKILL"), 2_000)
    child.once("exit", () => { clearTimeout(force); resolveExit() })
  })))
  await rm(tempRoot, { recursive: true, force: true })
}
