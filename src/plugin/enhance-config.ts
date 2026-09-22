import { promises as fs } from 'node:fs'
import path from 'node:path'
import { xdgData } from 'xdg-basedir'
import { Model, Provider } from '@opencode/plugin'
import { Money } from '@opencode/schema'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeProviderOriginForCache, discoverModelsFromProvider, discoverModelInfoFromProvider, canDiscoverModels, isValidModel, DEFAULT_REQUEST_TIMEOUT_MS } from '../utils/openai-compatible-api'
import { createModelInfoEnricher, isSupportedModelInfoFormat, type ModelInfoEnricher } from '../utils/model-info'
import { DEFAULT_CACHE_TTL_SECONDS, getDefaultDiscoveryConfigFromEnv, getProviderModelFieldFilters, getProviderModelRegexFilter, shouldDiscoverModel, shouldDiscoverModelByFields, shouldDiscoverProviderWithOverride, ModelInfoFormat } from '../types/plugin-config'
import { DEFAULT_MODELS_DEV_URL, fetchModelsDevData } from '../utils/models-dev-fetcher'
import { isInventoryFresh, mergeModelOverride, ProviderModelStore, type ProviderModelState } from './provider-model-store'
import type { PluginLogger } from './logger'
import type { OpenAIModel } from '../types'

const DEFAULT_LITELLM_MODEL_INFO_ENDPOINT = '/v1/model/info'
const DEFAULT_LMSTUDIO_MODELS_ENDPOINT = '/api/v1/models'
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

interface OpenCodeAuth {
  type?: string
  key?: string
}

type HostClient = 'opencode' | 'mimocode'

/**
 * Resolved provider view consumed by discovery. `settings` is the normalized
 * V2 provider settings object (V1 `options`), `fallback` is the per-provider
 * override map from plugin options, and `npm` is the provider npm package used
 * for automatic compatibility detection.
 */
export interface ProviderDiscoveryInput {
  providerID: string
  npm?: string
  settings: Record<string, unknown>
  fallback: Record<string, unknown>
  logger: PluginLogger
}

/** V2-shaped, mutable view used while assembling discovered Model.Info entries. */
interface MutableModelInfo {
  id: string
  modelID: string
  providerID: string
  name: string
  capabilities: { tools: boolean; input: string[]; output: string[] }
  variants: Array<{ id: string; settings?: Record<string, unknown>; headers?: Record<string, string>; body?: Record<string, unknown> }>
  time: { released: number }
  cost: Array<{ tier?: { type: 'context'; size: number }; input: unknown; output: unknown; cache: { read: unknown; write: unknown } }>
  status: string
  enabled: boolean
  limit: { context: number; input?: number; output: number }
  settings?: Record<string, unknown>
  headers?: Record<string, string>
  body?: Record<string, unknown>
}

export function discoverProviderModels(input: ProviderDiscoveryInput): Promise<Model.Info[]> {
  const { providerID, settings, fallback, logger } = input
  const discoveryLogger = logger.child({ category: 'discovery' })

  // Merge plugin-option overrides over normalized provider settings so users can
  // tune discovery without editing provider blocks.
  const merged = { ...settings, ...fallback }

  // Adapter view matching the shape the shared detection utilities expect
  // (npm package on `npm`, V1-style options on `options`).
  const p: any = {
    npm: input.npm,
    options: merged,
  }

  const providerDiscoveryConfig = (merged.modelsDiscovery ?? {}) as any
  const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
  const timeoutMs = providerDiscoveryConfig.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const modelInfoFormat = providerDiscoveryConfig.modelInfoFormat
  const filterNonChat = providerDiscoveryConfig.filterNonChat !== false
  const forceDiscoveryEnabled = providerDiscoveryConfig.enabled === true

  if (!forceDiscoveryEnabled && !canDiscoverModels(p)) {
    discoveryLogger.debug('Provider is not an auto-discoverable OpenAI-compatible provider', { provider: providerID })
    return Promise.resolve([])
  }

  if (!shouldDiscoverProviderWithOverride(getDefaultDiscoveryConfigFromEnv(discoveryLogger.child({ category: 'config' })).enabled, providerDiscoveryConfig)) {
    discoveryLogger.debug(`Provider ${providerID} model discovery disabled by configuration`)
    return Promise.resolve([])
  }

  if (typeof merged.baseURL !== 'string' || merged.baseURL.trim().length === 0) {
    discoveryLogger.debug('Provider has no baseURL; skipping discovery', { provider: providerID })
    return Promise.resolve([])
  }

  return runProviderDiscovery({
    providerID,
    providerConfig: p,
    discoveryConfig: providerDiscoveryConfig,
    baseURL: merged.baseURL as string,
    modelInfoFormat,
    filterNonChat,
    modelsEndpoint,
    timeoutMs,
    logger: discoveryLogger,
  })
}

