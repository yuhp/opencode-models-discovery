import { ToastNotifier } from '../ui/toast-notifier'
import { validateConfig } from '../utils/validation'
import { enhanceConfig } from './enhance-config'
import type { PluginInput } from '@opencode-ai/plugin'
import type { PluginConfig } from '../types/plugin-config'

export function createConfigHook(
  client: PluginInput['client'],
  toastNotifier: ToastNotifier,
  pluginConfig: PluginConfig
) {
  return async (config: any) => {
    if (config && (Object.isFrozen?.(config) || Object.isSealed?.(config))) {
      console.warn("[opencode-model-discovery] Config object is frozen/sealed - cannot modify directly")
      return
    }

    const validation = validateConfig(config)
    if (!validation.isValid) {
      console.error("[opencode-model-discovery] Invalid config provided:", validation.errors)
      toastNotifier.error("Plugin configuration is invalid", "Configuration Error").catch(() => {})
      return
    }

    if (validation.warnings.length > 0) {
      console.warn("[opencode-model-discovery] Config warnings:", validation.warnings)
    }

    if (pluginConfig.discovery?.enabled === false) {
      console.log("[opencode-model-discovery] Discovery disabled by configuration")
      return
    }

    const startTime = Date.now()
    const discoveryPromise = enhanceConfig(config, client, toastNotifier, pluginConfig)
    const timeoutMs = 5000

    try {
      await Promise.race([
        discoveryPromise,
        new Promise<void>((resolve) => {
          setTimeout(() => resolve(), timeoutMs)
        })
      ])
    } catch (error) {
      console.error("[opencode-model-discovery] Config enhancement failed:", error)
    }
  }
}