import { ToastNotifier } from '../ui/toast-notifier'
import { isEmbeddingModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, discoverModelsFromProvider, discoverModelInfoFromProvider, autoDetectOpenAICompatibleProvider, canDiscoverModels } from '../utils/openai-compatible-api'
import { createModelInfoEnricher, isSupportedModelInfoFormat, type ModelInfoEnricher } from '../utils/model-info'
import { getProviderFilter, getDiscoveryConfig, getModelRegexFilter, getProviderModelRegexFilter, shouldDiscoverModel, shouldDiscoverProviderWithOverride } from '../types/plugin-config'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { OpenAIModel } from '../types'
import type { PluginConfig } from '../types/plugin-config'

interface DiscoveredProvider {
  name: string
  baseURL: string
  models: Record<string, any>
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
    const providerFilter = getProviderFilter(pluginConfig)
    const modelRegexFilter = getModelRegexFilter(pluginConfig, logger.child({ category: 'filtering' }))
    const discoveryConfig = getDiscoveryConfig(pluginConfig)
    const globalDiscoveryEnabled = discoveryConfig.enabled

    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const p = providerConfig as any
      const providerDiscoveryConfig = p.options?.modelsDiscovery ?? {}
      const modelsEndpoint = providerDiscoveryConfig.endpoint ?? '/v1/models'
      const modelInfoEndpoint = providerDiscoveryConfig.modelInfoEndpoint
      const modelInfoFormat = providerDiscoveryConfig.modelInfoFormat
      const filterNonChat = providerDiscoveryConfig.filterNonChat !== false
      const forceDiscoveryEnabled = providerDiscoveryConfig.enabled === true

      if (!forceDiscoveryEnabled && !canDiscoverModels(p)) {
        continue
      }

      if (!shouldDiscoverProviderWithOverride(providerName, providerFilter, globalDiscoveryEnabled, providerDiscoveryConfig)) {
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

      const apiKey = p.options?.apiKey

      let models: OpenAIModel[]
      const discovery = await discoverModelsFromProvider(baseURL, apiKey, modelsEndpoint)
      if (!discovery.ok) {
        logger.warn('Provider model discovery failed', {
          provider: providerName,
          baseURL,
          endpoint: modelsEndpoint,
        })
        continue
      }

      models = discovery.models

      if (models.length === 0) {
        continue
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
      const discoveredModels: Record<string, any> = {}

      const hasProviderModelRegexFilter = !!providerDiscoveryConfig.models?.includeRegex?.length || !!providerDiscoveryConfig.models?.excludeRegex?.length
      const providerModelRegexFilter = getProviderModelRegexFilter(providerDiscoveryConfig, logger.child({ category: 'filtering' }))
      let smartModelNameEnabled = providerDiscoveryConfig.smartModelName
      if (smartModelNameEnabled === undefined) {
        smartModelNameEnabled = pluginConfig.smartModelName
      }

      for (const model of models) {
        const modelKey = model.id
        if (!existingModels[modelKey]) {
          const activeModelRegexFilter = hasProviderModelRegexFilter ? providerModelRegexFilter : modelRegexFilter
          if (!shouldDiscoverModel(model.id, activeModelRegexFilter)) {
            continue
          }

          if (modelInfoEnricher?.shouldSkipModel(model.id)) {
            continue
          }

          if (isEmbeddingModel(model.id)) {
            continue
          }

          const owner = model.owned_by || extractModelOwner(model.id)
          const modelName = model.name || (smartModelNameEnabled ? formatModelName(model) : model.id)
          const modelConfig: any = {
            id: model.id,
            name: modelName,
          }

          if (owner) {
            modelConfig.organizationOwner = owner
          }

          modelConfig.modalities = {
            input: model.capabilities?.vision === true ? ["text", "image", "video"] : ["text"],
            output: ["text"]
          }
          modelConfig.attachment = model.capabilities?.vision === true
          modelConfig.temperature = true

          if (model.capabilities?.reasoning === true) {
            modelConfig.reasoning = true
          }

          if (model.capabilities?.tool_call === true) {
            modelConfig.tool_call = true
          }

          if (typeof model.context_length === 'number' && model.context_length > 0) {
            modelConfig.limit = {
              context: model.context_length,
              input: model.context_length,
              output: typeof model.max_output_tokens === 'number' && model.max_output_tokens > 0
                ? model.max_output_tokens
                : model.context_length,
            }
          }

          if (model.pricing && (model.pricing.input || model.pricing.output)) {
            modelConfig.cost = {
              input: model.pricing.input ?? 0,
              output: model.pricing.output ?? 0,
            }
            if (model.pricing.cache_read != null) {
              modelConfig.cost.cache_read = model.pricing.cache_read
            }
            if (model.pricing.cache_write != null) {
              modelConfig.cost.cache_write = model.pricing.cache_write
            }
          }

          if (model.created && model.created > 1609459200) {
            const date = new Date(model.created * 1000)
            modelConfig.release_date = date.toISOString().split('T')[0]
          }

          modelInfoEnricher?.applyModelInfo(modelConfig, model.id)

          discoveredModels[modelKey] = modelConfig
        }
      }

      if (Object.keys(discoveredModels).length > 0) {
        p.models = {
          ...existingModels,
          ...discoveredModels,
        }

        openAICompatibleProviders.push({
          name: displayName,
          baseURL,
          models: discoveredModels
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

    if (Object.keys(providers).length === 0) {
      const detected = await autoDetectOpenAICompatibleProvider()
      if (detected) {
        logger.info('Detected OpenAI-compatible provider but found no configured providers', {
          provider: detected.name,
          baseURL: detected.baseURL,
        })
      }
    }

  } catch (error) {
    logger.error('Unexpected error in enhanceConfig', {
      error: error instanceof Error ? error.message : String(error),
    })
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => { })
  }
}
