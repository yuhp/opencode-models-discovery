import type { ModelValidationError, AutoFixSuggestion, SimilarModel } from '../types'

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

// Enhanced model similarity matching
export function findSimilarModels(targetModel: string, availableModels: string[]): SimilarModel[] {
  const target = targetModel.toLowerCase()
  const targetTokens = target.split(/[-_\s]/).filter(Boolean)
  
  return availableModels
    .map(model => {
      const candidate = model.toLowerCase()
      const candidateTokens = candidate.split(/[-_\s]/).filter(Boolean)
      
      let similarity = 0
      const reasons: string[] = []
      
      // Exact match gets highest score
      if (candidate === target) {
        similarity = 1.0
        reasons.push("Exact match")
      }
      
      // Check for common model family prefixes
      const targetPrefix = targetTokens[0]
      const candidatePrefix = candidateTokens[0]
      if (targetPrefix && candidatePrefix && targetPrefix === candidatePrefix) {
        similarity += 0.5
        reasons.push(`Same family: ${targetPrefix}`)
      }
      
      // Check for common suffixes (quantization levels, sizes)
      const commonSuffixes = ['3b', '7b', '13b', '70b', 'q4', 'q8', 'instruct', 'chat', 'base']
      for (const suffix of commonSuffixes) {
        if (target.includes(suffix) && candidate.includes(suffix)) {
          similarity += 0.2
          reasons.push(`Shared suffix: ${suffix}`)
        }
      }
      
      // Token overlap score
      const commonTokens = targetTokens.filter(token => candidateTokens.includes(token))
      if (commonTokens.length > 0) {
        similarity += (commonTokens.length / Math.max(targetTokens.length, candidateTokens.length)) * 0.3
        reasons.push(`Common tokens: ${commonTokens.join(', ')}`)
      }
      
      return {
        model,
        similarity: Math.min(similarity, 1.0),
        reason: reasons.join(", ")
      }
    })
    .filter(item => item.similarity > 0.1) // Only include models with some similarity
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5) // Top 5 suggestions
}

// Retry logic with exponential backoff
export async function retryWithBackoff<T>(
  operation: () => Promise<T>, 
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<{ success: boolean; result?: T; error?: string }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation()
      return { success: true, result }
    } catch (error) {
      if (attempt === maxRetries) {
        return { 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        }
      }
      
      const delay = baseDelay * Math.pow(2, attempt)
      console.warn(`[opencode-model-discovery] Retrying operation after ${delay}ms`, { 
        attempt: attempt + 1, 
        maxRetries: maxRetries + 1,
        error: error instanceof Error ? error.message : String(error)
      })
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  return { success: false, error: "Max retries exceeded" }
}

// Smart error categorization
export function categorizeError(error: any, context: { baseURL: string; modelId: string }): ModelValidationError {
  const errorStr = String(error).toLowerCase()
  const { baseURL, modelId } = context
  
  // Network/connection issues
  if (errorStr.includes('econnrefused') || errorStr.includes('fetch failed') || errorStr.includes('network')) {
    return {
      type: 'offline',
      severity: 'critical',
      message: `Cannot connect to provider at ${baseURL}. Ensure the server is running and accessible.`,
      canRetry: true,
      autoFixAvailable: true
    }
  }

  // Timeout issues
  if (errorStr.includes('timeout') || errorStr.includes('aborted')) {
    return {
      type: 'timeout',
      severity: 'medium',
      message: `Request timed out. This might happen with large models or slow systems.`,
      canRetry: true,
      autoFixAvailable: false
    }
  }

  // Model not found
  if (errorStr.includes('404') || errorStr.includes('not found')) {
    return {
      type: 'not_found',
      severity: 'high',
      message: `Model '${modelId}' not found. Check if model is available in the provider.`,
      canRetry: false,
      autoFixAvailable: false
    }
  }

  // Permission issues
  if (errorStr.includes('401') || errorStr.includes('403') || errorStr.includes('unauthorized')) {
    return {
      type: 'permission',
      severity: 'high',
      message: `Authentication or permission issue. Check your provider configuration.`,
      canRetry: false,
      autoFixAvailable: false
    }
  }
  
  // Unknown errors
  return {
    type: 'unknown',
    severity: 'medium',
    message: `Unexpected error: ${errorStr}`,
    canRetry: true,
    autoFixAvailable: false
  }
}

// Generate auto-fix suggestions
export function generateAutoFixSuggestions(errorCategory: ModelValidationError): AutoFixSuggestion[] {
  const suggestions: AutoFixSuggestion[] = []

  switch (errorCategory.type) {
    case 'offline':
      suggestions.push({
        action: "Check if provider server is running",
        steps: [
          "1. Verify the server application is running",
          "2. Verify the server is started",
          "3. Check the server URL and port",
          "4. Ensure the server is not blocked by firewall"
        ],
        automated: false
      })
      suggestions.push({
        action: "Try alternative ports",
        steps: [
          "1. Check if provider is running on a different port",
          "2. Common ports: 1234 (LM Studio), 8080 (LocalAI), 11434 (Ollama)",
          "3. Update your OpenCode configuration with the correct port"
        ],
        automated: false
      })
      break

    case 'not_found':
      suggestions.push({
        action: "Check model availability",
        steps: [
          "1. Verify the model is available in your provider",
          "2. Download or load the model if needed",
          "3. Ensure the model is properly installed"
        ],
        automated: false
      })
      break

    case 'timeout':
      suggestions.push({
        action: "Increase timeout or use smaller model",
        steps: [
          "1. Try a smaller model version",
          "2. Increase request timeout in OpenCode settings",
          "3. Close other applications to free up system resources"
        ],
        automated: false
      })
      break
  }

  return suggestions
}