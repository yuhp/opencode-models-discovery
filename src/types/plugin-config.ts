export interface PluginConfig {
  providers?: {
    include?: string[]
    exclude?: string[]
  }
  models?: {
    includeRegex?: string[]
    excludeRegex?: string[]
  }
  discovery?: {
    enabled?: boolean
  }
  smartModelName?: boolean
}

export interface ProviderDiscoveryConfig {
  enabled?: boolean
  models?: {
    includeRegex?: string[]
    excludeRegex?: string[]
  }
  smartModelName?: boolean
}

export interface ProviderFilter {
  include: string[]
  exclude: string[]
}

export interface DiscoveryConfig {
  enabled: boolean
}

export interface ModelRegexFilter {
  includeRegex: RegExp[]
  excludeRegex: RegExp[]
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  enabled: true,
}

export function shouldDiscoverProvider(
  providerName: string,
  filter: ProviderFilter
): boolean {
  if (filter.include.length > 0) {
    return filter.include.includes(providerName)
  }
  return !filter.exclude.includes(providerName)
}

export function getProviderFilter(config: PluginConfig): ProviderFilter {
  return {
    include: config.providers?.include || [],
    exclude: config.providers?.exclude || [],
  }
}

export function getDiscoveryConfig(config: PluginConfig): DiscoveryConfig {
  return {
    enabled: config.discovery?.enabled ?? DEFAULT_DISCOVERY_CONFIG.enabled,
  }
}

export function shouldDiscoverProviderWithOverride(
  providerName: string,
  filter: ProviderFilter,
  globalEnabled: boolean,
  providerConfig: ProviderDiscoveryConfig
): boolean {
  if (providerConfig.enabled === true) {
    return true
  }

  if (providerConfig.enabled === false) {
    return false
  }

  if (!globalEnabled) {
    return false
  }

  return shouldDiscoverProvider(providerName, filter)
}

function toRegExp(pattern: string, logger?: PluginLogger): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    if (logger) {
      logger.warn('Ignoring invalid model regex', { category: 'filtering', pattern })
    } else {
      console.warn(`[opencode-models-discovery] Ignoring invalid model regex: ${pattern}`)
    }
    return null
  }
}

export function getModelRegexFilter(config: PluginConfig, logger?: PluginLogger): ModelRegexFilter {
  return {
    includeRegex: (config.models?.includeRegex || []).map((pattern) => toRegExp(pattern, logger)).filter((pattern): pattern is RegExp => pattern !== null),
    excludeRegex: (config.models?.excludeRegex || []).map((pattern) => toRegExp(pattern, logger)).filter((pattern): pattern is RegExp => pattern !== null),
  }
}

export function getProviderModelRegexFilter(config: ProviderDiscoveryConfig, logger?: PluginLogger): ModelRegexFilter {
  return {
    includeRegex: (config.models?.includeRegex || []).map((pattern) => toRegExp(pattern, logger)).filter((pattern): pattern is RegExp => pattern !== null),
    excludeRegex: (config.models?.excludeRegex || []).map((pattern) => toRegExp(pattern, logger)).filter((pattern): pattern is RegExp => pattern !== null),
  }
}

export function shouldDiscoverModel(modelId: string, filter: ModelRegexFilter): boolean {
  if (filter.includeRegex.length > 0) {
    return filter.includeRegex.some((pattern) => pattern.test(modelId))
  }

  if (filter.excludeRegex.length > 0) {
    return !filter.excludeRegex.some((pattern) => pattern.test(modelId))
  }

  return true
}

export function parsePluginConfig(rawConfig: any): PluginConfig {
  if (!rawConfig) {
    return {}
  }

  if (Array.isArray(rawConfig)) {
    if (rawConfig.length >= 2 && typeof rawConfig[0] === 'string') {
      const configObj = rawConfig[1]
      if (configObj && typeof configObj === 'object') {
        return configObj as PluginConfig
      }
    }
    return {}
  }

  if (typeof rawConfig === 'object') {
    return rawConfig as PluginConfig
  }

  return {}
}
import type { PluginLogger } from '../plugin/logger'
