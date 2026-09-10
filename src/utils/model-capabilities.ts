// Shared extraction of capability metadata from a raw OpenAI-compatible /models entry.
//
// OpenAI's own /models response (id, object, created, owned_by, shutdown_date) carries NO
// capability metadata at all, so every gateway invents its own field names. This module
// normalises the common spellings so providers work without configuring a modelInfoFormat.

export function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export type CapabilitySource = Record<string, unknown>

// Accepts both camelCase and snake_case spellings of a key.
function pickNumber(source: CapabilitySource, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (hasUsableNumber(value)) {
      return value
    }
  }
  return undefined
}

/**
 * Context window of a model.
 *
 * Nested OpenAI-style `limit.context` wins over flat spellings, since a gateway that emits
 * `limit` is explicitly targeting OpenCode's config shape.
 */
export function extractContextLimit(source: CapabilitySource | undefined): number | undefined {
  if (!source) return undefined

  const nested = source.limit
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const fromLimit = pickNumber(nested as CapabilitySource, 'context', 'contextWindow', 'context_window')
    if (fromLimit !== undefined) {
      return fromLimit
    }
  }

  return pickNumber(
    source,
    'context_window',
    'contextWindow',
    'context_length',
    'contextLength',
    'max_context_length',
    'maxContextLength',
    'max_model_len',
    'maxModelLen',
  )
}

/**
 * Maximum output tokens of a model.
 *
 * `max_tokens` is included last and deliberately low priority: in the OpenAI API it is a
 * request parameter for generation endpoints, not model metadata. Gateways that echo it on
 * /models are using it as an output cap, but a well-formed nested `limit.output` or
 * `max_output_tokens` should always win.
 */
export function extractOutputLimit(source: CapabilitySource | undefined): number | undefined {
  if (!source) return undefined

  const nested = source.limit
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const fromLimit = pickNumber(nested as CapabilitySource, 'output', 'maxOutput', 'max_output_tokens')
    if (fromLimit !== undefined) {
      return fromLimit
    }
  }

  return pickNumber(
    source,
    'max_output_tokens',
    'maxOutputTokens',
    'max_completion_tokens',
    'maxCompletionTokens',
    'max_tokens',
  )
}

function pickBoolean(source: CapabilitySource, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'boolean') {
      return value
    }
  }
  return undefined
}

// `capabilities` is a nested object used by some gateways (and by OpenCode itself).
function nestedCapabilities(source: CapabilitySource): CapabilitySource | undefined {
  const value = source.capabilities
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as CapabilitySource
  }
  return undefined
}

export function extractToolCalling(source: CapabilitySource | undefined): boolean | undefined {
  if (!source) return undefined
  const nested = nestedCapabilities(source)
  return (
    pickBoolean(source, 'tool_call', 'toolCall', 'supports_tools', 'supportsTools', 'function_calling', 'supports_function_calling') ??
    (nested ? pickBoolean(nested, 'toolcall', 'tool_call', 'toolCall', 'function_calling') : undefined)
  )
}

export function extractReasoning(source: CapabilitySource | undefined): boolean | undefined {
  if (!source) return undefined
  const nested = nestedCapabilities(source)
  return (
    pickBoolean(source, 'reasoning', 'supports_reasoning', 'supportsReasoning') ??
    (nested ? pickBoolean(nested, 'reasoning') : undefined)
  )
}

export function extractAttachment(source: CapabilitySource | undefined): boolean | undefined {
  if (!source) return undefined
  const nested = nestedCapabilities(source)
  return (
    pickBoolean(source, 'attachment', 'supports_vision', 'supportsVision') ??
    (nested ? pickBoolean(nested, 'attachment', 'vision') : undefined)
  )
}

export function extractTemperature(source: CapabilitySource | undefined): boolean | undefined {
  if (!source) return undefined
  const nested = nestedCapabilities(source)
  return pickBoolean(source, 'temperature') ?? (nested ? pickBoolean(nested, 'temperature') : undefined)
}

export function hasAnyCapabilityMetadata(source: CapabilitySource | undefined): boolean {
  if (!source) return false
  return (
    extractContextLimit(source) !== undefined ||
    extractOutputLimit(source) !== undefined ||
    extractToolCalling(source) !== undefined ||
    extractReasoning(source) !== undefined ||
    extractAttachment(source) !== undefined ||
    extractTemperature(source) !== undefined
  )
}
