import { Plugin } from '@opencode/plugin'
import { ModelDiscoveryPlugin } from './plugin/index.js'
import { setupV2 } from '../src-v2/index.js'

const combinedPlugin = {
  ...Plugin.define({
    id: 'opencode.models-discovery',
    setup: setupV2,
  }),
  server: ModelDiscoveryPlugin,
}

export { ModelDiscoveryPlugin }
export default combinedPlugin
