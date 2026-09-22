import { Model, Plugin } from "@opencode/plugin"
import type { CommandDefinition } from "@opencode/plugin/promise/command"
import { discoverProviderModels } from "./plugin/enhance-config"
import { createPluginLogger } from "./plugin/logger"
import { CONFIG_COMMAND_NAME, CONFIG_COMMAND_TEMPLATE, MIGRATION_COMMAND_NAME, MIGRATION_COMMAND_TEMPLATE } from "./plugin/commands"
import { hasLegacyGlobalDiscoveryConfig, parsePluginConfig } from "./types/plugin-config"

export default Plugin.define({
  id: "opencode-models-discovery",
  async setup(ctx) {
    const logger = createPluginLogger()

    logger.info('Model discovery plugin initialized', { opencodeVersion: ctx.app.version })

    const pluginConfig = parsePluginConfig(ctx.options as Record<string, unknown> | undefined)

    if (pluginConfig.discovery?.enabled === false) {
      logger.info('Discovery disabled by configuration', { category: 'config' })
    }

    // Per-provider discovery overrides supplied through plugin options. Merged over
    // normalized provider settings so users can tune discovery without editing provider blocks.
    const providerOverrides = (ctx.options.providers ?? {}) as Record<string, Record<string, unknown>>

    // Discovered model inventory per provider, captured BEFORE transforms are registered.
    // Transforms are synchronous callbacks; external data must be loaded ahead of time and
    // re-applied through reload() when that data changes.
    const discoveredByProvider = new Map<string, readonly Model.Info[]>()

    const runDiscovery = async (): Promise<void> => {
      const providers = (await ctx.provider.list()).data
      const results = new Map<string, readonly Model.Info[]>()

      for (const provider of providers) {
        const providerID = provider.id

        try {
          const settings = (provider.settings ?? {}) as Record<string, unknown>
          const fallback = providerOverrides[providerID] ?? {}
          const merged = { ...settings, ...fallback }

          // Log what shape normalization produced so we can adapt if modelsDiscovery is dropped.
          logger.info('Provider shape observed', {
            provider: providerID,
            settingsKeys: Object.keys(settings),
            baseURLType: typeof merged.baseURL,
            apiKeyConfigured: typeof merged.apiKey === 'string' && merged.apiKey.length > 0,
            modelsDiscoveryPresent: merged.modelsDiscovery !== undefined,
            fallbackApplied: Object.keys(fallback).length > 0,
          })

          const discoverable = hasDiscoverableBaseURL(merged) || hasModelsDiscoveryOptions(merged)
          if (!discoverable) {
            logger.debug('Provider has no discovery configuration', { provider: providerID })
            continue
          }

          const models = await discoverProviderModels({
            providerID,
            npm: provider.package,
            settings,
            fallback,
            logger,
          })

          results.set(providerID, models)
          logger.info('Provider model discovery completed', {
            provider: providerID,
            modelCount: models.length,
          })
        } catch (error) {
          // Do NOT fail the whole plugin if one provider errors - skip it and continue.
          logger.warn('Provider model discovery skipped after error', {
            provider: providerID,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      discoveredByProvider.clear()
      for (const [providerID, models] of results) {
        discoveredByProvider.set(providerID, models)
      }
    }

    // Serialize discovery runs so config-change events cannot interleave with setup discovery.
    let discoveryQueue: Promise<void> = Promise.resolve()
    const refreshDiscovery = (): Promise<void> => {
      discoveryQueue = discoveryQueue
        .then(runDiscovery)
        .then(() => ctx.provider.reload())
        .catch((error: unknown) => {
          logger.error('Provider discovery refresh failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
      return discoveryQueue
    }

    // 1. Load external data (and the persisted XDG discovery cache) before registering transforms.
    await refreshDiscovery()

    // 2. Register the provider transform: merge discovered models into each provider's source
    //    inventory while preserving the user's statically configured models.
    await ctx.provider.transform((editor) => {
      for (const record of editor.list()) {
        const discovered = discoveredByProvider.get(record.provider.id)
        if (!discovered || discovered.length === 0) {
          continue
        }

        const existing = [...record.models.values()]
        editor.models.set(record.provider.id, [...existing, ...discovered])

        logger.info('Merged discovered models into provider inventory', {
          provider: record.provider.id,
          discoveredCount: discovered.length,
          totalCount: existing.length + discovered.length,
        })
      }
    })

    // 3. Register helper commands. Big templates stay as constants; execute wraps them.
    const commands: CommandDefinition[] = [
      {
        name: CONFIG_COMMAND_NAME,
        description: 'Configure opencode-models-discovery',
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: CONFIG_COMMAND_TEMPLATE,
            delivery,
          })
        },
      },
    ]

    if (hasLegacyGlobalDiscoveryConfig(pluginConfig)) {
      logger.warn('Legacy global opencode-models-discovery config detected; registering migration command', {
        migrationCommand: `/${MIGRATION_COMMAND_NAME}`,
      })
      commands.push({
        name: MIGRATION_COMMAND_NAME,
        description: 'Migrate opencode-models-discovery config',
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: MIGRATION_COMMAND_TEMPLATE,
            delivery,
          })
        },
      })
    }

    await ctx.command.transform((editor) => {
      for (const command of commands) {
        editor.add(command)
      }
    })

    // 4. Re-run discovery when provider or config state changes, then replay transforms.
    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type === "provider.updated" || event.type === "config.updated") {
            logger.info('Provider/config change observed; re-running discovery', { type: event.type })
            await refreshDiscovery()
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          logger.error('Event subscription ended unexpectedly', {
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    })()

    // 5. Cleanup: abort the event stream; transforms are disposed automatically by the host.
    return () => {
      controller.abort()
    }
  },
})

function hasDiscoverableBaseURL(merged: Record<string, unknown>): boolean {
  return typeof merged.baseURL === 'string' && merged.baseURL.length > 0 && /\/v1(\/|$)/.test(merged.baseURL)
}

function hasModelsDiscoveryOptions(merged: Record<string, unknown>): boolean {
  const discovery = merged.modelsDiscovery as { enabled?: unknown; endpoint?: unknown } | undefined
  return discovery?.enabled === true || (typeof discovery?.endpoint === 'string' && discovery.endpoint.length > 0)
}