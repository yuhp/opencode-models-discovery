import { Plugin } from '@opencode/plugin'
import { ModelDiscoveryPlugin } from './plugin/index.js'
import { setupV2 } from './v2/index.js'

export const combinedPlugin = {
  ...Plugin.define({
    id: 'opencode.models-discovery',
    setup: setupV2,
  }),
  server: ModelDiscoveryPlugin,
}

export { ModelDiscoveryPlugin, setupV2 }
