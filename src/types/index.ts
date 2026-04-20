export interface OpenAIModel {
  id: string
  object: string
  created: number
  owned_by: string
}

export interface OpenAIModelsResponse {
  object: string
  data: OpenAIModel[]
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

export type LMStudioModel = OpenAIModel
export type LMStudioModelsResponse = OpenAIModelsResponse
