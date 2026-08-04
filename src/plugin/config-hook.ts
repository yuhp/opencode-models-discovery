import { ToastNotifier } from '../ui/toast-notifier'
import { validateConfig } from '../utils/validation'
import { enhanceConfig } from './enhance-config'
import { hasLegacyGlobalDiscoveryConfig } from '../types/plugin-config'
import type { LegacyGlobalConfigWarningController } from './legacy-config-warning'
import { injectConfigCommand, injectMigrationCommand } from './commands'
import type { PluginLogger } from './logger'
import type { PluginInput } from '@opencode-ai/plugin'
import type { PluginConfig } from '../types/plugin-config'

export function createConfigHook(
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig,
  legacyGlobalConfigWarning: LegacyGlobalConfigWarningController,
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
      toastNotifier.error("Plugin configuration is invalid", "Configuration Error").catch(() => { })
      return
    }

    if (validation.warnings.length > 0) {
      logger.warn('Config warnings', { warnings: validation.warnings })
    }

    injectConfigCommand(config, logger)

    if (hasLegacyGlobalDiscoveryConfig(pluginConfig)) {
      legacyGlobalConfigWarning.markPending(logger)
      injectMigrationCommand(config, logger)
    }

    try {
      await enhanceConfig(
        config,
        client,
        toastNotifier,
        pluginConfig,
        logger.child({ category: 'discovery' })
      )
    } catch (error) {
      logger.error('Config enhancement failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
