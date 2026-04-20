export { formatModelName, extractModelOwner } from './format-model-name'

// Categorize models by type
export function categorizeModel(modelId: string): 'chat' | 'embedding' | 'unknown' {
  const lowerId = modelId.toLowerCase()
  if (lowerId.includes('embedding') || lowerId.includes('embed')) {
    return 'embedding'
  }
  if (lowerId.includes('gpt') || lowerId.includes('llama') || 
      lowerId.includes('claude') || lowerId.includes('qwen') ||
      lowerId.includes('mistral') || lowerId.includes('gemma') ||
      lowerId.includes('phi') || lowerId.includes('falcon')) {
    return 'chat'
  }
  return 'unknown'
}
