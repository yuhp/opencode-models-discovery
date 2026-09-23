import { Model, Plugin, Provider } from "@opencode/plugin"

const providerID = "probe"
const mark = (phase: string, data: Record<string, unknown> = {}) =>
  console.error(JSON.stringify({ probe: true, phase, ...data }))
const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export default Plugin.define({
  id: "provider-probe",
  async setup(ctx) {
    mark("setup")
    const configured = (ctx.options.providers as Record<string, {
      name?: string
      package?: string
      settings?: Record<string, unknown>
      modelsDiscovery?: Record<string, unknown>
    }> | undefined)?.[providerID]
    if (!configured?.package || typeof configured.settings?.baseURL !== "string") {
      mark("configured-provider-missing", { optionKeys: Object.keys(ctx.options) })
      return
    }
    const packageName = configured.package

    await ctx.provider.transform((editor) => {
      if (editor.get(Provider.ID.make(providerID))) return
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make(providerID)),
          name: configured.name ?? providerID,
           package: packageName,
          settings: configured.settings,
          activation: "enabled",
        },
        models: [],
      })
      mark("provider-add", { providerID, sourceModelIDs: [] })
    })
    await ctx.provider.reload()
    const providers = (await ctx.provider.list()).data
    const provider = providers.find((entry) => entry.id === providerID)
    mark("provider-list", {
      providerIDs: providers.map((entry) => entry.id),
      found: Boolean(provider),
      package: provider?.package,
      activation: provider?.activation,
      hasBaseURL: typeof provider?.settings?.baseURL === "string",
    })
    if (!provider) return
    const baseURL = provider.settings?.baseURL
    if (typeof baseURL !== "string") {
      mark("native-base-url-missing")
      return
    }
    const endpoint = new URL(`${baseURL}/models`)
    if (endpoint.hostname !== "127.0.0.1" || endpoint.protocol !== "http:")
      throw new Error("Probe requires an isolated loopback endpoint")

    let discovered: ReturnType<typeof Model.Info.default>[] = []
    await ctx.provider.transform((editor) => {
      const current = editor.list().find((entry) => entry.provider.id === providerID)
      mark("provider-transform", {
        found: Boolean(current),
        sourceModelIDs: current ? [...current.models.keys()] : null,
        discoveredModelIDs: discovered.map((model) => model.modelID),
      })
      if (!current || current.models.size !== 0)
        throw new Error("Expected native provider with zero source models")
    })
    await ctx.provider.reload()
    mark("source-reload-complete")

    const response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) throw new Error(`Models request returned HTTP ${response.status}`)
    const payload = await response.json() as { data?: Array<{ id?: string }> }
    const ids = (payload.data ?? []).map((model) => model.id)
      .filter((id): id is string => typeof id === "string")
    mark("models-fetch", { status: response.status, modelIDs: ids })
    discovered = ids.map((id) => Model.Info.default(Provider.ID.make(providerID), Model.ID.make(id)))
    await ctx.provider.transform((editor) => {
      editor.models.set(providerID, discovered)
    })
    await ctx.provider.reload()
    mark("provider-reload-complete", { modelIDs: ids })
  },
})
