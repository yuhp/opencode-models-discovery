import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, discoverModelsFromProvider, discoverModelInfoFromProvider, autoDetectOpenAICompatibleProvider, canDiscoverModels } from '../utils/openai-compatible-api'
import { createModelInfoEnricher, isSupportedModelInfoFormat, type ModelInfoEnricher } from '../utils/model-info'
import { getProviderFilter, getDiscoveryConfig, getModelRegexFilter, getProviderModelRegexFilter, shouldDiscoverModel, shouldDiscoverProviderWithOverride, type PluginConfig, type ProviderDiscoveryConfig } from '../types/plugin-config'
import { createModelCache, isCacheFresh, providerCacheKey, type CachedProviderModels, type ModelCache, type ModelCacheData } from '../cache/model-cache'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { OpenAIModel } from '../types'

interface DiscoveredProvider {
  name: string
  baseURL: string
  models: Record<string, any>
}

export interface EnhanceConfigContext {
  allowConfigMutation: boolean
}

function resolveCacheConfig(pluginConfig: PluginConfig): { enabled: boolean; ttl: number; path: string | undefined } {
  const c = pluginConfig.cache
  return {
    enabled: c?.enabled ?? true,
    ttl: c?.ttl ?? 3_600_000,
    path: c?.path,
  }
}

function buildProviderConfigHash(
  providerDiscoveryConfig: ProviderDiscoveryConfig,
  pluginConfig: PluginConfig
): string {
  const hasProviderModelRegexFilter =
    !!providerDiscoveryConfig.models?.includeRegex?.length ||
    !!providerDiscoveryConfig.models?.excludeRegex?.length

  let smartModelNameEnabled = providerDiscoveryConfig.smartModelName
  if (smartModelNameEnabled === undefined) {
    smartModelNameEnabled = pluginConfig.smartModelName
  }

  return JSON.stringify({
    smartModelName: smartModelNameEnabled ?? false,
    modelInfoEndpoint: providerDiscoveryConfig.modelInfoEndpoint ?? '',
    modelInfoFormat: providerDiscoveryConfig.modelInfoFormat ?? '',
    filterNonChat: providerDiscoveryConfig.filterNonChat !== false,
    filters: hasProviderModelRegexFilter
      ? {
          includeRegex: providerDiscoveryConfig.models?.includeRegex ?? [],
          excludeRegex: providerDiscoveryConfig.models?.excludeRegex ?? [],
        }
      : {
          includeRegex: pluginConfig.models?.includeRegex ?? [],
          excludeRegex: pluginConfig.models?.excludeRegex ?? [],
        },
  })
}

function buildProviderKey(
  p: any,
  modelsEndpoint: string,
  pluginConfig: PluginConfig
): string {
  const baseURL = normalizeBaseURL(p.options?.baseURL ?? '')
  const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
  const configHash = buildProviderConfigHash(providerDiscoveryConfig, pluginConfig)
  return `${providerCacheKey(baseURL, modelsEndpoint, p.options?.apiKey)}|${configHash}`
}

function shouldUseProviderDiscovery(
  providerName: string,
  p: any,
  pluginConfig: PluginConfig,
  logger: PluginLogger
): boolean {
  if (!p || typeof p !== 'object') {
    return false
  }

  const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
  const forceDiscoveryEnabled = providerDiscoveryConfig.enabled === true

  if (!p.options?.baseURL) {
    return false
  }

  if (!forceDiscoveryEnabled && !canDiscoverModels(p)) {
    return false
  }

  const providerFilter = getProviderFilter(pluginConfig)
  const discoveryConfig = getDiscoveryConfig(pluginConfig)
  if (!shouldDiscoverProviderWithOverride(providerName, providerFilter, discoveryConfig.enabled, providerDiscoveryConfig)) {
    logger.debug(`Provider ${providerName} model discovery disabled by configuration`)
    return false
  }

  return true
}

function mergeCachedModels(
  providers: Record<string, unknown>,
  cached: ModelCacheData,
  pluginConfig: PluginConfig,
  logger: PluginLogger
): number {
  let mergedCount = 0

  for (const [providerName, providerConfig] of Object.entries(providers)) {
    const p = providerConfig as any
    if (!shouldUseProviderDiscovery(providerName, p, pluginConfig, logger)) {
      continue
    }

    const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
    const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
    const cachedEntry = cached.providers[providerName]

    if (!cachedEntry?.models || Object.keys(cachedEntry.models).length === 0) {
      continue
    }

    const expectedKey = buildProviderKey(p, modelsEndpoint, pluginConfig)
    if (cachedEntry.key !== expectedKey) {
      logger.debug('Cache key mismatch, skipping provider cache', {
        provider: providerName,
        expectedKey,
        cachedKey: cachedEntry.key,
      })
      continue
    }

    p.models = { ...cachedEntry.models, ...(p.models || {}) }
    mergedCount += Object.keys(cachedEntry.models).length
  }

  return mergedCount
}

