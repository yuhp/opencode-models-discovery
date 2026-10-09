import { createModelLimits, DEFAULT_CONTEXT_TOKEN_LIMIT, type DiscoveredModelDraft, type ModelLimitDraft, type NormalizedModelLimit } from './model-types'

export interface DiscoveredV1Model {
  readonly id: string
  readonly name: string
  readonly organizationOwner?: string
  readonly capabilities?: Record<string, unknown>
  readonly modalities?: {
    readonly input?: readonly string[]
    readonly output?: readonly string[]
  }
  readonly limit?: ModelLimitDraft
  readonly reasoning?: boolean
  readonly attachment?: boolean
  readonly tool_call?: boolean
  readonly structured_output?: boolean
  readonly temperature?: boolean
  readonly cost?: unknown
  readonly variants?: unknown
  readonly compatibility?: Record<string, unknown>
}

export interface DiscoveredV2ModelProjection {
  readonly id: string
  readonly modelID: string
  readonly name: string
  readonly capabilities: {
    readonly tools: boolean
    readonly input: string[]
    readonly output: string[]
  }
  readonly limit: NormalizedModelLimit
  readonly variants?: Array<{
    readonly id: string
    readonly settings: Record<string, unknown>
    readonly body?: Record<string, unknown>
    readonly headers?: Record<string, string>
  }>
  readonly compatibility?: Record<string, unknown>
  readonly reasoning?: boolean
  readonly attachment?: boolean
  readonly cost?: unknown
}

/** Projects a shared discovery draft into the V1 provider model shape. */
export function mapToV1Model(draft: DiscoveredModelDraft): DiscoveredV1Model {
  return {
    id: draft.id,
    name: draft.name,
    ...(draft.organizationOwner ? { organizationOwner: draft.organizationOwner } : {}),
    ...(draft.modalities ? { modalities: draft.modalities } : {}),
    ...(draft.capabilities ? { capabilities: draft.capabilities } : {}),
    ...(draft.limit ? { limit: draft.limit } : {}),
    ...(draft.reasoning !== undefined ? { reasoning: draft.reasoning } : {}),
    ...(draft.attachment !== undefined ? { attachment: draft.attachment } : {}),
    ...(draft.toolCall !== undefined ? { tool_call: draft.toolCall } : {}),
    ...(draft.structuredOutput !== undefined ? { structured_output: draft.structuredOutput } : {}),
    ...(draft.temperature !== undefined ? { temperature: draft.temperature } : {}),
    ...(draft.cost !== undefined ? { cost: draft.cost } : {}),
    ...(draft.variants !== undefined ? { variants: draft.variants } : {}),
    ...(draft.compatibility ? { compatibility: draft.compatibility } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mapV1Variant(id: string, value: unknown): {
  id: string
  settings: Record<string, unknown>
  body?: Record<string, unknown>
  headers?: Record<string, string>
} {
  if (!isRecord(value)) return { id, settings: {} }

  const settings: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'settings' || key === 'body' || key === 'headers') continue
    settings[key] = item
  }

  if (isRecord(value.settings)) Object.assign(settings, value.settings)

  const headers = isRecord(value.headers)
    ? Object.fromEntries(
        Object.entries(value.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      )
    : undefined

  return {
    id,
    settings,
    ...(isRecord(value.body) ? { body: value.body } : {}),
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  }
}

/** Projects a shared discovery draft into the V2 model catalog shape. */
export function mapToDiscoveredV2Model(
  draft: DiscoveredModelDraft,
  options: { readonly smartModelName: boolean },
): DiscoveredV2ModelProjection {
  const resultDraft = draft
  const rawModel = resultDraft.raw

  const name = options.smartModelName ? resultDraft.name : resultDraft.id

  const capabilities: Record<string, unknown> = {
    tools: resultDraft.toolCall !== false && resultDraft.capabilities?.tools !== false,
  }

  const inputModalities = resultDraft.modalities?.input ?? resultDraft.capabilities?.input ?? ['text']
  if (Array.isArray(inputModalities) && inputModalities.length > 0) {
    capabilities.input = inputModalities
  }

  const outputModalities = resultDraft.modalities?.output ?? resultDraft.capabilities?.output ?? ['text']
  if (Array.isArray(outputModalities) && outputModalities.length > 0) {
    capabilities.output = outputModalities
  }

  const rawLimit = resultDraft.limit
  const rawContext = typeof rawLimit?.context === 'number' && rawLimit.context > 0 ? rawLimit.context : undefined
  const rawOutput = typeof rawLimit?.output === 'number' && rawLimit.output > 0 ? rawLimit.output : undefined
  const rawInput = typeof rawLimit?.input === 'number' && rawLimit.input > 0 ? rawLimit.input : undefined

  const limit = createModelLimits(rawContext ?? DEFAULT_CONTEXT_TOKEN_LIMIT, rawOutput, rawInput)!

  const mapped: Record<string, any> = {
    id: resultDraft.id,
    modelID: resultDraft.id,
    name,
    capabilities,
    limit,
  }

  const isReasoning = typeof resultDraft.reasoning === 'boolean'
    ? resultDraft.reasoning
    : (
        rawModel.supports_reasoning === true ||
        (rawModel.capabilities && typeof rawModel.capabilities === 'object' && (rawModel.capabilities as Record<string, unknown>).reasoning === true)
      )

  if (isReasoning) {
    mapped.reasoning = true
    mapped.compatibility = {
      ...mapped.compatibility,
      reasoningField: 'reasoning_content',
    }
  }

  if (Array.isArray(resultDraft.variants)) {
    mapped.variants = resultDraft.variants
  } else if (resultDraft.variants && typeof resultDraft.variants === 'object') {
    mapped.variants = Object.entries(resultDraft.variants).map(([id, value]) => mapV1Variant(id, value))
  } else if (isReasoning && !mapped.variants) {
    mapped.variants = [
      { id: 'low', settings: { reasoningEffort: 'low' } },
      { id: 'medium', settings: { reasoningEffort: 'medium' } },
      { id: 'high', settings: { reasoningEffort: 'high' } },
    ]
  }

  if (typeof resultDraft.attachment === 'boolean') {
    mapped.attachment = resultDraft.attachment
  }

  if (resultDraft.cost && typeof resultDraft.cost === 'object') {
    if (Array.isArray(resultDraft.cost)) {
      mapped.cost = resultDraft.cost
    } else {
      mapped.cost = [{
        input: (resultDraft.cost as Record<string, any>).input ?? 0,
        output: (resultDraft.cost as Record<string, any>).output ?? 0,
        cache: {
          read: (resultDraft.cost as Record<string, any>).cache_read ?? (resultDraft.cost as Record<string, any>).cache?.read ?? 0,
          write: (resultDraft.cost as Record<string, any>).cache_write ?? (resultDraft.cost as Record<string, any>).cache?.write ?? 0,
        },
      }]
    }
  }

  return mapped as DiscoveredV2ModelProjection
}
