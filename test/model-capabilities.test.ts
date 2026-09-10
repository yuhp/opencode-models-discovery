import { describe, it, expect } from 'vitest'
import {
  extractContextLimit,
  extractOutputLimit,
  extractToolCalling,
  extractReasoning,
  extractAttachment,
  extractTemperature,
  hasAnyCapabilityMetadata,
} from '../src/utils/model-capabilities'

describe('model capability extraction', () => {
  describe('extractContextLimit', () => {
    it('reads the common flat spellings', () => {
      expect(extractContextLimit({ context_window: 200000 })).toBe(200000)
      expect(extractContextLimit({ context_length: 131072 })).toBe(131072)
      expect(extractContextLimit({ max_context_length: 32768 })).toBe(32768)
      expect(extractContextLimit({ max_model_len: 8192 })).toBe(8192)
      expect(extractContextLimit({ contextWindow: 64000 })).toBe(64000)
      expect(extractContextLimit({ contextLength: 64000 })).toBe(64000)
    })

    it('prefers nested limit.context, which targets the OpenCode config shape', () => {
      expect(extractContextLimit({ limit: { context: 999999 }, context_window: 128000 })).toBe(999999)
      expect(extractContextLimit({ limit: { context_window: 4242 } })).toBe(4242)
    })

    it('returns undefined when nothing usable is present', () => {
      expect(extractContextLimit({})).toBeUndefined()
      expect(extractContextLimit(undefined)).toBeUndefined()
      expect(extractContextLimit({ context_window: 0 })).toBeUndefined()
      expect(extractContextLimit({ context_window: -5 })).toBeUndefined()
      expect(extractContextLimit({ context_window: 'huge' })).toBeUndefined()
      expect(extractContextLimit({ context_window: Number.NaN })).toBeUndefined()
    })
  })

  describe('extractOutputLimit', () => {
    it('reads the common flat spellings', () => {
      expect(extractOutputLimit({ max_output_tokens: 64000 })).toBe(64000)
      expect(extractOutputLimit({ max_completion_tokens: 16384 })).toBe(16384)
      expect(extractOutputLimit({ maxOutputTokens: 8192 })).toBe(8192)
    })

    it('reads max_tokens as a last resort', () => {
      expect(extractOutputLimit({ max_tokens: 4096 })).toBe(4096)
    })

    it('prefers every other spelling over max_tokens', () => {
      expect(extractOutputLimit({ max_tokens: 4096, max_output_tokens: 64000 })).toBe(64000)
      expect(extractOutputLimit({ max_tokens: 4096, limit: { output: 32768 } })).toBe(32768)
    })

    it('prefers nested limit.output', () => {
      expect(extractOutputLimit({ limit: { output: 111 }, max_output_tokens: 222 })).toBe(111)
    })

    it('returns undefined when nothing usable is present', () => {
      expect(extractOutputLimit({})).toBeUndefined()
      expect(extractOutputLimit(undefined)).toBeUndefined()
      expect(extractOutputLimit({ max_tokens: 0 })).toBeUndefined()
    })
  })

  describe('boolean capabilities', () => {
    it('reads tool calling under its many aliases', () => {
      expect(extractToolCalling({ tool_call: true })).toBe(true)
      expect(extractToolCalling({ supports_tools: false })).toBe(false)
      expect(extractToolCalling({ supports_function_calling: true })).toBe(true)
      expect(extractToolCalling({ capabilities: { toolcall: true } })).toBe(true)
      expect(extractToolCalling({ capabilities: { function_calling: false } })).toBe(false)
    })

    it('reads reasoning under its aliases', () => {
      expect(extractReasoning({ reasoning: true })).toBe(true)
      expect(extractReasoning({ supports_reasoning: true })).toBe(true)
      expect(extractReasoning({ capabilities: { reasoning: false } })).toBe(false)
    })

    it('reads attachment from attachment or vision hints', () => {
      expect(extractAttachment({ attachment: true })).toBe(true)
      expect(extractAttachment({ supports_vision: true })).toBe(true)
      expect(extractAttachment({ capabilities: { vision: true } })).toBe(true)
    })

    it('reads temperature', () => {
      expect(extractTemperature({ temperature: false })).toBe(false)
      expect(extractTemperature({ capabilities: { temperature: true } })).toBe(true)
    })

    it('does not coerce truthy strings to booleans', () => {
      expect(extractToolCalling({ tool_call: 'yes' })).toBeUndefined()
      expect(extractReasoning({ reasoning: 1 })).toBeUndefined()
    })
  })

  describe('hasAnyCapabilityMetadata', () => {
    it('is false for a bare OpenAI-spec model object', () => {
      const openaiSpec = { id: 'gpt-x', object: 'model', created: 1, owned_by: 'openai' }
      expect(hasAnyCapabilityMetadata(openaiSpec)).toBe(false)
      expect(hasAnyCapabilityMetadata({ id: 'gpt-x', shutdown_date: null })).toBe(false)
    })

    it('is true once any capability field appears', () => {
      expect(hasAnyCapabilityMetadata({ id: 'x', context_window: 128000 })).toBe(true)
      expect(hasAnyCapabilityMetadata({ id: 'x', supports_tools: true })).toBe(true)
    })
  })
})
