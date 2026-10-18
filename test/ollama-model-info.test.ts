import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createOllamaEnricher } from '../src/utils/model-info/ollama'
import { resolveModelInfoEnricher } from '../src/core/enricher-resolver'
import { discoverModelDrafts } from '../src/core/discovery-pipeline'
import { mapToV1Model } from '../src/core/model-mapper'
import { ModelInfoFormat } from '../src/types/plugin-config'

const showGemmaBody: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/ollama/show-gemma.json', import.meta.url), 'utf8'),
)

describe('native Ollama enricher', () => {
  it('parses family-keyed model_info context length from a /api/show body', () => {
    const result = createOllamaEnricher(new Map([['gemma4', showGemmaBody]]))
      .enrich({ id: 'gemma4' }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 131072, output: 32000 })
  })

  it('prefers the details.family-prefixed key among multiple .context_length keys', () => {
    const result = createOllamaEnricher(new Map([['gemma4', showGemmaBody]]))
      .enrich({ id: 'gemma4' }, { filterNonChat: true })

    expect(result.limit?.context).toBe(131072)
  })

  it('falls back to top-level context_length when model_info has no usable .context_length key', () => {
    const result = createOllamaEnricher(new Map([['m', { model_info: {}, context_length: 8192 }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.limit?.context).toBe(8192)
  })

  it('resolves num_ctx from the parameters string when no context_length source exists', () => {
    const result = createOllamaEnricher(new Map([['m', { parameters: 'num_ctx 4096 num_predict -1 stop x' }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.limit).toEqual({ context: 4096, output: 4096 })
  })

  it('accepts num_ctx line variants in the parameters string', () => {
    const unquoted = createOllamaEnricher(new Map([['m', { parameters: 'num_ctx: 8192' }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })
    const quoted = createOllamaEnricher(new Map([['m', { parameters: '"num_ctx": 16384' }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(unquoted.limit?.context).toBe(8192)
    expect(quoted.limit?.context).toBe(16384)
  })

  it('prefers a valid num_ctx over model_info and top-level context_length sources', () => {
    const body = {
      details: { family: 'gemma4' },
      model_info: { 'gemma4.context_length': 131072, 'qwen35.context_length': 262144 },
      context_length: 512,
      parameters: 'num_ctx 64000',
    }
    const result = createOllamaEnricher(new Map([['gemma4', body]]))
      .enrich({ id: 'gemma4' }, { filterNonChat: true })

    expect(result.limit?.context).toBe(64000)
  })

  it('falls back to the family-keyed context_length when num_ctx is not usable', () => {
    const result = createOllamaEnricher(new Map([['m', {
      details: { family: 'gemma4' },
      model_info: { 'gemma4.context_length': 131072 },
      parameters: 'num_ctx 0',
    }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.limit?.context).toBe(131072)
  })

  it('sets no limit when all context sources are missing', () => {
    const body = {
      ...(showGemmaBody as Record<string, unknown>),
      model_info: { 'gemma4.block_count': 35 },
      parameters: 'stop x',
    }
    const result = createOllamaEnricher(new Map([['gemma4', body]]))
      .enrich({ id: 'gemma4' }, { filterNonChat: true })

    expect(result.limit).toBeUndefined()
  })

  it('ignores non-positive and non-numeric context sources', () => {
    const result = createOllamaEnricher(new Map([['m', {
      model_info: { 'gemma4.context_length': 0 },
      context_length: -1,
      parameters: 'stop x',
    }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.limit).toBeUndefined()
  })

  it('rejects degenerate num_ctx values in the parameters string', () => {
    const zero = createOllamaEnricher(new Map([['m', { parameters: 'num_ctx 0' }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })
    const negative = createOllamaEnricher(new Map([['m', { parameters: 'num_ctx -4' }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(zero.limit).toBeUndefined()
    expect(negative.limit).toBeUndefined()
  })

  it('rescans other family keys when the details.family key is unusable', () => {
    const result = createOllamaEnricher(new Map([['m', {
      details: { family: 'gemma4' },
      model_info: { 'gemma4.context_length': 0, 'qwen35.context_length': 8192 },
    }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.limit?.context).toBe(8192)
  })

  it('maps capabilities to modalities and toolCall from the fixture', () => {
    const result = createOllamaEnricher(new Map([['gemma4', showGemmaBody]]))
      .enrich({ id: 'gemma4' }, { filterNonChat: true })

    expect(result.modalities).toEqual({ input: ['text', 'image', 'audio'], output: ['text'] })
    expect(result.toolCall).toBe(true)
    expect(result.reasoning).toBeUndefined()
  })

  it('maps the thinking capability to reasoning', () => {
    const result = createOllamaEnricher(new Map([['m', { capabilities: ['thinking'] }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.reasoning).toBe(true)
  })

  it('accepts the images alias as a vision marker', () => {
    const result = createOllamaEnricher(new Map([['m', { capabilities: ['images'] }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result.modalities?.input).toContain('image')
  })

  it('accepts function_calling and tool_calling as tool markers', () => {
    const functionCalling = createOllamaEnricher(new Map([['m', { capabilities: ['function_calling'] }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })
    const toolCalling = createOllamaEnricher(new Map([['m', { capabilities: ['tool_calling'] }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(functionCalling.toolCall).toBe(true)
    expect(toolCalling.toolCall).toBe(true)
  })

  it('ignores unknown capabilities and invents no fields', () => {
    const result = createOllamaEnricher(new Map([['m', { capabilities: ['completion', 'quantized'] }]]))
      .enrich({ id: 'm' }, { filterNonChat: true })

    expect(result).toEqual({})
  })

  it('does not enrich unknown models', () => {
    expect(createOllamaEnricher(new Map([['gemma4', showGemmaBody]]))
      .enrich({ id: 'qwen3' }, { filterNonChat: true })).toEqual({})
  })

  it('does not enrich non-object or empty show bodies', () => {
    const enricher = createOllamaEnricher(new Map<string, unknown>([
      ['broken', 'not-an-object'],
      ['null', null],
    ]))

    expect(enricher.enrich({ id: 'broken' }, { filterNonChat: true })).toEqual({})
    expect(enricher.enrich({ id: 'null' }, { filterNonChat: true })).toEqual({})
  })
})

describe('V1 enrichment flow', () => {
  it('consumes the resolver-produced Ollama enricher and populates V1 limit and tool_call', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => showGemmaBody })

    const enricher = await resolveModelInfoEnricher(
      { baseURL: 'http://127.0.0.1:11434/v1', fetcher },
      { format: ModelInfoFormat.Ollama, modelIds: ['gemma4:latest'] },
    )

    const drafts = discoverModelDrafts(
      [{ id: 'gemma4:latest', name: 'gemma4:latest', raw: { id: 'gemma4:latest' } }],
      {
        filter: { includeBy: [], excludeBy: [], includeRegex: [], excludeRegex: [] },
        smartModelName: false,
        enricher,
        enrichmentContext: { filterNonChat: true },
      },
    )

    expect(drafts).toHaveLength(1)
    const model = mapToV1Model(drafts[0]!)
    expect(model.limit?.context).toBe(131072)
    expect(model.tool_call).toBe(true)
    expect(model.reasoning).toBeUndefined()
  })
})
