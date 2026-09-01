export interface OpenAIModel {
  id: string
  object: string
  created: number
  owned_by: string
  [key: string]: unknown
}

export interface OpenAIModelsResponse {
  object: string
  data: OpenAIModel[]
}

export interface LiteLLMModelInfo {
  key?: string | null
  mode?: string | null
  max_tokens?: number | null
  max_input_tokens?: number | null
  max_output_tokens?: number | null
  supports_reasoning?: boolean | null
  supports_none_reasoning_effort?: boolean | null
  supports_minimal_reasoning_effort?: boolean | null
  supports_low_reasoning_effort?: boolean | null
  supports_medium_reasoning_effort?: boolean | null
  supports_high_reasoning_effort?: boolean | null
  supports_xhigh_reasoning_effort?: boolean | null
  supports_max_reasoning_effort?: boolean | null
  supported_openai_params?: string[] | null
  supports_vision?: boolean | null
  modalities?: {
    input?: string[] | null
    output?: string[] | null
  } | null
  supports_function_calling?: boolean | null
  input_cost_per_token?: number | null
  output_cost_per_token?: number | null
  cache_read_input_token_cost?: number | null
  cache_creation_input_token_cost?: number | null
}

export interface LiteLLMModelInfoEntry {
  model_name: string
  litellm_params?: {
    model?: string
  }
  model_info?: LiteLLMModelInfo
}

export interface LiteLLMModelInfoResponse {
  data: LiteLLMModelInfoEntry[]
}

export type ModelType = 'chat' | 'embedding' | 'unknown'

export type LoadingStatus = 'not_loaded' | 'loading' | 'loaded' | 'error'

export interface ModelLoadingState {
  status: LoadingStatus
  startTime?: number
  progress?: number
  eta?: number
  error?: string
}

export interface LMStudioLoadedInstance {
  config?: {
    context_length?: number
  }
}

export interface LMStudioCapabilities {
  vision?: boolean
  trained_for_tool_use?: boolean
  reasoning?: {
    allowed_options?: string[]
  }
}

export interface LMStudioInventoryModel {
  key?: string
  display_name?: string
  loaded_instances?: LMStudioLoadedInstance[]
  max_context_length?: number
  capabilities?: LMStudioCapabilities
}
