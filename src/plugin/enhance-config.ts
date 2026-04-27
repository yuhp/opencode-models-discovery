import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, discoverModelsFromProvider, autoDetectOpenAICompatibleProvider, canDiscoverModels } from '../utils/openai-compatible-api'
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

      const existingModels = p.models || {}
      const discoveredModels: Record<string, any> = {}
      let chatModelsCount = 0
      let embeddingModelsCount = 0

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

          const modelType = categorizeModel(model.id)
          const owner = extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: smartModelNameEnabled ? formatModelName(model) : model.id,
          }

          if (owner) {
            modelConfig.organizationOwner = owner
          }

          if (modelType === 'embedding') {
            embeddingModelsCount++
            modelConfig.modalities = {
              input: ["text"],
              output: ["embedding"]
            }
          } else if (modelType === 'chat') {
            chatModelsCount++
            modelConfig.modalities = {
              input: ["text", "image"],
              output: ["text"]
            }
          }

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

        if (chatModelsCount === 0 && embeddingModelsCount > 0) {
          // Provider only has embedding models
        }
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
