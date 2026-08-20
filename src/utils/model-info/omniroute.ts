import type { ModelInfoEnricher } from './types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function getModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const supportedModalities = new Set(['text', 'audio', 'image', 'video', 'pdf'])
  const modalities = [...new Set(value
    .filter((modality): modality is string => typeof modality === 'string')
    .map(modality => modality.trim().toLowerCase())
    .map(modality => modality === 'speech' ? 'audio' : modality)
    .filter(modality => supportedModalities.has(modality)))]
  return modalities.length > 0 ? modalities : undefined
}

function getCapabilities(rawModel: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const capabilities = rawModel?.capabilities
  return capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities)
    ? capabilities as Record<string, unknown>
    : undefined
}

function getReasoningVariants(capabilities: Record<string, unknown> | undefined): Record<string, { reasoningEffort: string }> | undefined {
  if (capabilities?.reasoning !== true || !Array.isArray(capabilities.effort_tiers)) return undefined

  const supportedTiers: Record<string, true> = {
    none: true,
    minimal: true,
    low: true,
    medium: true,
    high: true,
    xhigh: true,
    max: true,
    ultra: true,
  }
  const variants = Object.fromEntries(
    capabilities.effort_tiers
      .filter((tier): tier is string => typeof tier === 'string')
      .map(tier => tier.trim().toLowerCase())
      .filter(tier => supportedTiers[tier] === true)
      .map(tier => [tier, { reasoningEffort: tier }])
  )
  return Object.keys(variants).length > 0 ? variants : undefined
}

export function createOmniRouteModelInfoEnricher(_data: unknown): ModelInfoEnricher {
  return {
    shouldSkipModel(): boolean {
      return false
    },
    applyModelInfo(modelConfig: any, _modelId: string, rawModel?: Record<string, unknown>): void {
      const context = rawModel?.context_length
      const inputLimit = rawModel?.max_input_tokens
      const output = rawModel?.max_output_tokens
      if (hasUsableNumber(context) && hasUsableNumber(output)) {
        modelConfig.limit = {
          context,
          ...(hasUsableNumber(inputLimit) ? { input: inputLimit } : {}),
          output,
        }
      }

      const capabilities = getCapabilities(rawModel)
      const inputModalities = getModalities(rawModel?.input_modalities)
      const outputModalities = getModalities(rawModel?.output_modalities)
      const input = inputModalities ?? (capabilities?.vision === true ? ['text', 'image'] : undefined)
      if (input || outputModalities) {
        modelConfig.modalities = {
          ...(input ? { input } : {}),
          ...(outputModalities ? { output: outputModalities } : {}),
          ...(!input && modelConfig.modalities?.input ? { input: modelConfig.modalities.input } : {}),
          ...(!outputModalities && modelConfig.modalities?.output ? { output: modelConfig.modalities.output } : {}),
        }
      }

      if (typeof capabilities?.attachment === 'boolean') modelConfig.attachment = capabilities.attachment
      if (typeof capabilities?.reasoning === 'boolean') modelConfig.reasoning = capabilities.reasoning
      if (typeof capabilities?.tool_calling === 'boolean') modelConfig.tool_call = capabilities.tool_calling
      if (typeof capabilities?.structured_output === 'boolean') modelConfig.structured_output = capabilities.structured_output
      if (typeof capabilities?.temperature === 'boolean') modelConfig.temperature = capabilities.temperature

      const variants = getReasoningVariants(capabilities)
      if (variants) modelConfig.variants = variants
    },
  }
}
