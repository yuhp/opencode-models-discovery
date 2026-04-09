import type { ValidationResult } from './validation-result'
import { canDiscoverModels } from '../openai-compatible-api'

export function validateConfig(config: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!config || typeof config !== 'object') {
    errors.push('Config must be an object')
    return { isValid: false, errors, warnings }
  }

  if (config.provider && typeof config.provider === 'object') {
    for (const [providerName, providerConfig] of Object.entries(config.provider)) {
      const p = providerConfig as any

      if (canDiscoverModels(p)) {
        if (!p.options?.baseURL) {
          warnings.push(`Provider '${providerName}' missing baseURL`)
        }
        if (p.models && typeof p.models !== 'object') {
          errors.push(`Provider '${providerName}' models must be an object`)
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}