import { ToastNotifier } from '../ui/toast-notifier'
import { validateConfig } from '../utils/validation'
import { enhanceConfig, type EnhanceConfigContext } from './enhance-config'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { PluginConfig } from '../types/plugin-config'

export function createConfigHook(
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig,
  logger: PluginLogger
) {
  return async (config: any) => {
    if (config && (Object.isFrozen?.(config) || Object.isSealed?.(config))) {
      logger.warn('Config object is frozen or sealed; cannot modify directly')
      return config
    }

    const validation = validateConfig(config)
    if (!validation.isValid) {
      logger.error('Invalid config provided', { errors: validation.errors })
      toastNotifier.error("Plugin configuration is invalid", "Configuration Error").catch(() => { })
      return config
    }

    if (validation.warnings.length > 0) {
      logger.warn('Config warnings', { warnings: validation.warnings })
    }


    const mutationContext: EnhanceConfigContext = { allowConfigMutation: true }
    const discoveryPromise = enhanceConfig(
      config,
      client,
      toastNotifier,
      pluginConfig,
      logger.child({ category: 'discovery' }),
      mutationContext
    )
    const timeoutMs = 5000
    let timedOut = false

    try {
      await Promise.race([
        discoveryPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => {
            timedOut = true
            mutationContext.allowConfigMutation = false
            resolve()
          }, timeoutMs)
        }),
      ])
    } catch (error) {
      if (!timedOut) {
        logger.error('Config enhancement failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (timedOut) {
      discoveryPromise.catch((error) => {
        logger.warn('Background config enhancement failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }

    return config
  }
}
