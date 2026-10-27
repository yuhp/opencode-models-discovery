import type { ModelEnricher, ModelEnricherDeferredContext } from '../../core/model-enrichment'
import { createModelLimits } from '../../core/model-types'
import { buildModelInfoURL } from '../../core/model-info-url'

export const DEFAULT_OLLAMA_ENDPOINT = '/api/show'
export const DEFAULT_OLLAMA_CONCURRENCY = 4
const DEFAULT_OLLAMA_TIMEOUT_MS = 5000

interface ParsedOllamaMetadata {
  readonly contextLength?: number
  readonly capabilities: ReadonlySet<string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

function parseCapabilities(value: unknown): ReadonlySet<string> {
  const capabilities = new Set<string>()
  if (!Array.isArray(value)) return capabilities

  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim().length > 0) {
      capabilities.add(entry.trim().toLowerCase())
    }
  }
  return capabilities
}

/**
 * Reads num_ctx from Ollama's Modelfile-style parameters string. Accepts the
 * forms returned by different Ollama versions: "num_ctx 4096",
 * "num_ctx: 8192", and "\"num_ctx\": 16384".
 */
function parseNumCtx(parameters: unknown): number | undefined {
  if (isRecord(parameters)) {
    return positiveNumber(parameters.num_ctx)
  }
  if (typeof parameters !== 'string') return undefined

  const match = parameters.match(/(?:^|\n)\s*"?num_ctx"?\s*[:=]?\s*(\d+)\b/i)
  return match ? positiveNumber(Number(match[1])) : undefined
}

/**
 * Resolves the effective context window.
 *
 * A num_ctx from the model's parameters is the only intentional runtime
 * context signal Ollama exposes, so it wins over architecture-derived values.
 * When it is absent, fall back to model_info.<architecture>.context_length,
 * then any *.context_length entry, then a top-level context_length.
 */
function resolveContextLength(show: Record<string, unknown>): number | undefined {
  const numCtx = parseNumCtx(show.parameters)
  if (numCtx) return numCtx

  const modelInfo = isRecord(show.model_info) ? show.model_info : undefined
  if (modelInfo) {
    const architecture = typeof modelInfo['general.architecture'] === 'string'
      ? modelInfo['general.architecture']
      : undefined
    const family = isRecord(show.details) && typeof show.details.family === 'string'
      ? show.details.family
      : undefined

    for (const name of [architecture, family]) {
      if (!name) continue
      const value = positiveNumber(modelInfo[`${name}.context_length`])
      if (value) return value
    }

    let fallback: number | undefined
    for (const [key, value] of Object.entries(modelInfo)) {
      if (!key.endsWith('.context_length')) continue
      const candidate = positiveNumber(value)
      if (candidate && (fallback === undefined || candidate > fallback)) {
        fallback = candidate
      }
    }
    if (fallback) return fallback
  }

  return positiveNumber(show.context_length)
}

function parseShow(value: unknown): ParsedOllamaMetadata | undefined {
  if (!isRecord(value)) return undefined

  const capabilities = parseCapabilities(value.capabilities)
  const contextLength = resolveContextLength(value)
  if (contextLength === undefined && capabilities.size === 0) return undefined

  return {
    ...(contextLength !== undefined ? { contextLength } : {}),
    capabilities,
  }
}

/**
 * Creates a deferred enricher backed by Ollama's POST /api/show endpoint.
 *
 * The enricher does not make requests at resolution time. prepare() performs
 * bounded-concurrency per-model requests after the provider model list is
 * known; enrich() is a synchronous lookup. Per-model failures are ignored so
 * discovery always continues.
 */
export function createOllamaEnricher(options: ModelEnricherDeferredContext): ModelEnricher {
  const metadata = new Map<string, ParsedOllamaMetadata>()
  const showUrl = buildModelInfoURL(options.baseURL, options.endpoint ?? DEFAULT_OLLAMA_ENDPOINT)
  const fetcher = options.fetcher ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_OLLAMA_TIMEOUT_MS
  const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json' })
  if (options.apiKey) headers.set('authorization', `Bearer ${options.apiKey}`)

  async function fetchShow(modelId: string): Promise<ParsedOllamaMetadata | undefined> {
    try {
      const response = await fetcher(showUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: modelId }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        options.logger?.warn('Ollama model info discovery failed', {
          endpoint: showUrl,
          modelId,
          status: response.status,
        })
        return undefined
      }
      return parseShow(await response.json())
    } catch (error) {
      options.logger?.warn('Ollama model info discovery failed', {
        endpoint: showUrl,
        modelId,
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }

  return {
    async prepare(modelIds) {
      const ids = [...new Set(modelIds)].filter((id) => id.length > 0 && !metadata.has(id))
      let cursor = 0

      const worker = async (): Promise<void> => {
        while (cursor < ids.length) {
          const modelId = ids[cursor++]
          const parsed = await fetchShow(modelId)
          if (parsed) metadata.set(modelId, parsed)
        }
      }

      await Promise.all(
        Array.from({ length: Math.min(DEFAULT_OLLAMA_CONCURRENCY, ids.length) }, () => worker()),
      )
    },

    enrich(model, context) {
      const parsed = metadata.get(model.id)
      if (!parsed) return {}

      const capabilities = parsed.capabilities
      if (context.filterNonChat && capabilities.has('embedding') && !capabilities.has('completion')) {
        return { skip: true }
      }

      const result: {
        limit?: ReturnType<typeof createModelLimits>
        modalities?: { input: string[]; output: string[] }
        reasoning?: boolean
        toolCall?: boolean
      } = {}

      if (parsed.contextLength !== undefined) {
        const limits = createModelLimits(parsed.contextLength)
        if (limits) result.limit = limits
      }

      const input = ['text']
      if (capabilities.has('vision') || capabilities.has('images')) input.push('image')
      if (capabilities.has('audio')) input.push('audio')
      if (input.length > 1) result.modalities = { input, output: ['text'] }

      if (capabilities.has('thinking')) result.reasoning = true
      if (capabilities.has('tools') || capabilities.has('function_calling') || capabilities.has('tool_calling')) {
        result.toolCall = true
      }

      return result
    },
  }
}
