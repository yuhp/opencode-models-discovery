import type { DiscoveredModelDraft, DiscoveredRawModel, ModelLimitDraft } from './model-types'

export interface ModelEnrichmentContext {
  readonly filterNonChat: boolean
}

export interface ModelEnricherLogger {
  warn(message: string, context?: Record<string, unknown>): void
  info?(message: string, context?: Record<string, unknown>): void
}

/**
 * Request bindings passed to deferred enricher factories at resolution time.
 * Format modules use these to construct an enricher that performs per-model
 * metadata requests later in prepare().
 */
export interface ModelEnricherDeferredContext {
  readonly baseURL: string
  readonly apiKey?: string
  readonly endpoint?: string
  readonly timeoutMs?: number
  readonly fetcher?: typeof fetch
  readonly logger?: ModelEnricherLogger
}

export interface ModelEnrichmentResult {
  readonly skip?: boolean
  readonly metadataName?: string
  readonly capabilities?: Record<string, unknown>
  readonly limit?: ModelLimitDraft
  readonly modalities?: {
    readonly input?: readonly string[]
    readonly output?: readonly string[]
  }
  readonly reasoning?: boolean
  readonly attachment?: boolean
  readonly toolCall?: boolean
  readonly structuredOutput?: boolean
  readonly temperature?: boolean
  readonly cost?: unknown
  readonly variants?: unknown
  readonly compatibility?: Record<string, unknown>
}

export interface ModelEnricher {
  /**
   * Optional deferred hydration step. Called at most once per discovery run,
   * after the provider model list is known and before any enrich() call.
   *
   * Implementations may perform network requests to fetch per-model metadata.
   * Individual failures must degrade to "no enrichment" for that model and
   * must not reject; enrichment is always best-effort.
   */
  prepare?(modelIds: readonly string[]): Promise<void>

  enrich(model: DiscoveredRawModel, context: ModelEnrichmentContext): ModelEnrichmentResult
}

/**
 * Runs the optional deferred hydration step of an enricher.
 *
 * Adapters call this after the provider model list is available and before
 * building discovery drafts, so enrichers that need per-model detail requests
 * can keep enrich() synchronous. Preparation is best-effort: a failure must
 * never abort discovery.
 */
export async function prepareModelEnricher(
  enricher: ModelEnricher | undefined,
  modelIds: readonly string[],
): Promise<void> {
  if (!enricher?.prepare) return
  try {
    await enricher.prepare(modelIds)
  } catch {
    // Deferred enrichment is best-effort; discovery must continue.
  }
}

export interface EnrichedModelDraft {
  readonly draft: DiscoveredModelDraft
  readonly metadataName?: string
  readonly skipped: boolean
}

/** Applies a provider-neutral enricher to a discovered model draft. */
export function enrichModelDraft(
  draft: DiscoveredModelDraft,
  enricher?: ModelEnricher,
  context: ModelEnrichmentContext = { filterNonChat: true },
): EnrichedModelDraft {
  if (!enricher) return { draft, skipped: false }
  const result = enricher.enrich(draft.raw, context)
  if (result.skip) return { draft, skipped: true }

  return {
    skipped: false,
    metadataName: result.metadataName,
    draft: {
      ...draft,
      ...(result.capabilities ? { capabilities: result.capabilities } : {}),
      ...(result.limit ? { limit: result.limit } : {}),
      ...(result.reasoning !== undefined ? { reasoning: result.reasoning } : {}),
      ...(result.attachment !== undefined ? { attachment: result.attachment } : {}),
      ...(result.toolCall !== undefined ? { toolCall: result.toolCall } : {}),
      ...(result.structuredOutput !== undefined ? { structuredOutput: result.structuredOutput } : {}),
      ...(result.temperature !== undefined ? { temperature: result.temperature } : {}),
      ...(result.cost !== undefined ? { cost: result.cost } : {}),
      ...(result.variants !== undefined ? { variants: result.variants } : {}),
      ...(result.compatibility ? { compatibility: result.compatibility } : {}),
      ...(result.modalities ? { modalities: {
        ...(result.modalities.input ? { input: [...result.modalities.input] } : {}),
        ...(result.modalities.output ? { output: [...result.modalities.output] } : {}),
      } } : {}),
    },
  }
}
