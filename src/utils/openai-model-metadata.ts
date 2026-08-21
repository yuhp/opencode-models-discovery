type ModelRecord = Record<string, unknown>

const SUPPORTED_MODALITIES = new Set(['text', 'audio', 'image', 'video', 'pdf'])
const MODALITY_ALIASES: Record<string, string> = {
  image_url: 'image',
  images: 'image',
  speech: 'audio',
  audio_input: 'audio',
  audio_output: 'audio',
}

function isRecord(value: unknown): value is ModelRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toFiniteNumber(value: unknown, minimum: number): number | undefined {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : undefined

  return number !== undefined && Number.isFinite(number) && number >= minimum ? number : undefined
}

function toTokenLimit(value: unknown): number | undefined {
  const number = toFiniteNumber(value, 1)
  return number !== undefined && Number.isInteger(number) ? number : undefined
}

function firstTokenLimit(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = toTokenLimit(value)
    if (number !== undefined) return number
  }

  return undefined
}

function firstNonNegativeNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = toFiniteNumber(value, 0)
    if (number !== undefined) return number
  }

  return undefined
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value
  }

  return undefined
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const modalities = [...new Set(value
    .map(getString)
    .filter((modality): modality is string => modality !== undefined)
    .map((modality) => MODALITY_ALIASES[modality.toLowerCase()] ?? modality.toLowerCase())
    .filter((modality) => SUPPORTED_MODALITIES.has(modality)))]

  return modalities.length > 0 ? modalities : undefined
}

function firstStringArray(...values: unknown[]): string[] | undefined {
  for (const value of values) {
    const modalities = getStringArray(value)
    if (modalities) return modalities
  }

  return undefined
}

function getModalities(rawModel: ModelRecord): { input?: string[]; output?: string[] } {
  const declared = isRecord(rawModel.modalities) ? rawModel.modalities : undefined
  const architecture = isRecord(rawModel.architecture) ? rawModel.architecture : undefined

  const input = firstStringArray(
    declared?.input,
    rawModel.input_modalities,
    architecture?.input_modalities,
  )
  const output = firstStringArray(
    declared?.output,
    rawModel.output_modalities,
    architecture?.output_modalities,
  )

  return { input, output }
}

function getCapabilities(rawModel: ModelRecord): ModelRecord | undefined {
  return isRecord(rawModel.capabilities) ? rawModel.capabilities : undefined
}

function getSupportedParameters(rawModel: ModelRecord, capabilities?: ModelRecord): string[] {
  const values = [
    rawModel.supported_parameters,
    rawModel.supported_openai_params,
    capabilities?.supported_parameters,
    capabilities?.supported_openai_params,
  ].flatMap((value) => Array.isArray(value) ? value : [])

  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase())
}

function supportsParameter(parameters: string[], ...names: string[]): boolean {
  return names.some((name) => parameters.includes(name))
}

function applyLimit(modelConfig: ModelRecord, rawModel: ModelRecord): void {
  const rawLimit = isRecord(rawModel.limit) ? rawModel.limit : undefined
  const meta = isRecord(rawModel.meta) ? rawModel.meta : undefined
  const currentLimit = isRecord(modelConfig.limit) ? modelConfig.limit : undefined

  // Prefer an explicit OpenCode-shaped limit, then common local/OpenAI-compatible
  // names. `max_input_tokens` is the final context fallback used by Carcará.
  const context = firstTokenLimit(
    rawLimit?.context,
    rawModel.context_length,
    rawModel.max_context_length,
    rawModel.native_context_length,
    rawModel.max_model_len,
    meta?.context_length,
    meta?.n_ctx,
    rawModel.max_input_tokens,
  )
  const input = firstTokenLimit(
    rawLimit?.input,
    rawModel.max_input_tokens,
    rawModel.max_input_length,
    rawModel.input_token_limit,
  )
  const output = firstTokenLimit(
    rawLimit?.output,
    rawModel.max_output_tokens,
    rawModel.max_output_length,
    rawModel.max_tokens,
  )

  if (context === undefined && input === undefined && output === undefined && currentLimit === undefined) {
    return
  }

  modelConfig.limit = {
    ...(currentLimit ?? {}),
    context: context ?? currentLimit?.context ?? 0,
    ...(input !== undefined ? { input } : {}),
    output: output ?? currentLimit?.output ?? 0,
  }
}

function mergeModalities(modelConfig: ModelRecord, input?: string[], output?: string[]): void {
  if (!input && !output) return

  const current = isRecord(modelConfig.modalities) ? modelConfig.modalities : {}
  modelConfig.modalities = {
    ...current,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
  }
}