async function discoverProviders(
  config: any,
  pluginConfig: PluginConfig,
  logger: PluginLogger,
  context: EnhanceConfigContext
): Promise<DiscoveredProvider[]> {
  const providers = config.provider || {}
  const openAICompatibleProviders: DiscoveredProvider[] = []
  const modelRegexFilter = getModelRegexFilter(pluginConfig, logger.child({ category: 'filtering' }))
  const discoveryTasks: Promise<void>[] = []

  for (const [providerName, providerConfig] of Object.entries(providers)) {
    const p = providerConfig as any
    if (!shouldUseProviderDiscovery(providerName, p, pluginConfig, logger)) {
      continue
    }

    const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
    const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
    const modelInfoEndpoint = providerDiscoveryConfig.modelInfoEndpoint
    const modelInfoFormat = providerDiscoveryConfig.modelInfoFormat
    const filterNonChat = providerDiscoveryConfig.filterNonChat !== false

    let baseURL: string
    const displayName = providerName

    if (p.options?.baseURL) {
      baseURL = normalizeBaseURL(p.options.baseURL)
    } else {
      continue
    }

    const apiKey = p.options?.apiKey

    const task = (async () => {
      let models: OpenAIModel[]
      const discovery = await discoverModelsFromProvider(baseURL, apiKey, modelsEndpoint)
      if (!discovery.ok) {
        logger.warn('Provider model discovery failed', {
          provider: providerName,
          baseURL,
          endpoint: modelsEndpoint,
        })
        return
      }

      models = discovery.models

      if (models.length === 0) {
        return
      }

      let modelInfoEnricher: ModelInfoEnricher | undefined
      if (modelInfoFormat && !isSupportedModelInfoFormat(modelInfoFormat)) {
        logger.warn('Unsupported provider model info format', {
          provider: providerName,
          format: modelInfoFormat,
        })
      } else if (typeof modelInfoEndpoint === 'string' && modelInfoEndpoint.length > 0 && modelInfoFormat) {
        const modelInfoDiscovery = await discoverModelInfoFromProvider(baseURL, apiKey, modelInfoEndpoint)
        if (modelInfoDiscovery.ok) {
          modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, modelInfoDiscovery.data, { filterNonChat })
        } else {
          logger.warn('Provider model info discovery failed', {
            provider: providerName,
            baseURL,
            endpoint: modelInfoEndpoint,
            format: modelInfoFormat,
          })
        }
      }

      const existingModels = p.models || {}
      const modelsToAdd: Record<string, any> = {}
      const cacheModels: Record<string, any> = {}
      let chatModelsCount = 0

      const hasProviderModelRegexFilter =
        !!providerDiscoveryConfig.models?.includeRegex?.length ||
        !!providerDiscoveryConfig.models?.excludeRegex?.length
      const providerModelRegexFilter = getProviderModelRegexFilter(providerDiscoveryConfig, logger.child({ category: 'filtering' }))
      let smartModelNameEnabled = providerDiscoveryConfig.smartModelName
      if (smartModelNameEnabled === undefined) {
        smartModelNameEnabled = pluginConfig.smartModelName
      }

      for (const model of models) {
        const modelKey = model.id
        const activeModelRegexFilter = hasProviderModelRegexFilter ? providerModelRegexFilter : modelRegexFilter
        if (!shouldDiscoverModel(model.id, activeModelRegexFilter)) {
          continue
        }

        if (modelInfoEnricher?.shouldSkipModel(model.id)) {
          continue
        }

        const modelType = categorizeModel(model.id)
        if (modelType === 'embedding') {
          continue
        }

        const owner = extractModelOwner(model.id)
        const modelConfig: any = {
          id: model.id,
          name: smartModelNameEnabled ? formatModelName(model) : model.id,
        }

        if (owner) {
          modelConfig.organizationOwner = owner
        }

        if (modelType === 'chat') {
          chatModelsCount++
          modelConfig.modalities = {
            input: ['text', 'image'],
            output: ['text'],
          }
        }

        modelInfoEnricher?.applyModelInfo(modelConfig, model.id)

        cacheModels[modelKey] = modelConfig
        if (!existingModels[modelKey]) {
          modelsToAdd[modelKey] = modelConfig
        }
      }

      if (Object.keys(cacheModels).length > 0) {
        if (context.allowConfigMutation && Object.keys(modelsToAdd).length > 0) {
          p.models = {
            ...existingModels,
            ...modelsToAdd,
          }
        }

        openAICompatibleProviders.push({
          name: displayName,
          baseURL,
          models: cacheModels,
        })
      }
    })()

    discoveryTasks.push(task)
  }

  const results = await Promise.allSettled(discoveryTasks)
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      logger.warn('Provider model discovery task failed', {
        taskIndex: index,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  if (openAICompatibleProviders.length > 0) {
    const totalModels = openAICompatibleProviders.reduce((sum, provider) => sum + Object.keys(provider.models).length, 0)
    logger.info('Provider model discovery completed', {
      providerCount: openAICompatibleProviders.length,
      modelCount: totalModels,
      configMutation: context.allowConfigMutation,
    })
  }

  if (Object.keys(providers).length === 0) {
    const detected = await autoDetectOpenAICompatibleProvider()
    if (detected) {
      logger.info('Detected OpenAI-compatible provider but found no configured providers', {
        provider: detected.name,
        baseURL: detected.baseURL,
      })
    }
  }

  return openAICompatibleProviders
}

async function writeDiscoveredProvidersToCache(
  cache: ModelCache,
  config: any,
  discoveredProviders: DiscoveredProvider[],
  pluginConfig: PluginConfig
): Promise<void> {
  if (discoveredProviders.length === 0) {
    return
  }

  const cacheProviders: Record<string, CachedProviderModels> = {}
  for (const provider of discoveredProviders) {
    const p = config.provider?.[provider.name] as any
    const providerDiscoveryConfig = p?.options?.modelsDiscovery ?? {}
    const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
    cacheProviders[provider.name] = {
      key: buildProviderKey(p, modelsEndpoint, pluginConfig),
      models: provider.models,
      discoveredAt: new Date().toISOString(),
    }
  }

  await cache.setProviders(cacheProviders)
}

export async function enhanceConfig(
  config: any,
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig,
  logger: PluginLogger,
  context: EnhanceConfigContext = { allowConfigMutation: true }
): Promise<void> {
  const cacheCfg = resolveCacheConfig(pluginConfig)
  const cache = createModelCache({
    ttl: cacheCfg.ttl,
    path: cacheCfg.path,
    log: (msg, extra) => logger.debug(msg, extra ?? {}),
  })

  try {
    const providers = config.provider || {}
    if (cacheCfg.enabled) {
      const cached = await cache.load()

      if (cached && isCacheFresh(cached, { ttl: cacheCfg.ttl })) {
        const mergedCount = mergeCachedModels(providers, cached, pluginConfig, logger)
        if (mergedCount > 0) {
          logger.info('Using cached model discovery', {
            providerCount: Object.keys(cached.providers).length,
            modelCount: mergedCount,
          })
          return
        }
        logger.debug('Fresh cache has no matching provider entries, discovering models')
      } else if (cached) {
        const mergedCount = mergeCachedModels(providers, cached, pluginConfig, logger)
        if (mergedCount > 0) {
          logger.info('Cache is stale, using cached models and refreshing in background', {
            age: Date.now() - new Date(cached.timestamp).getTime(),
            modelCount: mergedCount,
          })

          const backgroundContext: EnhanceConfigContext = { allowConfigMutation: false }
          void discoverProviders(config, pluginConfig, logger, backgroundContext)
            .then((discoveredProviders) => writeDiscoveredProvidersToCache(cache, config, discoveredProviders, pluginConfig))
            .catch((error) => {
              logger.warn('Background cache refresh failed', {
                error: error instanceof Error ? error.message : String(error),
              })
            })

          return
        }
        logger.info('Cache is stale with no matching provider entries, discovering models', {
          age: Date.now() - new Date(cached.timestamp).getTime(),
        })
      }
    }

    const discoveredProviders = await discoverProviders(config, pluginConfig, logger, context)

    if (cacheCfg.enabled) {
      await writeDiscoveredProvidersToCache(cache, config, discoveredProviders, pluginConfig)
    }
  } catch (error) {
    logger.error('Unexpected error in enhanceConfig', {
      error: error instanceof Error ? error.message : String(error),
    })
    toastNotifier.warning('Plugin configuration failed', 'Configuration Error').catch(() => {})
  }
}
