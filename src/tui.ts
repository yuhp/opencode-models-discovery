import type { Plugin } from "@opencode/plugin/tui"
import {
  DiscoveryRpcDefinition,
  type RpcCacheClearOutput,
  type RpcCacheInspectOutput,
  type RpcModelOverride,
  type RpcRefreshOutput,
  type RpcStatusOutput,
} from "./v2/rpc.js"

export type TuiCleanup = () => Promise<void> | void

export interface TuiPluginDefinition {
  readonly id: string
  readonly setup: (context: Plugin.Context) => Promise<TuiCleanup | void> | TuiCleanup | void
}

export function defineTuiPlugin(plugin: TuiPluginDefinition): TuiPluginDefinition {
  return plugin
}

function formatError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null
      ? (error as { message?: string }).message ?? JSON.stringify(error)
      : String(error)
}

type OverrideEditContext = {
  readonly location?: unknown
  readonly ui: {
    readonly dialog: {
      select<Value>(options: { title: string; placeholder?: string; current?: Value; options: readonly { title: string; value: Value; description?: string }[] }): Promise<Value | undefined>
      prompt(options: { title: string; description?: string; placeholder?: string; value?: string }): Promise<string | undefined>
      alert(options: { title: string; message: string }): Promise<void>
    }
    readonly toast: { show(options: { title: string; message: string; variant?: "info" | "success" | "warning" | "error" }): void }
  }
  readonly client: { rpc(definition: unknown): unknown }
}

type OverrideModelValues = {
  readonly name: string
  readonly limit: { readonly context: number; readonly output: number; readonly input?: number }
  readonly capabilities: { readonly tools: boolean; readonly input: string[]; readonly output: string[] }
  readonly reasoning?: boolean
  readonly attachment?: boolean
}

async function editModelOverride(
  context: OverrideEditContext,
  providerID: string,
  modelID: string,
  existing?: RpcModelOverride,
  defaults?: OverrideModelValues,
): Promise<void> {
  const current = existing?.patch
  const hasOverride = (field: string): boolean => {
    if (field.startsWith("limit.")) {
      const key = field.slice("limit.".length)
      return Object.prototype.hasOwnProperty.call(current?.limit ?? {}, key)
    }
    if (field.startsWith("capabilities.")) {
      const key = field.slice("capabilities.".length)
      return Object.prototype.hasOwnProperty.call(current?.capabilities ?? {}, key)
    }
    return Object.prototype.hasOwnProperty.call(current ?? {}, field)
  }

  const valueFor = (field: string): unknown => {
    if (field === "limit.context" || field === "limit.output" || field === "limit.input") {
      const key = field.slice("limit.".length) as "context" | "output" | "input"
      return (current?.limit as Record<string, unknown> | undefined)?.[key] ?? defaults?.limit[key]
    }
    if (field === "capabilities.tools") return (current?.capabilities as Record<string, unknown> | undefined)?.tools ?? defaults?.capabilities.tools
    return current?.[field] ?? defaults?.[field as "name" | "reasoning" | "attachment"]
  }

  const displayValue = (field: string): string => {
    const value = valueFor(field)
    if (value === undefined) return "unknown"
    if (typeof value === "boolean") return value ? "on" : "off"
    return String(value)
  }

  const fieldTitle = (title: string, field: string): string => {
    return `${title}${hasOverride(field) ? " *" : ""} · ${displayValue(field)}`
  }

  const field = await context.ui.dialog.select({
    title: "Edit model override",
    placeholder: "Choose a field",
    options: [
      { title: fieldTitle("Display name", "name"), value: "name" },
      { title: fieldTitle("Context limit", "limit.context"), value: "limit.context" },
      { title: fieldTitle("Output limit", "limit.output"), value: "limit.output" },
      { title: fieldTitle("Input limit", "limit.input"), value: "limit.input" },
      { title: fieldTitle("Reasoning support", "reasoning"), value: "reasoning" },
      { title: fieldTitle("Tool support", "capabilities.tools"), value: "capabilities.tools" },
      { title: fieldTitle("Attachment support", "attachment"), value: "attachment" },
    ],
  })
  if (!field) return

  const currentValue = valueFor(field)

  let raw: string | undefined
  if (field === "reasoning" || field === "attachment" || field === "capabilities.tools") {
    const value = await context.ui.dialog.select({
      title: `Set ${field}`,
      current: currentValue as boolean | undefined,
      options: [
        { title: "Enabled", value: true },
        { title: "Disabled", value: false },
      ],
    })
    if (value === undefined) return
    raw = String(value as boolean)
  } else {
    raw = await context.ui.dialog.prompt({
      title: `Set ${field}`,
      value: currentValue === undefined ? undefined : String(currentValue),
      placeholder: field === "name" ? "Model display name" : "Positive number",
    })
    if (raw === undefined) return
  }

  let value: unknown = raw
  if (field === "reasoning" || field === "attachment" || field === "capabilities.tools") value = raw === "true"
  if (field.startsWith("limit.")) {
    const numericValue = Number(raw)
    value = numericValue
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      await context.ui.dialog.alert({ title: "Invalid override", message: "Limit must be a positive number." })
      return
    }
  }

  const patch: Record<string, unknown> = existing?.patch ? structuredClone(existing.patch) : {}
  if (field.startsWith("limit.")) {
    patch.limit = { ...(patch.limit as Record<string, unknown> | undefined), [field.slice("limit.".length)]: value }
  } else if (field.startsWith("capabilities.")) {
    patch.capabilities = { ...(patch.capabilities as Record<string, unknown> | undefined), [field.slice("capabilities.".length)]: value }
  } else {
    patch[field] = value
  }

  const rpc = context.client.rpc(DiscoveryRpcDefinition) as unknown as {
    overrideSet(input: unknown, options: unknown): Promise<{ success: boolean }>
  }
  await rpc.overrideSet({ providerID, modelID, patch, enabled: true }, { location: context.location })
  context.ui.toast.show({ title: "Models Discovery", message: "Override saved and provider reloaded.", variant: "success" })
}

