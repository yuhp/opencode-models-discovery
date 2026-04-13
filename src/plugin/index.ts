import type { Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin"
import { ToastNotifier } from '../ui/toast-notifier'
import { createConfigHook } from './config-hook'
import { createEventHook } from './event-hook'
import { createChatParamsHook } from './chat-params-hook'
import { createPluginLogger } from './logger'
import { parsePluginConfig, type PluginConfig } from '../types/plugin-config'

export const ModelDiscoveryPlugin: Plugin = async (input: PluginInput, options?: PluginOptions) => {
  const { client } = input
  const logger = createPluginLogger(client, { category: 'plugin' })

  if (!client || typeof client !== 'object') {
    logger.error('Invalid client provided to plugin')
    return {
      config: async () => {},
      event: async () => {},
      "chat.params": async () => {}
    }
  }

  logger.info('Model discovery plugin initialized')

  const pluginConfig: PluginConfig = parsePluginConfig(options || {})

  if (pluginConfig.discovery?.enabled === false) {
    logger.info('Discovery disabled by configuration', { category: 'config' })
  }

  const toastNotifier = new ToastNotifier(client)

  return {
    config: createConfigHook(client, toastNotifier, pluginConfig, logger.child({ category: 'config' })),
    event: createEventHook(logger.child({ category: 'event' })),
    "chat.params": createChatParamsHook(toastNotifier, pluginConfig),
  }
}

export const LMStudioPlugin = ModelDiscoveryPlugin
