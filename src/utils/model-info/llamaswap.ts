import type { ModelInfoEnricher } from './types'

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

export function createLlamaSwapModelInfoEnricher(_data: unknown): ModelInfoEnricher {
  return {
    shouldSkipModel(): boolean {
      return false
    },
    getModelName(_modelId: string, rawModel?: Record<string, unknown>): string | undefined {
      const name = rawModel?.name
      return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined
    },
    applyModelInfo(modelConfig: any, _modelId: string, rawModel?: Record<string, unknown>): void {
      const meta = getRecord(rawModel?.meta)
      const llamaSwapMetadata = getLlamaSwapMetadata(rawModel)
      const context = hasUsableNumber(rawModel?.context_length)
        ? rawModel.context_length
        : hasUsableNumber(meta?.n_ctx) ? meta.n_ctx : undefined
      if (context) {
        const input = hasUsableNumber(llamaSwapMetadata?.max_input_tokens)
          ? llamaSwapMetadata.max_input_tokens
          : undefined
        const output = hasNonNegativeNumber(llamaSwapMetadata?.max_output_tokens)
          ? llamaSwapMetadata.max_output_tokens
          : 0
        modelConfig.limit = {
          context,
          ...(input ? { input } : {}),
          output,
        }
      }

      const architecture = getRecord(rawModel?.architecture)
      const inputModalities = getModalities(architecture?.input_modalities)
      const outputModalities = getModalities(architecture?.output_modalities)
      if (inputModalities || outputModalities) {
        modelConfig.modalities = {
          ...(inputModalities ? { input: inputModalities } : {}),
          ...(outputModalities ? { output: outputModalities } : {}),
          ...(!inputModalities && modelConfig.modalities?.input ? { input: modelConfig.modalities.input } : {}),
          ...(!outputModalities && modelConfig.modalities?.output ? { output: modelConfig.modalities.output } : {}),
        }
      }

      const capabilities = getRecord(rawModel?.capabilities)
      const supportedParameters = Array.isArray(rawModel?.supported_parameters)
        ? rawModel.supported_parameters
        : []
      if (capabilities?.function_calling === true || supportedParameters.includes('tools')) {
        modelConfig.tool_call = true
      }
    },
  }
}
