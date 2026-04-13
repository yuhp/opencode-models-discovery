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
    ttl?: number
  }
}

export interface ProviderFilter {
  include: string[]
  exclude: string[]
}

export interface DiscoveryConfig {
  enabled: boolean
  ttl: number
}

export interface ModelRegexFilter {
  includeRegex: RegExp[]
  excludeRegex: RegExp[]
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  enabled: true,
  ttl: 15000,
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
    ttl: config.discovery?.ttl ?? DEFAULT_DISCOVERY_CONFIG.ttl,
  }
}

function toRegExp(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    console.warn(`[opencode-model-discovery] Ignoring invalid model regex: ${pattern}`)
    return null
  }
}

export function getModelRegexFilter(config: PluginConfig): ModelRegexFilter {
  return {
    includeRegex: (config.models?.includeRegex || []).map(toRegExp).filter((pattern): pattern is RegExp => pattern !== null),
    excludeRegex: (config.models?.excludeRegex || []).map(toRegExp).filter((pattern): pattern is RegExp => pattern !== null),
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
