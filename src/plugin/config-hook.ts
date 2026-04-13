import { ToastNotifier } from '../ui/toast-notifier'
import { validateConfig } from '../utils/validation'
import { enhanceConfig } from './enhance-config'
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
      return
    }

    const validation = validateConfig(config)
    if (!validation.isValid) {
      logger.error('Invalid config provided', { errors: validation.errors })
      toastNotifier.error("Plugin configuration is invalid", "Configuration Error").catch(() => {})
      return
    }

    if (validation.warnings.length > 0) {
      logger.warn('Config warnings', { warnings: validation.warnings })
    }

    if (pluginConfig.discovery?.enabled === false) {
      logger.info('Discovery disabled by configuration')
      return
    }

    const discoveryPromise = enhanceConfig(
      config,
      client,
      toastNotifier,
      pluginConfig,
      logger.child({ category: 'discovery' })
    )
    const timeoutMs = 5000

    try {
      await Promise.race([
        discoveryPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), timeoutMs)
        })
      ])
    } catch (error) {
      logger.error('Config enhancement failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
