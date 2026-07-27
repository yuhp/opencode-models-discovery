import { promises as fs } from 'node:fs'
import path from 'node:path'
import { xdgData } from 'xdg-basedir'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, discoverModelsFromProvider, discoverModelInfoFromProvider, canDiscoverModels, isValidModel } from '../utils/openai-compatible-api'
import { createModelInfoEnricher, isSupportedModelInfoFormat, type ModelInfoEnricher } from '../utils/model-info'
import { DEFAULT_CACHE_TTL_SECONDS, getDefaultDiscoveryConfigFromEnv, getProviderModelFieldFilters, getProviderModelRegexFilter, shouldDiscoverModel, shouldDiscoverModelByFields, shouldDiscoverProviderWithOverride, ModelInfoFormat } from '../types/plugin-config'
import { fetchModelsDevData } from '../utils/models-dev-fetcher'
import { isInventoryFresh, mergeModelOverride, ProviderModelStore, type ProviderModelState } from './provider-model-store'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { OpenAIModel } from '../types'
import type { PluginConfig } from '../types/plugin-config'

interface DiscoveredProvider {
  name: string
  baseURL: string
  models: Record<string, any>
}

interface ResolvedProvider {
  id?: string
  key?: string
}

interface ResolvedProvidersLoader {
  promise?: Promise<Map<string, ResolvedProvider>>
}

interface OpenCodeAuth {
  type?: string
  key?: string
}

type HostClient = 'opencode' | 'mimocode'

const RESOLVED_PROVIDERS_TIMEOUT_MS = 250
const DEFAULT_LITELLM_MODEL_INFO_ENDPOINT = '/v1/model/info'
const defaultProviderModelStore = new ProviderModelStore()

function applyProviderModelInfo(modelConfig: any, model: OpenAIModel): void {
  const contextWindow = typeof model.context_window === 'number' && model.context_window > 0
    ? model.context_window
    : typeof model.max_context_window === 'number' && model.max_context_window > 0
      ? model.max_context_window
      : model.context_length
  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    modelConfig.limit = { ...modelConfig.limit, context: contextWindow }
    if (modelConfig.limit.input > contextWindow) delete modelConfig.limit.input
  }

  const reasoningLevels = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels
      .map((level) => typeof level === 'string' ? level : level?.effort)
      .filter((level): level is string => typeof level === 'string' && level.length > 0)
    : []
  if (reasoningLevels.length > 0) {
    modelConfig.reasoning = true
    modelConfig.variants = Object.fromEntries(
      reasoningLevels.map((level) => [level, { reasoningEffort: level }])
    )
  }

  if (typeof model.default_reasoning_level === 'string' && model.default_reasoning_level.length > 0) {
    modelConfig.options = {
      ...modelConfig.options,
      reasoningEffort: model.default_reasoning_level,
    }
  }

  const inputModalities = Array.isArray(model.input_modalities)
    ? model.input_modalities.filter((modality): modality is string => typeof modality === 'string')
    : []
  if (inputModalities.length > 0) {
    modelConfig.modalities = { ...modelConfig.modalities, input: inputModalities }
  }
}

function ensureModelLimitOutput(models: Record<string, any>): void {
  for (const model of Object.values(models)) {
    if (!model?.limit || typeof model.limit !== 'object' || Array.isArray(model.limit)) {
      continue
    }

    if (typeof model.limit.output !== 'number') {
      model.limit = { ...model.limit, output: 0 }
    }
  }
}

export const providerModelStoreTestUtils = {
  setStore(store: ProviderModelStore): void {
    currentProviderModelStore = store
  },
  resetStore(): void {
    currentProviderModelStore = defaultProviderModelStore
  },
}
let currentProviderModelStore = defaultProviderModelStore
const injectedModelsByConfig = new WeakMap<object, Map<string, Map<string, unknown>>>()

function getInjectedModels(config: object, providerID: string): Map<string, unknown> {
  return injectedModelsByConfig.get(config)?.get(providerID) ?? new Map()
}

function replaceInjectedModels(config: object, providerID: string, models: Record<string, unknown>): void {
  let providers = injectedModelsByConfig.get(config)
  if (!providers) {
    providers = new Map()
    injectedModelsByConfig.set(config, providers)
  }
  providers.set(providerID, new Map(Object.entries(models)))
}

function getExplicitModels(config: object, providerID: string, models: Record<string, any>): Record<string, any> {
  const injectedModels = getInjectedModels(config, providerID)
  return Object.fromEntries(Object.entries(models).filter(([modelID, model]) => injectedModels.get(modelID) !== model))
}

