export interface DiscoveredRawModel {
  readonly id: string
  readonly owned_by?: string
  readonly object?: string
  readonly created?: number
  readonly [key: string]: unknown
}

export interface DiscoveredModelDraft {
  readonly id: string
  name: string
  organizationOwner?: string
  readonly raw: DiscoveredRawModel
  capabilities?: Record<string, unknown>
  limit?: ModelLimitDraft
  modalities?: {
    input?: string[]
    output?: string[]
  }
  reasoning?: boolean
  attachment?: boolean
  toolCall?: boolean
  structuredOutput?: boolean
  temperature?: boolean
  cost?: unknown
  variants?: unknown
  compatibility?: Record<string, unknown>
}

export const DEFAULT_OUTPUT_TOKEN_LIMIT = 32_000
export const DEFAULT_CONTEXT_TOKEN_LIMIT = 200_000

export interface ModelLimitDraft {
  readonly context: number
  readonly output?: number
  readonly input?: number
}

export interface NormalizedModelLimit {
  readonly context: number
  readonly output: number
  readonly input?: number
}

/**
 * Creates a normalized limit object.
 * - requires a positive context window
 * - preserves valid explicit output limits, bounded by the context limit
 * - falls back to Math.min(context, DEFAULT_OUTPUT_TOKEN_LIMIT) when output is missing or non-positive
 */
export function createModelLimits(
  context?: number,
  explicitOutput?: number,
  input?: number,
): NormalizedModelLimit | undefined {
  if (typeof context !== 'number' || !Number.isFinite(context) || context <= 0) return undefined

  const output = typeof explicitOutput === 'number' && Number.isFinite(explicitOutput) && explicitOutput > 0
    ? Math.min(explicitOutput, context)
    : Math.min(context, DEFAULT_OUTPUT_TOKEN_LIMIT)

  return {
    context,
    output,
    ...(typeof input === 'number' && Number.isFinite(input) && input > 0 ? { input } : {}),
  }
}

export function normalizeDiscoveredRawModel(value: unknown): DiscoveredRawModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined

  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string' || candidate.id.trim().length === 0) return undefined

  return candidate as DiscoveredRawModel
}

export function isDiscoveredRawModel(value: unknown): value is DiscoveredRawModel {
  return normalizeDiscoveredRawModel(value) !== undefined
}
