import { describe, expect, it } from 'vitest'
import { ModelInfoFormat } from '../src/types/plugin-config'
import { createModelInfoEnricher } from '../src/utils/model-info'

describe('OmniRoute model info enricher', () => {
  it('maps documented inline limits, modalities, and capabilities', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.OmniRoute, null)
    const config: any = {
      id: 'oc/vision-model',
      modalities: { input: ['text'], output: ['text'] },
    }

    enricher!.applyModelInfo(config, config.id, {
      id: config.id,
      context_length: 128000,
      max_input_tokens: 120000,
      max_output_tokens: 8192,
      input_modalities: ['TEXT', 'IMAGE', 'SPEECH', 'unsupported'],
      output_modalities: ['TEXT'],
      capabilities: {
        attachment: true,
        reasoning: true,
        tool_calling: true,
        structured_output: true,
        temperature: false,
        vision: true,
      },
    })

    expect(config).toMatchObject({
      limit: { context: 128000, input: 120000, output: 8192 },
      modalities: { input: ['text', 'image', 'audio'], output: ['text'] },
      attachment: true,
      reasoning: true,
      tool_call: true,
      structured_output: true,
      temperature: false,
    })
  })

  it('uses vision as an image-input fallback without replacing default output modalities', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.OmniRoute, null)
    const config: any = {
      id: 'oc/vision-only',
      modalities: { input: ['text'], output: ['text'] },
    }

    enricher!.applyModelInfo(config, config.id, {
      id: config.id,
      capabilities: { vision: true },
    })

    expect(config.modalities).toEqual({ input: ['text', 'image'], output: ['text'] })
  })

  it('ignores malformed metadata and leaves incomplete limits unset', () => {
    const enricher = createModelInfoEnricher(ModelInfoFormat.OmniRoute, null)
    const config: any = {
      id: 'oc/partial',
      modalities: { input: ['text'], output: ['text'] },
    }

    enricher!.applyModelInfo(config, config.id, {
      id: config.id,
      context_length: 128000,
      max_input_tokens: '128000',
      input_modalities: ['unsupported', 1],
      output_modalities: [],
      capabilities: 'invalid',
    })

    expect(config).toEqual({
      id: 'oc/partial',
      modalities: { input: ['text'], output: ['text'] },
    })
  })
})
