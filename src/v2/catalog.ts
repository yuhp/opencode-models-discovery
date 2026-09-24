import { Model, Provider, type Plugin } from "@opencode/plugin"

export interface DiscoveredV2Model {
  readonly id: string
  readonly modelID: string
  readonly name: string
  readonly capabilities: {
    readonly tools: boolean
    readonly input: string[]
    readonly output: string[]
  }
  readonly limit: {
    readonly context: number
    readonly output: number
    readonly input?: number
  }
  readonly variants?: Array<{ readonly id: string; readonly settings: Record<string, unknown> }>
  readonly compatibility?: Record<string, unknown>
  readonly reasoning?: boolean
  readonly attachment?: boolean
  readonly cost?: unknown
}

export type Inventory = Map<string, Map<string, DiscoveredV2Model>>

export interface ConfiguredProvider {
  readonly id: string
  readonly name?: string
  readonly package: string
  readonly settings: Record<string, unknown>
}

type ProviderContext = Pick<Plugin.Context, "provider">

export interface ProviderController {
  readonly transform: (editor: Parameters<Plugin.Context["provider"]["transform"]>[0] extends (editor: infer Draft) => void ? Draft : never) => void
  readonly replaceInventory: (next: Inventory) => Promise<void>
  readonly status: () => { providers: number; models: number }
}

function copyInventory(inventory: Inventory): Inventory {
  return new Map([...inventory].map(([providerID, models]) => [providerID, new Map(models)]))
}

export function createProviderController(
  ctx: ProviderContext,
  configured: readonly ConfiguredProvider[],
  integrationID: (providerID: string) => string,
): ProviderController {
  let inventory: Inventory = new Map()

  const transform: ProviderController["transform"] = (editor) => {
    for (const provider of configured) {
      const providerID = Provider.ID.make(provider.id)
      const current = editor.get(providerID)
      if (!current) {
        editor.add({
          info: {
            ...Provider.Info.empty(providerID),
            name: provider.name ?? provider.id,
            package: provider.package,
            settings: provider.settings,
            integrationID: integrationID(provider.id) as never,
            activation: "enabled",
          },
          models: [],
        })
      }

      const models = inventory.get(provider.id)
      if (!models) continue
      const source = editor.get(providerID)
      const existing = source ? [...source.models.values()] : []
      const existingIDs = new Set(existing.map((model) => String(model.id)))
      editor.models.set(providerID, [
        ...existing,
        ...[...models.values()].filter((model) => !existingIDs.has(model.id)).map((model) => Object.assign(
          Model.Info.default(providerID, Model.ID.make(model.modelID) as Model.ID),
          model,
        )),
      ])
    }
  }

  return {
    transform,
    async replaceInventory(next) {
      inventory = copyInventory(next)
      await ctx.provider.reload()
    },
    status() {
      return {
        providers: inventory.size,
        models: [...inventory.values()].reduce((total, models) => total + models.size, 0),
      }
    },
  }
}
