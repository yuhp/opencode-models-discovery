import type { ModelEnricher, ModelEnrichmentResult } from '../../core/model-enrichment'

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

// Thinking formats whose reasoning text streams back inside assistant messages.
const INTERLEAVED_FORMATS = new Set(['deepseek', 'zai', 'qwen', 'kimi', 'minimax'])

const INPUT_FLAGS = { vision: 'image', audioInput: 'audio', videoInput: 'video', pdf: 'pdf' } as const
const OUTPUT_FLAGS = { imageOutput: 'image', audioOutput: 'audio' } as const

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function positiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function reasoningVariants(value: unknown): Record<string, { reasoningEffort: string }> | undefined {
  if (!Array.isArray(value)) return undefined

  const variants: Record<string, { reasoningEffort: string }> = {}
  for (const tier of value) {
    if (typeof tier !== 'string') continue
    const effort = tier.trim().toLowerCase()
    if (REASONING_EFFORTS.has(effort)) variants[effort] = { reasoningEffort: effort }
  }
  return Object.keys(variants).length > 0 ? variants : undefined
}

/** Inline router dialect: every model carries limits and a `capabilities` object in the /v1/models response. */
export function createCapabilitiesEnricher(_data: unknown): ModelEnricher {
  return {
    enrich(model): ModelEnrichmentResult {
      const capabilities = object(model.capabilities)
      const result: any = {}

      const context = model.context_length
      const input = model.max_input_tokens
      const output = model.max_output_tokens
      if (positiveNumber(context) && positiveNumber(output)) {
        result.limit = {
          context,
          ...(positiveNumber(input) ? { input } : {}),
          output,
        }
      }

      if (capabilities) {
        const modalities: { input: string[], output: string[] } = { input: ['text'], output: ['text'] }
        for (const [flag, modality] of Object.entries(INPUT_FLAGS)) {
          if (capabilities[flag] === true) modalities.input.push(modality)
        }
        for (const [flag, modality] of Object.entries(OUTPUT_FLAGS)) {
          if (capabilities[flag] === true) modalities.output.push(modality)
        }
        result.modalities = modalities

        if (typeof capabilities.reasoning === 'boolean') result.reasoning = capabilities.reasoning
        if (typeof capabilities.tools === 'boolean') result.toolCall = capabilities.tools
        if (capabilities.pdf === true || capabilities.vision === true) result.attachment = true
        if (typeof capabilities.thinkingFormat === 'string' && INTERLEAVED_FORMATS.has(capabilities.thinkingFormat)) {
          result.compatibility = { interleaved: { field: 'reasoning_content' } }
        }
      }

      const variants = reasoningVariants((capabilities ?? model).effort_tiers ?? model.thinkingLevels)
      if (variants) {
        result.variants = variants
        // Tier support implies reasoning even when the flag is absent or false.
        result.reasoning = true
      }

      return result
    },
  }
}