async function getResolvedProvidersByID(
  client: PluginInput['client'],
  logger: PluginLogger,
  timeoutMs: number = RESOLVED_PROVIDERS_TIMEOUT_MS
): Promise<Map<string, ResolvedProvider>> {
  try {
    const loadProviders = client.config?.providers
    if (typeof loadProviders !== 'function') {
      return new Map()
    }

    const result = await Promise.race([
      loadProviders.call(client.config),
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), timeoutMs)
      })
    ])

    if (!result) {
      logger.debug('Timed out loading resolved providers')
      return new Map()
    }

    const providers = result?.data?.providers
    if (!Array.isArray(providers)) {
      return new Map()
    }

    return new Map(
      providers
        .filter((provider: ResolvedProvider) => typeof provider?.id === 'string')
        .map((provider: ResolvedProvider) => [provider.id!, provider])
    )
  } catch (error) {
    logger.debug('Could not load resolved providers', {
      error: error instanceof Error ? error.message : String(error),
    })
    return new Map()
  }
}

function detectHostClient(): HostClient {
  if (process.env.OPENCODE === '1') {
    return 'opencode'
  }

  if (process.env.MIMOCODE === '1') {
    return 'mimocode'
  }

  return 'opencode'
}

function getHostAuthFile(): string | undefined {
  if (!xdgData) {
    return undefined
  }

  const hostClient = detectHostClient()
  return path.join(xdgData, hostClient, 'auth.json')
}

