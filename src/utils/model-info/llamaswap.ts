import type { ModelEnricher } from '../../core/model-enrichment'
import { createModelLimits } from '../../core/model-types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hasNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function getModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const supportedModalities = new Set(['text', 'audio', 'image', 'video', 'pdf'])
  const modalities = [...new Set(value
    .filter((modality): modality is string => typeof modality === 'string')
    .map((modality) => modality.trim().toLowerCase())
    .filter((modality) => supportedModalities.has(modality)))]
  return modalities.length > 0 ? modalities : undefined
}

function getLlamaSwapMetadata(rawModel: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return getRecord(getRecord(rawModel?.meta)?.llamaswap)
}

/**
 * Resolves the effective context window from the inline declarations.
 *
 * llama.cpp reports the model's trained maximum in `context_length`, while
 * `meta.n_ctx` carries the configured runtime context (present on loaded
 * models only). llama-swap may cap the context below either declaration.
 * The effective window can never exceed the smallest positive declaration,
 * so the minimum of all usable values is used; a single declaration is used
 * when only one is present.
 */
function resolveContextLength(...declarations: unknown[]): number | undefined {
  const declared = declarations.filter(hasUsableNumber)
  return declared.length > 0 ? Math.min(...declared) : undefined
}

export function createLlamaSwapEnricher(_data: unknown): ModelEnricher {
  return {
    enrich(model) {
      const meta = getRecord(model.meta)
      const llamaSwapMetadata = getLlamaSwapMetadata(model)
      const context = resolveContextLength(model.context_length, meta?.n_ctx)
      const result: any = {}
      const name = model.name
      if (typeof name === 'string' && name.trim().length > 0) result.metadataName = name.trim()
      if (context) {
        const input = hasUsableNumber(llamaSwapMetadata?.max_input_tokens)
          ? llamaSwapMetadata.max_input_tokens
          : undefined
        const output = hasNonNegativeNumber(llamaSwapMetadata?.max_output_tokens)
          ? llamaSwapMetadata.max_output_tokens
          : undefined
        result.limit = createModelLimits(context, output, input)
      }

      const architecture = getRecord(model.architecture)
      const inputModalities = getModalities(architecture?.input_modalities)
      const outputModalities = getModalities(architecture?.output_modalities)
      if (inputModalities || outputModalities) {
        result.modalities = {
          ...(inputModalities ? { input: inputModalities } : {}),
          ...(outputModalities ? { output: outputModalities } : {}),
        }
      }

      const capabilities = getRecord(model.capabilities)
      const supportedParameters = Array.isArray(model.supported_parameters)
        ? model.supported_parameters
        : []
      if (capabilities?.function_calling === true || supportedParameters.includes('tools')) {
        result.toolCall = true
      }
      return result
    },
  }
}