interface ProviderDiscoveryRun {
  providerID: string
  providerConfig: any
  discoveryConfig: any
  baseURL: string
  modelInfoFormat?: ModelInfoFormat
  filterNonChat: boolean
  modelsEndpoint: string
  timeoutMs: number
  logger: PluginLogger
}

async function runProviderDiscovery(run: ProviderDiscoveryRun): Promise<Model.Info[]> {
  const { providerID, providerConfig, discoveryConfig, baseURL, modelInfoFormat, filterNonChat, modelsEndpoint, timeoutMs, logger } = run
  const cacheIdentity = {
    id: providerID,
    baseURL: normalizeProviderOriginForCache(baseURL),
    endpoint: modelsEndpoint,
  }
  const cacheConfig = discoveryConfig.cache
  const cacheEnabled = cacheConfig?.enabled === true
  const ttlSeconds = cacheConfig?.ttlSeconds ?? DEFAULT_CACHE_TTL_SECONDS
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
      apiKey = await getProviderApiKey(providerID, providerConfig, logger)
      const discovery = await discoverModelsFromProvider(cacheIdentity.baseURL, apiKey, modelsEndpoint, timeoutMs)
      if (!discovery.ok) {
        logger.warn('Provider model discovery failed', {
          provider: providerID,
          baseURL: cacheIdentity.baseURL,
          endpoint: modelsEndpoint,
        })
        return []
      }
      models = discovery.models.filter(isValidModel)
    }
  } else {
    apiKey = await getProviderApiKey(providerID, providerConfig, logger)
    const discovery = await discoverModelsFromProvider(cacheIdentity.baseURL, apiKey, modelsEndpoint, timeoutMs)
    if (!discovery.ok) {
      logger.warn('Provider model discovery failed', {
        provider: providerID,
        baseURL: cacheIdentity.baseURL,
        endpoint: modelsEndpoint,
      })
      return []
    }
    models = discovery.models.filter(isValidModel)
  }

  let modelInfoEnricher: ModelInfoEnricher | undefined
  if (!usingPersistedModels && modelInfoFormat && !isSupportedModelInfoFormat(modelInfoFormat)) {
    logger.warn('Unsupported provider model info format', {
      provider: providerID,
      format: modelInfoFormat,
    })
  } else if (!usingPersistedModels && modelInfoFormat === ModelInfoFormat.ModelsDev) {
    const modelInfoEndpoint = discoveryConfig.modelInfoEndpoint ?? DEFAULT_MODELS_DEV_URL
    const modelsDevCache = await fetchModelsDevData(modelInfoEndpoint)
    modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, modelsDevCache, { filterNonChat })
    logger.info('Loaded models.dev data', {
      provider: providerID,
      endpoint: modelInfoEndpoint,
      count: modelsDevCache.size,
    })
  } else if (!usingPersistedModels && (modelInfoFormat === ModelInfoFormat.Bifrost || modelInfoFormat === ModelInfoFormat.LlamaSwap || modelInfoFormat === ModelInfoFormat.OmniRoute || modelInfoFormat === ModelInfoFormat.VLLM)) {
    modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, null)
  } else if (!usingPersistedModels && modelInfoFormat === ModelInfoFormat.LMStudio) {
    const modelInfoEndpoint = discoveryConfig.modelInfoEndpoint ?? DEFAULT_LMSTUDIO_MODELS_ENDPOINT
    const modelInfoDiscovery = await discoverModelInfoFromProvider(cacheIdentity.baseURL, apiKey, modelInfoEndpoint, timeoutMs)
    if (modelInfoDiscovery.ok) {
      modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, modelInfoDiscovery.data)
    } else {
      logger.warn('Provider model info discovery failed', {
        provider: providerID,
        baseURL: cacheIdentity.baseURL,
        endpoint: modelInfoEndpoint,
        format: modelInfoFormat,
      })
    }
  } else if (!usingPersistedModels && modelInfoFormat === ModelInfoFormat.LiteLLM) {
    const modelInfoEndpoint = discoveryConfig.modelInfoEndpoint ?? DEFAULT_LITELLM_MODEL_INFO_ENDPOINT
    const modelInfoDiscovery = await discoverModelInfoFromProvider(cacheIdentity.baseURL, apiKey, modelInfoEndpoint, timeoutMs)
    if (modelInfoDiscovery.ok) {
      modelInfoEnricher = createModelInfoEnricher(modelInfoFormat, modelInfoDiscovery.data, { filterNonChat })
    } else {
      logger.warn('Provider model info discovery failed', {
        provider: providerID,
        baseURL: cacheIdentity.baseURL,
        endpoint: modelInfoEndpoint,
        format: modelInfoFormat,
      })
    }
  }

  const hasProviderModelRegexFilter = !!discoveryConfig.models?.includeRegex?.length || !!discoveryConfig.models?.excludeRegex?.length
  const providerModelRegexFilter = getProviderModelRegexFilter(discoveryConfig, logger.child({ category: 'filtering' }))
  const providerModelFieldFilters = getProviderModelFieldFilters(discoveryConfig, logger.child({ category: 'filtering' }))
  const smartModelNameEnabled = discoveryConfig.smartModelName === true

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
        name: smartModelNameEnabled ? modelInfoEnricher?.getModelName?.(model.id, model) ?? formatModelName(model) : model.id,
      }

      if (owner) {
        modelConfig.organizationOwner = owner
      }

      if (modelType === 'chat') {
        modelConfig.modalities = {
          input: ["text"],
          output: ["text"]
        }
      }

      modelInfoEnricher?.applyModelInfo(modelConfig, model.id, model)
      discoveredModels[modelKey] = modelConfig
    }

    if (cacheEnabled && !await currentProviderModelStore.saveModels(cacheIdentity, discoveredModels, persistedState)) {
      logger.debug('Could not persist discovered provider models', { provider: providerID })
    }
  }

  const modelsWithOverrides = Object.fromEntries(Object.entries(discoveredModels).map(([modelID, model]) => [
    modelID,
    mergeModelOverride(model, persistedState?.overrides?.[modelID]),
  ]))

  return toModelInfos(providerID, modelsWithOverrides as Record<string, Record<string, unknown> & { id: string }>)
}

