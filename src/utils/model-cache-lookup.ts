import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

export interface CachedModelLimit {
  context?: number
  output?: number
}

export interface CachedModelCost {
  input?: number
  output?: number
  cache_read?: number
  cache_write?: number
}

export interface CachedModelInfo {
  limit?: CachedModelLimit
  cost?: CachedModelCost
  tool_call?: boolean
  reasoning?: boolean
  temperature?: boolean
  attachment?: boolean
  structured_output?: boolean
}

export type FlatModelsCache = Map<string, CachedModelInfo>

function getCachePaths(): string[] {
  const paths: string[] = []

  if (process.env.OPENCODE_MODELS_CACHE) {
    paths.push(process.env.OPENCODE_MODELS_CACHE)
  }

  const home = homedir()
  if (home) {
    paths.push(join(home, '.cache', 'opencode', 'models.json'))
  }

  if (process.env.LOCALAPPDATA) {
    paths.push(join(process.env.LOCALAPPDATA, 'opencode', 'cache', 'models.json'))
  }

  return paths
}

function flattenCache(rawCache: Record<string, { models?: Record<string, CachedModelInfo> }>): FlatModelsCache {
  const flat = new Map<string, CachedModelInfo>()

  for (const providerData of Object.values(rawCache)) {
    const models = providerData?.models
    if (!models) continue

    for (const [modelId, info] of Object.entries(models)) {
      if (!flat.has(modelId)) {
        flat.set(modelId, info)
      }
    }
  }

  return flat
}

export async function loadModelsCache(): Promise<FlatModelsCache | null> {
  const paths = getCachePaths()

  for (const path of paths) {
    try {
      const content = await readFile(path, 'utf-8')
      const parsed = JSON.parse(content) as Record<string, { models?: Record<string, CachedModelInfo> }>
      return flattenCache(parsed)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(
          `[opencode-models-discovery] Failed to load models cache from ${path}:`,
          error instanceof Error ? error.message : String(error)
        )
      }
      continue
    }
  }

  return null
}

function stripNamespace(modelId: string): string {
  return modelId.split('/').pop() || modelId
}

function normalizeModelId(modelId: string): string {
  return modelId
    .replace(/:.*$/, '')
    .replace(/[-_]/g, '')
    .toLowerCase()
}

export function findModelInCache(
  modelId: string,
  cache: FlatModelsCache,
  options?: { fuzzy?: boolean }
): CachedModelInfo | null {
  const fuzzy = options?.fuzzy ?? true

  const searchIds = [modelId]

  const stripped = stripNamespace(modelId)
  if (stripped !== modelId) {
    searchIds.push(stripped)
  }

  for (const id of searchIds) {
    const exact = cache.get(id)
    if (exact) return exact
  }

  if (fuzzy) {
    const normalizedTarget = normalizeModelId(modelId)
    for (const [cacheId, info] of cache.entries()) {
      if (normalizeModelId(cacheId) === normalizedTarget) {
        return info
      }
    }
  }

  return null
}

export function mergeModelConfig(
  modelConfig: Record<string, any>,
  cachedInfo: CachedModelInfo | null
): Record<string, any> {
  if (!cachedInfo) {
    return modelConfig
  }

  const merged = { ...modelConfig }

  if (cachedInfo.limit) {
    merged.limit = {
      context: cachedInfo.limit.context,
      output: cachedInfo.limit.output || 4096,
    }
  }

  if (cachedInfo.cost) {
    merged.cost = { ...cachedInfo.cost }
  }

  const booleanFlags = ['tool_call', 'reasoning', 'temperature', 'attachment', 'structured_output'] as const
  for (const flag of booleanFlags) {
    if (cachedInfo[flag] !== undefined) {
      merged[flag] = cachedInfo[flag]
    }
  }

  return merged
}
