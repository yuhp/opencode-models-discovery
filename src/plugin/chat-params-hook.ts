import { ToastNotifier } from '../ui/toast-notifier'
import type { PluginConfig } from '../types/plugin-config'

export function createChatParamsHook(toastNotifier: ToastNotifier, pluginConfig: PluginConfig) {
  return async (input: any, output: any) => {
    // Validation is disabled - only model discovery is enabled
    // Model validation causes false errors for cloud providers
  }
}
