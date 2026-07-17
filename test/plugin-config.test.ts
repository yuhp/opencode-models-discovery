import { describe, it, expect } from 'vitest'
import { isSupportedModelInfoFormat } from '../src/utils/model-info'

describe('JSON config struct parsing', () => {
  function parse(json: string): Record<string, unknown> {
    return JSON.parse(json)
  }

  it.each([
    { json: '{"modelInfoFormat":"litellm"}', expected: true },
    { json: '{"modelInfoFormat":"models.dev"}', expected: true },
    { json: '{"modelInfoFormat":"vllm"}', expected: true },
    { json: '{"modelInfoFormat":"bogus"}', expected: false },
  ])('handles modelInfoFormat=$json', ({ json, expected }) => {
    const config = parse(json)
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(expected)
  })

  it('handles absence of modelInfoFormat', () => {
    const config = parse('{"enabled":true}')
    expect(config.modelInfoFormat).toBeUndefined()
  })

  it('handles a full provider discovery config from JSON', () => {
    const json = `{
      "enabled": true,
      "endpoint": "/v1/models",
      "modelInfoEndpoint": "/v1/model/info",
      "modelInfoFormat": "litellm",
      "filterNonChat": true,
      "models": {
        "includeBy": [{ "field": "id", "match": "^chat-" }]
      }
    }`
    const config = parse(json)
    expect(config.modelInfoFormat).toBe('litellm')
    expect(isSupportedModelInfoFormat(config.modelInfoFormat)).toBe(true)
  })
})
