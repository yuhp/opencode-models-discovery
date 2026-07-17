export interface ModelInfoEnricher {
  shouldSkipModel(modelId: string): boolean
  getModelName?(modelId: string): string | undefined
  applyModelInfo(modelConfig: any, modelId: string, rawModel?: Record<string, unknown>): void
}

export interface ModelInfoEnricherOptions {
  filterNonChat: boolean
}
