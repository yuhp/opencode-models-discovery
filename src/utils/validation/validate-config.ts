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
      const forceDiscoveryEnabled = p.options?.modelsDiscovery?.enabled === true
      const discoveryConfig = p.options?.modelsDiscovery
      const discoveryModels = p.options?.modelsDiscovery?.models

      if (forceDiscoveryEnabled || canDiscoverModels(p)) {
        if (!p.options?.baseURL) {
          warnings.push(`Provider '${providerName}' missing baseURL`)
        }
        if (p.models && typeof p.models !== 'object') {
          errors.push(`Provider '${providerName}' models must be an object`)
        }
      }

      if (discoveryModels && typeof discoveryModels === 'object') {
        validateModelFieldFilters(providerName, 'includeBy', discoveryModels.includeBy, errors)
        validateModelFieldFilters(providerName, 'excludeBy', discoveryModels.excludeBy, errors)
      }

      if (discoveryConfig && typeof discoveryConfig === 'object') {
        warnMisplacedModelFieldFilters(providerName, discoveryConfig, warnings)
        validateDiscoveryEndpoint(providerName, discoveryConfig.endpoint, errors)
        validateTimeoutMs(providerName, discoveryConfig.timeoutMs, errors)
        validateCache(providerName, discoveryConfig.cache, errors)
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

function validateDiscoveryEndpoint(providerName: string, value: unknown, errors: string[]): void {
  if (value === undefined) {
    return
  }

  if (typeof value !== 'string' || !value.startsWith('/')) {
    errors.push(`Provider '${providerName}' modelsDiscovery.endpoint must be an origin-relative path starting with /`)
  }
}

function validateTimeoutMs(providerName: string, value: unknown, errors: string[]): void {
  if (value === undefined) {
    return
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`Provider '${providerName}' modelsDiscovery.timeoutMs must be a positive finite number`)
  }
}

function validateCache(providerName: string, value: unknown, errors: string[]): void {
  if (value === undefined) {
    return
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`Provider '${providerName}' modelsDiscovery.cache must be an object`)
    return
  }

  const cache = value as Record<string, unknown>
  if (cache.enabled !== undefined && typeof cache.enabled !== 'boolean') {
    errors.push(`Provider '${providerName}' modelsDiscovery.cache.enabled must be a boolean`)
  }

  if (cache.ttlSeconds !== undefined &&
    (typeof cache.ttlSeconds !== 'number' || !Number.isFinite(cache.ttlSeconds) || cache.ttlSeconds < 0)) {
    errors.push(`Provider '${providerName}' modelsDiscovery.cache.ttlSeconds must be a non-negative finite number`)
  }
}

function warnMisplacedModelFieldFilters(providerName: string, discoveryConfig: Record<string, unknown>, warnings: string[]): void {
  for (const key of ['includeBy', 'excludeBy'] as const) {
    if (Object.prototype.hasOwnProperty.call(discoveryConfig, key)) {
      warnings.push(`Provider '${providerName}' modelsDiscovery.${key} is ignored; use modelsDiscovery.models.${key} instead`)
    }
  }
}

function validateModelFieldFilters(providerName: string, key: 'includeBy' | 'excludeBy', value: unknown, errors: string[]): void {
  if (value === undefined) {
    return
  }

  if (!Array.isArray(value)) {
    errors.push(`Provider '${providerName}' modelsDiscovery.models.${key} must be an array`)
    return
  }

  value.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      errors.push(`Provider '${providerName}' modelsDiscovery.models.${key}[${index}] must be an object`)
      return
    }

    const field = (rule as any).field
    const hasEquals = Object.prototype.hasOwnProperty.call(rule, 'equals')
    const hasMatch = Object.prototype.hasOwnProperty.call(rule, 'match')
    const equals = (rule as any).equals
    const match = (rule as any).match

    if (typeof field !== 'string' || field.length === 0) {
      errors.push(`Provider '${providerName}' modelsDiscovery.models.${key}[${index}].field must be a non-empty string`)
    }

    if (hasEquals === hasMatch) {
      errors.push(`Provider '${providerName}' modelsDiscovery.models.${key}[${index}] must include exactly one of equals or match`)
      return
    }

    if (hasEquals && !(equals === null || ['string', 'number', 'boolean'].includes(typeof equals))) {
      errors.push(`Provider '${providerName}' modelsDiscovery.models.${key}[${index}].equals must be a string, number, boolean, or null`)
    }

    if (hasMatch && typeof match !== 'string') {
      errors.push(`Provider '${providerName}' modelsDiscovery.models.${key}[${index}].match must be a string`)
    }
  })
}
