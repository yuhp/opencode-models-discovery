import { ModelStatusCache } from '../cache/model-status-cache'
import { ToastNotifier } from '../ui/toast-notifier'
import { categorizeModel, formatModelName, extractModelOwner } from '../utils'
import { normalizeBaseURL, checkProviderHealth, discoverModelsFromProvider, autoDetectOpenAICompatibleProvider, canDiscoverModels } from '../utils/openai-compatible-api'
import { getProviderFilter, getDiscoveryConfig, getModelRegexFilter, shouldDiscoverModel, shouldDiscoverProvider } from '../types/plugin-config'
import type { PluginInput } from '@opencode-ai/plugin'
import type { OpenAIModel } from '../types'
import type { PluginConfig } from '../types/plugin-config'

const modelStatusCache = new ModelStatusCache()

interface DiscoveredProvider {
  name: string
  baseURL: string
  models: Record<string, any>
}

export async function enhanceConfig(
  config: any,
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig
): Promise<void> {
  modelStatusCache.invalidateAll()
  
  try {
    const providers = config.provider || {}
    const openAICompatibleProviders: DiscoveredProvider[] = []
    const providerFilter = getProviderFilter(pluginConfig)
    const modelRegexFilter = getModelRegexFilter(pluginConfig)
    const discoveryConfig = getDiscoveryConfig(pluginConfig)

    for (const [providerName, providerConfig] of Object.entries(providers)) {
      const p = providerConfig as any
      
      if (!canDiscoverModels(p)) {
        continue
      }

      if (!shouldDiscoverProvider(providerName, providerFilter)) {
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

      const isHealthy = await checkProviderHealth(baseURL, apiKey)
      if (!isHealthy) {
        // Provider offline - silent, this is normal for health checks
        continue
      }

      let models: OpenAIModel[]
      try {
        models = await discoverModelsFromProvider(baseURL, apiKey)
      } catch (error) {
        continue
      }

      if (models.length === 0) {
        continue
      }

      const existingModels = p.models || {}
      const discoveredModels: Record<string, any> = {}
      let chatModelsCount = 0
      let embeddingModelsCount = 0

      for (const model of models) {
        const modelKey = model.id

        if (!existingModels[modelKey]) {
          if (!shouldDiscoverModel(model.id, modelRegexFilter)) {
            continue
          }

          const modelType = categorizeModel(model.id)
          const owner = extractModelOwner(model.id)
          const modelConfig: any = {
            id: model.id,
            name: formatModelName(model),
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
      // Discovery complete - models are now available
    }

    if (Object.keys(providers).length === 0) {
      const detected = await autoDetectOpenAICompatibleProvider()
      if (detected) {
        // Auto-detection found a provider, but no config exists
      }
    }

    try {
      for (const [providerName, providerConfig] of Object.entries(providers)) {
        const p = providerConfig as any
        if (!canDiscoverModels(p) || !shouldDiscoverProvider(providerName, providerFilter)) {
          continue
        }
        if (p.options?.baseURL) {
          const baseURL = normalizeBaseURL(p.options.baseURL)
          if (discoveryConfig.ttl) {
            modelStatusCache.setTTL(baseURL, discoveryConfig.ttl)
          }
          if (!modelStatusCache.isValid(baseURL)) {
            await modelStatusCache.getModels(baseURL, async () => {
              return await discoverModelsFromProvider(baseURL).then(models => models.map(m => m.id))
            })
          }
        }
      }
    } catch (error) {
    }
  } catch (error) {
    console.error("[opencode-model-discovery] Unexpected error in enhanceConfig:", error)
    toastNotifier.warning("Plugin configuration failed", "Configuration Error").catch(() => {})
  }
}
