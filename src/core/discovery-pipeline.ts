import { enrichModelDraft } from './model-enrichment'
import { matchesModelFilter, type ModelFilter } from './model-filter'
import { disambiguateModelNames, resolveModelDisplayName, resolveModelOwner } from './model-naming'
import { normalizeDiscoveredRawModel, type DiscoveredModelDraft, type DiscoveredRawModel } from './model-types'
import type { ModelEnricher, ModelEnrichmentContext } from './model-enrichment'

export type ModelClassification = 'chat' | 'embedding' | 'unknown'

export interface DiscoveryPipelineOptions {
  readonly filter: ModelFilter
  readonly smartModelName: boolean
  readonly enricher?: ModelEnricher
  readonly enrichmentContext?: ModelEnrichmentContext
  readonly classify?: (model: DiscoveredRawModel) => ModelClassification
}

export function classifyDiscoveredModel(model: DiscoveredRawModel): ModelClassification {
  const lowerId = model.id.toLowerCase()
  return lowerId.includes('embedding') || lowerId.includes('embed') ? 'embedding' : 'chat'
}

function createInitialDraft(model: DiscoveredRawModel, classification: ModelClassification): DiscoveredModelDraft {
  const owner = resolveModelOwner({ id: model.id, raw: model })
  return {
    id: model.id,
    name: model.id,
    raw: model,
    ...(owner ? { organizationOwner: owner } : {}),
    ...(classification === 'chat' ? { modalities: { input: ['text'], output: ['text'] } } : {}),
  }
}

/**
 * Host-independent model processing. Fetching, credentials, persistence and
 * final V1/V2 mapping stay outside this function.
 */
export function discoverModelDrafts(
  values: readonly unknown[],
  options: DiscoveryPipelineOptions,
): DiscoveredModelDraft[] {
  const drafts: DiscoveredModelDraft[] = []
  const classify = options.classify ?? classifyDiscoveredModel

  for (const value of values) {
    const model = normalizeDiscoveredRawModel(value)
    if (!model || !matchesModelFilter(model, options.filter)) continue

    const classification = classify(model)
    if (classification === 'embedding') continue

    const enriched = enrichModelDraft(createInitialDraft(model, classification), options.enricher, options.enrichmentContext)
    if (enriched.skipped) continue

    drafts.push({
      ...enriched.draft,
      name: resolveModelDisplayName(model, options.smartModelName, enriched.metadataName),
    })
  }

  if (options.smartModelName) disambiguateModelNames(drafts)
  return drafts
}
