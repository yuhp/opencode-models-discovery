import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { ToastNotifier } from '../ui/toast-notifier'
import { createConfigHook } from './config-hook'
import { createEventHook } from './event-hook'
import { createChatParamsHook } from './chat-params-hook'
import { parsePluginConfig, type PluginConfig } from '../types/plugin-config'

export const ModelDiscoveryPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  console.log("[opencode-model-discovery] Model discovery plugin initialized")

  const { client } = input

  if (!client || typeof client !== 'object') {
    console.error("[opencode-model-discovery] Invalid client provided to plugin")
    return {
      config: async () => {},
      event: async () => {},
      "chat.params": async () => {}
    }
  }

  const pluginConfig: PluginConfig = parsePluginConfig(options || {})

  if (pluginConfig.discovery?.enabled === false) {
    console.log("[opencode-model-discovery] Discovery disabled by configuration")
  }

  const toastNotifier = new ToastNotifier(client)

  return {
    config: createConfigHook(client, toastNotifier, pluginConfig),
    event: createEventHook(),
    "chat.params": createChatParamsHook(toastNotifier, pluginConfig),
  }
}

export const LMStudioPlugin = ModelDiscoveryPlugin