async function getOpenCodeAuth(providerName: string, logger: PluginLogger): Promise<OpenCodeAuth | undefined> {
  const normalizedProviderName = providerName.replace(/\/+$/, '')

  try {
    if (process.env.OPENCODE_AUTH_CONTENT) {
      const auths = JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, OpenCodeAuth>
      return auths[providerName] ?? auths[normalizedProviderName] ?? auths[`${normalizedProviderName}/`]
    }
  } catch (error) {
    logger.debug('Could not parse OPENCODE_AUTH_CONTENT', {
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const file = getHostAuthFile()
  if (file) {
    try {
      const auths = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, OpenCodeAuth>
      return auths[providerName] ?? auths[normalizedProviderName] ?? auths[`${normalizedProviderName}/`]
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        logger.debug('Could not read host auth store', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  return undefined
}

function getConfiguredApiKey(providerConfig: any): string | undefined {
  const explicitApiKey = providerConfig.options?.apiKey
  if (typeof explicitApiKey === 'string' && explicitApiKey.trim().length > 0) {
    return explicitApiKey
  }

  return undefined
}

async function getProviderApiKey(
  providerName: string,
  providerConfig: any,
  client: PluginInput['client'],
  loader: ResolvedProvidersLoader,
  logger: PluginLogger
): Promise<string | undefined> {
  const explicitApiKey = getConfiguredApiKey(providerConfig)
  if (explicitApiKey) {
    return explicitApiKey
  }

  loader.promise ??= getResolvedProvidersByID(client, logger)
  const resolvedProvider = (await loader.promise).get(providerName)

  if (typeof resolvedProvider?.key === 'string' && resolvedProvider.key.trim().length > 0) {
    return resolvedProvider.key
  }

  const auth = await getOpenCodeAuth(providerName, logger)
  if (auth?.type === 'api' && typeof auth.key === 'string' && auth.key.trim().length > 0) {
    return auth.key
  }

  return undefined
}

export async function enhanceConfig(
  config: any,
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig,
  logger: PluginLogger
): Promise<void> {
  try {
    const providers = config.provider || {}
    const openAICompatibleProviders: DiscoveredProvider[] = []
    const discoveryConfig = getDefaultDiscoveryConfigFromEnv(logger.child({ category: 'config' }))
    const defaultDiscoveryEnabled = discoveryConfig.enabled
    const resolvedProvidersLoader: ResolvedProvidersLoader = {}

    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const p = providerConfig as any
      ensureModelLimitOutput(p.models || {})
      const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
      const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
      const modelInfoFormat = providerDiscoveryConfig.modelInfoFormat
      const filterNonChat = providerDiscoveryConfig.filterNonChat !== false
      const forceDiscoveryEnabled = providerDiscoveryConfig.enabled === true

      if (!forceDiscoveryEnabled && !canDiscoverModels(p)) {
        continue
      }

      if (!shouldDiscoverProviderWithOverride(defaultDiscoveryEnabled, providerDiscoveryConfig)) {
        logger.debug(`Provider ${providerName} model discovery disabled by configuration`)
        continue
      }

      let baseURL: string
      let displayName = providerName

      if (p.options?.baseURL) {
        baseURL = normalizeBaseURL(p.options.baseURL)
      } else {
        continue
      }

      const cacheConfig = providerDiscoveryConfig.cache
      const cacheEnabled = cacheConfig?.enabled === true
      const ttlSeconds = cacheConfig?.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
      const cacheIdentity = {
        id: providerName,
        baseURL,
        endpoint: modelsEndpoint,
      }
      let persistedState: ProviderModelState | undefined
      let usingPersistedModels = false
      let apiKey: string | undefined

      let models: OpenAIModel[] = []
      let discoveredModels: Record<string, any> = {}
      if (cacheEnabled) {
        persistedState = await currentProviderModelStore.read(cacheIdentity)
        if (persistedState && isInventoryFresh(persistedState, ttlSeconds)) {
          discoveredModels = persistedState.models
          usingPersistedModels = true
        } else {
          apiKey = await getProviderApiKey(providerName, p, client, resolvedProvidersLoader, logger)
          const discovery = await discoverModelsFromProvider(baseURL, apiKey, modelsEndpoint)
          if (!discovery.ok) {
            const existingModels = getExplicitModels(config, providerName, p.models || {})
            p.models = existingModels
            replaceInjectedModels(config, providerName, {})
            logger.warn('Provider model discovery failed', {
              provider: providerName,
              baseURL,
              endpoint: modelsEndpoint,
            })
            continue
          }

          models = discovery.models.filter(isValidModel)
        }
      } else {
        apiKey = await getProviderApiKey(providerName, p, client, resolvedProvidersLoader, logger)
        const discovery = await discoverModelsFromProvider(baseURL, apiKey, modelsEndpoint)
        if (!discovery.ok) {
          logger.warn('Provider model discovery failed', {
            provider: providerName,
            baseURL,
            endpoint: modelsEndpoint,
          })
          continue
        }
        models = discovery.models.filter(isValidModel)
      }

      let modelInfoEnricher: ModelInfoEnricher | undefined
      if (!usingPersistedModels && modelInfoFormat && !isSupportedModelInfoFormat(modelInfoFormat)) {
        logger.warn('Unsupported provider model info format', {
          provider: providerName,
          format: modelInfoFormat,
        })
      } else if (!usingPersistedModels && modelInfoFormat === ModelInfoFormat.ModelsDev) {
        const modelsDevCache = await fetchModelsDevData()
        modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, modelsDevCache, { filterNonChat })
        logger.info('Loaded models.dev data', {
          provider: providerName,
          count: modelsDevCache.size,
        })
      } else if (!usingPersistedModels && modelInfoFormat === ModelInfoFormat.VLLM) {
        modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, null)
      } else if (!usingPersistedModels && modelInfoFormat === ModelInfoFormat.LiteLLM) {
        const modelInfoEndpoint = providerDiscoveryConfig.modelInfoEndpoint ?? DEFAULT_LITELLM_MODEL_INFO_ENDPOINT
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

      const existingModels = getExplicitModels(config, providerName, p.models || {})
      let chatModelsCount = 0

      const hasProviderModelRegexFilter = !!providerDiscoveryConfig.models?.includeRegex?.length || !!providerDiscoveryConfig.models?.excludeRegex?.length
      const providerModelRegexFilter = getProviderModelRegexFilter(providerDiscoveryConfig, logger.child({ category: 'filtering' }))
      const providerModelFieldFilters = getProviderModelFieldFilters(providerDiscoveryConfig, logger.child({ category: 'filtering' }))
      const smartModelNameEnabled = providerDiscoveryConfig.smartModelName === true

      if (!usingPersistedModels) {
        for (const model of models) {
          const modelKey = model.id
          if (!shouldDiscoverModelByFields(model, providerModelFieldFilters)) {
            continue
          }

          if (hasProviderModelRegexFilter && !shouldDiscoverModel(model.id, providerModelRegexFilter)) {
            continue
          }

          const modelType = categorizeModel(model.id)
          if (modelType === 'embedding') {
            continue
          }

          if (modelInfoEnricher?.shouldSkipModel(model.id)) {
            continue
          }

          const owner = extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: smartModelNameEnabled ? modelInfoEnricher?.getModelName?.(model.id) ?? formatModelName(model) : model.id,
          }

          if (owner) {
            modelConfig.organizationOwner = owner
          }

          if (modelType === 'chat') {
            chatModelsCount++
            modelConfig.modalities = {
              input: ["text"],
              output: ["text"]
            }
          }

          modelInfoEnricher?.applyModelInfo(modelConfig, model.id, model)
          applyProviderModelInfo(modelConfig, model)
          discoveredModels[modelKey] = modelConfig
        }

        if (cacheEnabled && !await currentProviderModelStore.saveModels(cacheIdentity, discoveredModels, persistedState)) {
          logger.debug('Could not persist discovered provider models', { provider: providerName })
        }
      }

      const modelsWithOverrides = Object.fromEntries(Object.entries(discoveredModels).map(([modelID, model]) => [
        modelID,
        mergeModelOverride(model, persistedState?.overrides?.[modelID]),
      ]))

      p.models = {
        ...modelsWithOverrides,
        ...existingModels,
      }
      replaceInjectedModels(config, providerName, modelsWithOverrides)

      if (Object.keys(modelsWithOverrides).length > 0) {
        openAICompatibleProviders.push({
          name: displayName,
          baseURL,
          models: modelsWithOverrides
        })
      }
    }

    if (openAICompatibleProviders.length > 0) {
      const totalModels = openAICompatibleProviders.reduce((sum, p) => sum + Object.keys(p.models).length, 0)
      logger.info('Provider model discovery completed', {
        providerCount: openAICompatibleProviders.length,
        modelCount: totalModels,
      })
    }

  } catch (error) {
    logger.error('Unexpected error in enhanceConfig', {
      error: error instanceof Error ? error.message : String(error),
    })
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => { })
  }
}
