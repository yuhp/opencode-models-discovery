import { promises as fs } from 'node:fs'
import path from 'node:path'
import { xdgData } from 'xdg-basedir'
import { ToastNotifier } from '../ui/toast-notifier'
import { normalizeProviderOriginForCache, discoverModelsFromProvider, canDiscoverModels, DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/openai-compatible-api'
import { isDiscoveredRawModel } from '../core/model-types'
import { type ModelEnricher } from '../utils/model-info'
import { DEFAULT_CACHE_TTL_SECONDS, getDefaultDiscoveryConfigFromEnv, getProviderModelFieldFilters, getProviderModelRegexFilter, shouldDiscoverProviderWithOverride } from '../types/plugin-config'
import { isInventoryFresh, mergeModelOverride, ProviderModelStore, type ProviderModelState } from './provider-model-store'
import type { PluginLogger } from './logger'
import type { ModelEnrichmentResult } from '../core/model-enrichment'
import type { PluginInput } from '@opencode-ai/plugin'
import type { PluginConfig } from '../types/plugin-config'
import { discoverModelDrafts } from '../core/discovery-pipeline'
import { mapToV1Model } from '../core/model-mapper'
import { resolveModelInfoEnricher } from '../core/enricher-resolver'

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
const defaultProviderModelStore = new ProviderModelStore()

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

function createCachedModelEnricher(models: Record<string, Record<string, unknown> & { id: string }>): ModelEnricher {
  return {
    enrich(model): ModelEnrichmentResult {
      const cached = models[model.id]
      if (!cached) return {}

      const limit = cached.limit
      const modalities = cached.modalities
      const capabilities = cached.capabilities
      return {
        ...(capabilities && typeof capabilities === 'object' ? { capabilities: capabilities as Record<string, unknown> } : {}),
        ...(limit && typeof limit === 'object' && typeof (limit as Record<string, unknown>).context === 'number' && typeof (limit as Record<string, unknown>).output === 'number'
          ? { limit: limit as ModelEnrichmentResult['limit'] }
          : {}),
        ...(modalities && typeof modalities === 'object' ? { modalities: modalities as ModelEnrichmentResult['modalities'] } : {}),
        ...(typeof cached.reasoning === 'boolean' ? { reasoning: cached.reasoning } : {}),
        ...(typeof cached.attachment === 'boolean' ? { attachment: cached.attachment } : {}),
        ...(typeof cached.tool_call === 'boolean' ? { toolCall: cached.tool_call } : {}),
        ...(typeof cached.structured_output === 'boolean' ? { structuredOutput: cached.structured_output } : {}),
        ...(typeof cached.temperature === 'boolean' ? { temperature: cached.temperature } : {}),
        ...(cached.cost !== undefined ? { cost: cached.cost } : {}),
        ...(cached.variants !== undefined ? { variants: cached.variants } : {}),
        ...(cached.compatibility && typeof cached.compatibility === 'object' ? { compatibility: cached.compatibility as Record<string, unknown> } : {}),
      }
    },
  }
}

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
      const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
      const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
      const timeoutMs = providerDiscoveryConfig.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
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
        baseURL = normalizeProviderOriginForCache(p.options.baseURL)
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
      let reprocessPersistedModels = false
      let apiKey: string | undefined

      let models: unknown[] = []
      let discoveredModels: Record<string, any> = {}
      let cachedRawModels: Record<string, Record<string, unknown> & { id: string }> = {}
      if (cacheEnabled) {
        persistedState = await currentProviderModelStore.read(cacheIdentity)
        if (persistedState && isInventoryFresh(persistedState, ttlSeconds)) {
          discoveredModels = persistedState.models
          if (persistedState.rawModels) {
            models = Object.values(persistedState.rawModels)
            discoveredModels = {}
            reprocessPersistedModels = true
          }
          usingPersistedModels = true
        } else {
          apiKey = await getProviderApiKey(providerName, p, client, resolvedProvidersLoader, logger)
          const discovery = await discoverModelsFromProvider(baseURL, apiKey, modelsEndpoint, timeoutMs)
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

          models = discovery.models.filter(isDiscoveredRawModel)
        }
      } else {
        apiKey = await getProviderApiKey(providerName, p, client, resolvedProvidersLoader, logger)
        const discovery = await discoverModelsFromProvider(baseURL, apiKey, modelsEndpoint, timeoutMs)
        if (!discovery.ok) {
          logger.warn('Provider model discovery failed', {
            provider: providerName,
            baseURL,
            endpoint: modelsEndpoint,
          })
          continue
        }
        models = discovery.models.filter(isDiscoveredRawModel)
      }

      let modelInfoEnricher: ModelEnricher | undefined
      if (!usingPersistedModels) {
        modelInfoEnricher = await resolveModelInfoEnricher({
          baseURL,
          apiKey,
          providerName,
          logger: {
            warn: (message, context) => logger.warn(message, context),
            info: (message, context) => logger.info(message, context),
          },
        }, {
          format: modelInfoFormat,
          endpoint: providerDiscoveryConfig.modelInfoEndpoint,
          filterNonChat,
          timeoutMs,
        })
      }
      if (reprocessPersistedModels) {
        modelInfoEnricher = createCachedModelEnricher(persistedState?.models ?? {})
      }

      const existingModels = getExplicitModels(config, providerName, p.models || {})

      const hasProviderModelRegexFilter = !!providerDiscoveryConfig.models?.includeRegex?.length || !!providerDiscoveryConfig.models?.excludeRegex?.length
      const providerModelRegexFilter = getProviderModelRegexFilter(providerDiscoveryConfig, logger.child({ category: 'filtering' }))
      const providerModelFieldFilters = getProviderModelFieldFilters(providerDiscoveryConfig, logger.child({ category: 'filtering' }))
      const smartModelNameEnabled = providerDiscoveryConfig.smartModelName === true

      if (!usingPersistedModels || reprocessPersistedModels) {
        const drafts = discoverModelDrafts(models, {
          filter: {
            includeBy: providerModelFieldFilters.includeBy,
            excludeBy: providerModelFieldFilters.excludeBy,
            includeRegex: hasProviderModelRegexFilter ? providerModelRegexFilter.includeRegex : [],
            excludeRegex: hasProviderModelRegexFilter ? providerModelRegexFilter.excludeRegex : [],
          },
          smartModelName: smartModelNameEnabled,
          enricher: modelInfoEnricher,
          enrichmentContext: { filterNonChat },
        })
        for (const draft of drafts) {
          discoveredModels[draft.id] = mapToV1Model(draft)
          cachedRawModels[draft.id] = draft.raw
        }
      }

      if (cacheEnabled && !usingPersistedModels && !await currentProviderModelStore.saveModels(cacheIdentity, discoveredModels, persistedState, cachedRawModels)) {
        logger.debug('Could not persist discovered provider models', { provider: providerName })
      }

      const modelsWithOverrides = Object.fromEntries(Object.entries(discoveredModels).map(([modelID, model]) => [
        modelID,
        mergeModelOverride(model, persistedState?.overrides?.[modelID]),
      ]))
      const modelsWithExplicitConfig = Object.fromEntries(Object.entries(existingModels).map(([modelID, model]) => [
        modelID,
        modelID in modelsWithOverrides ? mergeModelOverride(modelsWithOverrides[modelID], model) : model,
      ]))

      p.models = {
        ...modelsWithOverrides,
        ...modelsWithExplicitConfig,
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