export default defineTuiPlugin({
  id: "opencode.models-discovery",
  setup: async (context) => {
    const rpc = context.client.rpc(DiscoveryRpcDefinition)
    const getLocation = () => context.location ?? context.data?.location?.default()

    let unsubscribeDiscoveryFailed: (() => void) | undefined
    if ((rpc as unknown as { events?: { on?: Function } }).events?.on) {
      try {
        unsubscribeDiscoveryFailed = (rpc as unknown as { events: { on: Function } }).events.on(
          "discoveryFailed",
          (event: unknown) => {
            const payload = (event as { data?: { providerID?: string; status?: number; message?: string; isAuthError?: boolean } })?.data
            if (!payload) return
            const isAuth = payload.isAuthError || payload.status === 401 || payload.status === 403
            context.ui.toast.show({
              title: "Models Discovery",
              message: isAuth
                ? `Authentication failed for provider "${payload.providerID}" (${payload.status ?? 401}). Check your API key with /connect.`
                : `Model discovery failed for provider "${payload.providerID}": ${payload.message}`,
              variant: "error",
            })
          },
        )
      } catch {
        // Event subscription is optional if host doesn't support rpc events
      }
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "models-discovery.console",
          title: "Models Discovery: Console",
          description: "Browse models and manage discovery caches",
          slash: {
            name: "models-discovery-console",
            arguments: true,
          },
          palette: true,
            run: async (input?: string) => {
              const raw = typeof input === "string" ? input.trim() : ""
            const providerMatch = raw.match(/(?:^|\s)(?:--provider(?:-id)?|provider(?:-id)?)(?:=|\s+)([^\s]+)/i)
            const providerID = providerMatch?.[1]
            const browseMode = /^browse(?:\s|$)/i.test(raw)
            const statusMode = /^status(?:\s|$)/i.test(raw)
            const location = getLocation()

            try {
              if (!providerID && !statusMode && !browseMode) {
                const action = await context.ui.dialog.select({
                  title: "Models Discovery Console",
                  placeholder: "Choose an operation",
                  options: [
                    {
                      title: "Browse Models",
                      value: "browse",
                      description: "Browse providers, models, and resolved model details",
                    },
                    {
                      title: "Cache Operations",
                      value: "cache",
                      description: "Inspect, refresh, or clear discovery caches",
                    },
                  ],
                })
                if (action === undefined) return
                if (action === "cache") {
                  await context.keymap.dispatch("models-discovery.cache", "")
                  return
                }
              }
              let result = (await rpc.status(
                { details: true, ...(providerID ? { providerID } : {}) },
                { location },
              )) as RpcStatusOutput
              if (result.providers.length === 0) {
                await context.ui.dialog.alert({
                  title: "Models Discovery Console",
                  message: result.report,
                })
                return
              }
              const reloadStatus = async (): Promise<RpcStatusOutput> => (await rpc.status(
                { details: true, ...(providerID ? { providerID } : {}) },
                { location },
              )) as RpcStatusOutput

              while (true) {
                const selected = await context.ui.dialog.select({
                  title: "Models Discovery: Providers",
                  placeholder: "Select a provider",
                  options: result.providers.map((provider) => {
                    const errorBadge = provider.error ? (provider.error.isAuthError ? " [Auth Error]" : " [Error]") : ""
                    return {
                      title: `${provider.id} | ${provider.name} | ${provider.modelCount} models${errorBadge}`,
                      value: provider.id,
                      description: provider.error?.message,
                    }
                  }),
                })
                if (selected === undefined) return
                let provider = result.providers.find((entry) => entry.id === selected)
                if (!provider) return
                if (provider.error) {
                  await context.ui.dialog.alert({
                    title: `${provider.name ?? provider.id} Error`,
                    message: provider.error.isAuthError
                      ? `${provider.error.message}\n\nPlease check or re-enter your API key using /connect.`
                      : provider.error.message,
                  })
                }
                if (provider.models.length === 0) {
                  if (!provider.error) {
                    await context.ui.dialog.alert({ title: provider.name, message: "No discovered models for this provider." })
                  }
                  continue
                }
                  while (true) {
                    const modelIndex = await context.ui.dialog.select({
                    title: `${provider.id} | ${provider.name}: Models (* = overridden)`,
                    placeholder: "Select a model to inspect (* = overridden)",
                    options: [
                      { title: "← Back to providers", value: -1 },
                      ...provider.models.map((model, index) => ({
                        title: `${model.id}${model.override ? " *" : ""} | ${model.name}`,
                        value: index,
                      })),
                    ],
                  })
                  if (modelIndex === undefined) return
                  if (modelIndex === -1) break
                  const model = provider.models[modelIndex]
                  if (!model) return
                  const action = await context.ui.dialog.select({
                    title: `${provider.id} / ${model.id}`,
                    placeholder: "Choose a model operation",
                    options: [
                      { title: "View details", value: "details", description: "Show resolved model metadata" },
                      { title: "Edit override", value: "edit", description: "Change supported model metadata" },
                      ...(model.override ? [{ title: "Delete override", value: "delete", description: "Restore discovered metadata" }] : []),
                      { title: "← Back to models", value: "back" },
                    ],
                  })
                  if (action === undefined || action === "details" || action === (-1 as unknown as string)) {
                    await context.ui.dialog.alert({
                      title: `${provider.id} / ${model.id}`,
                      message: model.detail,
                    })
                  } else if (action === "edit") {
                    await editModelOverride({ ...context, location }, provider.id, model.id, model.override, model.defaultValues)
                    result = await reloadStatus()
                    provider = result.providers.find((entry) => entry.id === selected)
                    if (!provider) return
                    continue
                  } else if (action === "delete" && model.override) {
                    const confirmed = await context.ui.dialog.confirm({
                      title: "Delete model override?",
                      message: `Remove the override for ${provider.id}/${model.id}?`,
                      label: { confirm: "Delete", cancel: "Cancel" },
                    })
                    if (confirmed) {
                      await (rpc as unknown as { overrideDelete(input: unknown, options: unknown): Promise<{ success: boolean }> }).overrideDelete(
                        { providerID: provider.id, modelID: model.id },
                        { location },
                      )
                      context.ui.toast.show({ title: "Models Discovery", message: "Override deleted.", variant: "success" })
                      result = await reloadStatus()
                      provider = result.providers.find((entry) => entry.id === selected)
                      if (!provider) return
                      continue
                    }
                  }
                }
              }
            } catch (error) {
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Status lookup failed: ${formatError(error)}`,
                variant: "error",
              })
            }
          },
        },
        {
          id: "models-discovery.refresh",
          title: "Models Discovery: Refresh",
          description: "Refresh models discovered from configured providers (optional: --force)",
          slash: {
            name: "models-discovery-refresh",
            arguments: true,
          },
          palette: true,
          run: async (input?: string) => {
            const raw = typeof input === "string" ? input.trim().toLowerCase() : ""
            const force = raw.includes("force")
            const location = getLocation()
            try {
              const result = (await rpc.refresh({ force }, { location })) as RpcRefreshOutput
              const failures = result.failures ?? []
              if (failures.length > 0) {
                const authFailures = failures.filter((f) => f.isAuthError || f.status === 401 || f.status === 403)
                if (result.models === 0) {
                  const message = authFailures.length > 0
                    ? `Authentication failed for ${authFailures.map((f) => f.providerID).join(", ")}. Check your API key with /connect.`
                    : `Discovery failed: ${failures.map((f) => `${f.providerID} (${f.message})`).join(", ")}`
                  context.ui.toast.show({
                    title: "Models Discovery",
                    message,
                    variant: "error",
                  })
                } else {
                  const message = authFailures.length > 0
                    ? `Discovered ${result.models} models, but auth failed for: ${authFailures.map((f) => f.providerID).join(", ")}.`
                    : `Discovered ${result.models} models, with errors for: ${failures.map((f) => f.providerID).join(", ")}.`
                  context.ui.toast.show({
                    title: "Models Discovery",
                    message,
                    variant: "warning",
                  })
                }
              } else {
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Discovered ${result.models} models across ${result.providers} providers${force ? " (bypassed cache)" : ""}.`,
                  variant: "success",
                })
              }
            } catch (error) {
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Refresh failed: ${formatError(error)}`,
                variant: "error",
              })
            }
          },
        },
        {
          id: "models-discovery.cache",
          title: "Models Discovery: Cache Operations (internal)",
          description: "Inspect or clear discovery cache entries",
          run: async (input?: string) => {
            const raw = typeof input === "string" ? input.trim().toLowerCase() : ""
            const location = getLocation()

            try {
              let action: string | undefined
              if (raw.includes("inspect") || raw === "status") {
                action = "inspect"
              } else if (raw.includes("refresh") || raw.includes("force")) {
                action = "refresh"
              } else if (raw.includes("clear-all") || (raw.includes("clear") && raw.includes("all"))) {
                action = "clear-all"
              } else if (raw.includes("clear")) {
                action = "clear-one"
              } else if (context.ui?.dialog) {
                action = await context.ui.dialog.select({
                  title: "Models Discovery Cache",
                  placeholder: "Choose a cache action",
                  options: [
                    {
                      title: "Inspect Cache Status",
                      value: "inspect",
                      description: "View status, TTL, and cached models across configured providers",
                    },
                    {
                      title: "Force Refresh (Bypass Cache)",
                      value: "refresh",
                      description: "Trigger discovery refresh immediately and bypass all cached models",
                    },
                    {
                      title: "Clear Provider Cache",
                      value: "clear-one",
                      description: "Select a specific provider and remove its cached discovery records",
                    },
                    {
                      title: "Clear All Discovery Caches",
                      value: "clear-all",
                      description: "Clear discovery caches for all configured providers",
                    },
                  ],
                })
              }

              if (!action) return

              if (action === "inspect") {
                const inspect = (await rpc.cacheInspect({}, { location })) as RpcCacheInspectOutput
                if (inspect.entries.length === 0) {
                  if (context.ui?.dialog?.alert) {
                    await context.ui.dialog.alert({
                      title: "Discovery Cache Status",
                      message: "No configured discovery providers found.",
                    })
                  } else {
                    context.ui.toast.show({
                      title: "Discovery Cache Status",
                      message: "No configured discovery providers found.",
                      variant: "info",
                    })
                  }
                  return
                }

                const summary = inspect.entries
                  .map((entry) => {
                    const parts = [
                      `Provider: ${entry.providerID}`,
                      `Status: ${entry.status}`,
                      entry.modelCount !== undefined ? `Models: ${entry.modelCount}` : undefined,
                      entry.ttlSeconds !== undefined ? `TTL: ${entry.ttlSeconds}s` : undefined,
                      entry.fetchedAt ? `Fetched: ${entry.fetchedAt}` : undefined,
                    ].filter(Boolean)
                    return parts.join(" | ")
                  })
                  .join("\n")

                if (context.ui?.dialog?.alert) {
                  await context.ui.dialog.alert({
                    title: "Discovery Cache Status",
                    message: summary,
                  })
                } else {
                  context.ui.toast.show({
                    title: "Discovery Cache Status",
                    message: summary,
                    variant: "info",
                  })
                }
              } else if (action === "refresh") {
                const result = (await rpc.refresh({ force: true }, { location })) as RpcRefreshOutput
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Discovered ${result.models} models across ${result.providers} providers (bypassed cache).`,
                  variant: "success",
                })
              } else if (action === "clear-one") {
                const inspect = (await rpc.cacheInspect({}, { location })) as RpcCacheInspectOutput
                if (inspect.entries.length === 0) {
                  context.ui.toast.show({
                    title: "Models Discovery",
                    message: "No discovery providers available to clear.",
                    variant: "info",
                  })
                  return
                }

                let selectedProvider: string | undefined
                if (context.ui?.dialog?.select) {
                  selectedProvider = await context.ui.dialog.select({
                    title: "Clear Provider Cache",
                    placeholder: "Select provider to clear",
                    options: inspect.entries.map((e) => ({
                      title: e.providerID,
                      value: e.providerID,
                      description: `Status: ${e.status}${e.modelCount !== undefined ? ` (${e.modelCount} models)` : ""}`,
                    })),
                  })
                } else {
                  selectedProvider = inspect.entries[0]?.providerID
                }

                if (!selectedProvider) return

                if (context.ui?.dialog?.confirm) {
                  const confirmed = await context.ui.dialog.confirm({
                    title: "Clear Provider Cache",
                    message: `Are you sure you want to clear the discovery cache for provider "${selectedProvider}"?`,
                    label: { confirm: "Clear", cancel: "Cancel" },
                  })
                  if (!confirmed) return
                }

                await rpc.cacheClear({ providerID: selectedProvider }, { location })
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Cleared discovery cache for provider "${selectedProvider}".`,
                  variant: "success",
                })
              } else if (action === "clear-all") {
                if (context.ui?.dialog?.confirm) {
                  const confirmed = await context.ui.dialog.confirm({
                    title: "Clear All Discovery Caches",
                    message: "Are you sure you want to clear discovery caches for all configured providers?",
                    label: { confirm: "Clear All", cancel: "Cancel" },
                  })
                  if (!confirmed) return
                }

                const result = (await rpc.cacheClear({}, { location })) as RpcCacheClearOutput
                context.ui.toast.show({
                  title: "Models Discovery",
                  message: `Cleared all discovery caches (${result.cleared} providers cleared).`,
                  variant: "success",
                })
              }
            } catch (error) {
              context.ui.toast.show({
                title: "Models Discovery",
                message: `Cache operation failed: ${formatError(error)}`,
                variant: "error",
              })
            }
          },
        },
      ],
    }))

    return () => {
      unsubscribeDiscoveryFailed?.()
    }
  },
})
