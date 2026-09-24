import combinedPlugin, { ModelDiscoveryPlugin } from '../src/index.ts'

describe('combined V1/V2 entrypoint', () => {
  it('exposes both host adapters from the default export', () => {
    expect(combinedPlugin.id).toBe('opencode.models-discovery')
    expect(combinedPlugin.setup).toBeTypeOf('function')
    expect(combinedPlugin.server).toBe(ModelDiscoveryPlugin)
  })
})
