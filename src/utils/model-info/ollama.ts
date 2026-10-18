import type { ModelEnricher } from '../../core/model-enrichment'
import { createModelLimits } from '../../core/model-types'

function hasUsableNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function getRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function resolveOllamaContextLength(show: Record<string, unknown>): number | undefined {
  const parameters = getRecordString(show, 'parameters')
  if (parameters) {
    const match = /"?num_ctx"?[:=\s]+(\d+)/.exec(parameters)
    const parsed = match ? Number(match[1]) : undefined
    if (hasUsableNumber(parsed)) return parsed
  }

  const details = asRecord(show.details)
  const family = details ? getRecordString(details, 'family') : undefined
  const modelInfo = asRecord(show.model_info)
  if (modelInfo) {
    if (family) {
      const familyValue = modelInfo[`${family}.context_length`]
      if (hasUsableNumber(familyValue)) return familyValue
    }
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') && hasUsableNumber(value)) return value
    }
  }

  if (hasUsableNumber(show.context_length)) return show.context_length

  return undefined
}

export function createOllamaEnricher(data: unknown): ModelEnricher {
  const shows = new Map<string, unknown>()
  if (data instanceof Map) {
    for (const [key, value] of data) {
      if (typeof key === 'string' && key.length > 0 && value && typeof value === 'object') {
        shows.set(key, value)
      }
    }
  }

  return {
    enrich(model) {
      const show = asRecord(shows.get(model.id))
      if (!show) return {}

      const result: {
        limit?: { context: number; output: number }
        modalities?: { input: string[]; output: string[] }
        toolCall?: boolean
        reasoning?: boolean
      } = {}

      const contextLength = resolveOllamaContextLength(show)
      const limits = createModelLimits(contextLength)
      if (limits) result.limit = limits

      const capabilities = Array.isArray(show.capabilities) ? show.capabilities : []
      const imageInput = capabilities.includes('vision') || capabilities.includes('images')
      const audioInput = capabilities.includes('audio')
      if (imageInput || audioInput) {
        result.modalities = {
          input: ['text', ...(imageInput ? ['image'] : []), ...(audioInput ? ['audio'] : [])],
          output: ['text'],
        }
      }
      if (capabilities.includes('thinking')) result.reasoning = true
      if (capabilities.includes('tools') || capabilities.includes('function_calling') || capabilities.includes('tool_calling')) {
        result.toolCall = true
      }

      return result
    },
  }
}
