export { formatModelName, extractModelOwner } from './format-model-name'

export function isEmbeddingModel(modelId: string): boolean {
  const lowerId = modelId.toLowerCase()
  return lowerId.includes('embedding') || lowerId.includes('embed')
}
