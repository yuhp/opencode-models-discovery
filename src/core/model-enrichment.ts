import type { DiscoveredModelDraft, DiscoveredRawModel, ModelLimitDraft } from './model-types'

export interface ModelEnrichmentContext {
  readonly filterNonChat: boolean
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
  enrich(model: DiscoveredRawModel, context: ModelEnrichmentContext): ModelEnrichmentResult
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