function toModelInfos(providerID: string, models: Record<string, Record<string, unknown> & { id: string }>): Model.Info[] {
  const providerBrandID = Provider.ID.make(providerID)
  const result: Model.Info[] = []

  for (const model of Object.values(models)) {
    const modelID = model.id
    const info = Model.Info.default(providerBrandID, Model.ID.make(modelID))
    const draft = info as unknown as MutableModelInfo

    if (typeof model.name === 'string' && model.name.length > 0) {
      draft.name = model.name
    }

    const modalities = model.modalities as { input?: unknown; output?: unknown } | undefined
    if (modalities && Array.isArray(modalities.input)) {
      draft.capabilities.input = modalities.input.filter((item): item is string => typeof item === 'string')
    }
    if (modalities && Array.isArray(modalities.output)) {
      draft.capabilities.output = modalities.output.filter((item): item is string => typeof item === 'string')
    }

    if (typeof model.tool_call === 'boolean') {
      draft.capabilities.tools = model.tool_call
    }

    const limit = model.limit as { context?: unknown; input?: unknown; output?: unknown } | undefined
    if (limit && typeof limit.context === 'number' && typeof limit.output === 'number') {
      draft.limit.context = limit.context
      draft.limit.output = limit.output
      if (typeof limit.input === 'number') {
        draft.limit.input = limit.input
      }
    }

    if (model.variants && typeof model.variants === 'object' && !Array.isArray(model.variants)) {
      draft.variants = toModelVariants(model.variants as Record<string, Record<string, unknown>>)
    }

    if (model.cost && typeof model.cost === 'object' && !Array.isArray(model.cost)) {
      draft.cost = toModelCost(model.cost as Record<string, unknown>)
    }

    const settings: Record<string, unknown> = {}
    if (model.reasoning !== undefined) settings.reasoning = model.reasoning
    if (model.attachment !== undefined) settings.attachment = model.attachment
    if (model.structured_output !== undefined) settings.structured_output = model.structured_output
    if (model.temperature !== undefined) settings.temperature = model.temperature
    if (Object.keys(settings).length > 0) {
      draft.settings = settings
    }

    result.push(info)
  }

  return result
}

function toModelVariants(variants: Record<string, Record<string, unknown>>): MutableModelInfo['variants'] {
  return Object.entries(variants).map(([variantID, variantSettings]) => ({
    id: Model.VariantID.make(variantID),
    ...(Object.keys(variantSettings).length > 0 ? { settings: variantSettings } : {}),
  }))
}

function toModelCost(cost: Record<string, unknown>): MutableModelInfo['cost'] {
  const input = cost.input
  const output = cost.output
  if (typeof input !== 'number' || typeof output !== 'number') {
    return []
  }

  return [{
    input: Money.USDPerMillionTokens.make(input),
    output: Money.USDPerMillionTokens.make(output),
    cache: {
      read: typeof cost.cache_read === 'number' ? Money.USDPerMillionTokens.make(cost.cache_read) : Money.USDPerMillionTokens.zero,
      write: typeof cost.cache_write === 'number' ? Money.USDPerMillionTokens.make(cost.cache_write) : Money.USDPerMillionTokens.zero,
    },
  }]
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
  logger: PluginLogger
): Promise<string | undefined> {
  const explicitApiKey = getConfiguredApiKey(providerConfig)
  if (explicitApiKey) {
    return explicitApiKey
  }

  const auth = await getOpenCodeAuth(providerName, logger)
  if (auth?.type === 'api' && typeof auth.key === 'string' && auth.key.trim().length > 0) {
    return auth.key
  }

  return undefined
}