function addInferredInputModalities(modelConfig: ModelRecord, rawModel: ModelRecord, capabilities?: ModelRecord): void {
  const current = isRecord(modelConfig.modalities) ? modelConfig.modalities : {}
  const input = getStringArray(current.input) ?? []
  const inferred = [...input]

  const booleanModalities: Array<[string, string[]]> = [
    ['image', ['vision', 'supports_vision', 'image']],
    ['audio', ['audio', 'supports_audio']],
    ['video', ['video', 'supports_video']],
    ['pdf', ['pdf', 'supports_pdf']],
  ]

  for (const [modality, names] of booleanModalities) {
    const values = names.flatMap((name) => [rawModel[name], capabilities?.[name]])
    if (firstBoolean(...values) === true && !inferred.includes(modality)) {
      inferred.push(modality)
    }
  }

  if (inferred.length > input.length) {
    modelConfig.modalities = { ...current, input: inferred }
  }
}

function applyCapabilities(modelConfig: ModelRecord, rawModel: ModelRecord, capabilities?: ModelRecord): void {
  const parameters = getSupportedParameters(rawModel, capabilities)
  const capability = (...names: string[]): boolean | undefined => firstBoolean(
    ...names.flatMap((name) => [rawModel[name], capabilities?.[name]]),
  )

  const attachment = capability('attachment', 'attachments', 'supports_attachment', 'supports_attachments')
  const reasoning = capability('reasoning', 'supports_reasoning', 'supports_reasoning_effort')
  const toolCall = capability(
    'tool_call',
    'tools',
    'tool_calling',
    'function_calling',
    'supports_tools',
    'supports_tool_calling',
    'supports_function_calling',
  )
  const structuredOutput = capability(
    'structured_output',
    'structured_outputs',
    'supports_structured_output',
    'supports_structured_outputs',
  )
  const temperature = capability('temperature', 'supports_temperature')

  if (attachment !== undefined) modelConfig.attachment = attachment
  if (reasoning !== undefined || supportsParameter(parameters, 'reasoning', 'reasoning_effort')) {
    modelConfig.reasoning = reasoning ?? true
  }
  if (toolCall !== undefined || supportsParameter(parameters, 'tools', 'tool_choice', 'functions', 'function_call')) {
    modelConfig.tool_call = toolCall ?? true
  }
  if (structuredOutput !== undefined || supportsParameter(parameters, 'response_format', 'structured_output', 'structured_outputs')) {
    modelConfig.structured_output = structuredOutput ?? true
  }
  if (temperature !== undefined) modelConfig.temperature = temperature

  const interleaved = rawModel.interleaved
  if (interleaved === true || (isRecord(interleaved) && (interleaved.field === 'reasoning_content' || interleaved.field === 'reasoning_details'))) {
    modelConfig.interleaved = interleaved
  }
}

function applyCost(modelConfig: ModelRecord, rawModel: ModelRecord): void {
  const rawCost = isRecord(rawModel.cost) ? rawModel.cost : undefined
  if (!rawCost) return

  const currentCost = isRecord(modelConfig.cost) ? modelConfig.cost : {}
  const cache = isRecord(rawCost.cache) ? rawCost.cache : undefined
  const input = firstNonNegativeNumber(rawCost.input)
  const output = firstNonNegativeNumber(rawCost.output)
  const cacheRead = firstNonNegativeNumber(rawCost.cache_read, cache?.read)
  const cacheWrite = firstNonNegativeNumber(rawCost.cache_write, cache?.write)

  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) return

  modelConfig.cost = {
    ...currentCost,
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cache_write: cacheWrite } : {}),
  }
}

export function getOpenAIModelDisplayName(rawModel: ModelRecord): string | undefined {
  return getString(rawModel.name)
    ?? getString(rawModel.display_name)
    ?? getString(rawModel.displayName)
    ?? getString(rawModel.normalized_name)
}

export function applyOpenAIModelMetadata(modelConfig: ModelRecord, rawModel: ModelRecord): void {
  applyLimit(modelConfig, rawModel)

  const declaredModalities = getModalities(rawModel)
  mergeModalities(modelConfig, declaredModalities.input, declaredModalities.output)

  const capabilities = getCapabilities(rawModel)
  addInferredInputModalities(modelConfig, rawModel, capabilities)
  applyCapabilities(modelConfig, rawModel, capabilities)
  applyCost(modelConfig, rawModel)

  const family = getString(rawModel.family)
  if (family) modelConfig.family = family

  const releaseDate = getString(rawModel.release_date)
  if (releaseDate) modelConfig.release_date = releaseDate
}
