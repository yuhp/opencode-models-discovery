import type { ModelEnrichmentResult } from './model-enrichment'

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export interface DiscoveryCacheIdentity {
  readonly providerID: string
  readonly baseURL: string
  readonly endpoint: string
  readonly modelInfoFormat?: string
  readonly modelInfoEndpoint?: string
}

export interface DiscoveryCacheEntry {
  readonly version: 1
  readonly identity: DiscoveryCacheIdentity
  readonly fetchedAt: string
  readonly rawModels: readonly Record<string, unknown>[]
  readonly enrichments: Record<string, ModelEnrichmentResult>
}

export interface DiscoveryCacheBackend {
  readonly get: (key: string) => Promise<JsonValue | undefined>
  readonly set: (key: string, value: JsonValue) => Promise<void>
  readonly remove?: (key: string) => Promise<void>
}

export function discoveryCacheKey(namespace: string, providerID: string): string {
  return `${namespace}:provider:${encodeURIComponent(providerID)}`
}

export function isDiscoveryCacheFresh(fetchedAt: string, ttlSeconds: number, now: number = Date.now()): boolean {
  const timestamp = Date.parse(fetchedAt)
  return Number.isFinite(timestamp) && timestamp + ttlSeconds * 1000 > now
}

function sameOptional(left: string | undefined, right: string | undefined): boolean {
  return left === right
}

export function parseDiscoveryCacheEntry(
  value: unknown,
  identity: DiscoveryCacheIdentity,
  ttlSeconds: number,
  now: number = Date.now(),
): DiscoveryCacheEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entry = value as Partial<DiscoveryCacheEntry>
  if (entry.version !== 1 || !entry.identity || typeof entry.fetchedAt !== 'string') return undefined
  if (entry.identity.providerID !== identity.providerID ||
    entry.identity.baseURL !== identity.baseURL ||
    entry.identity.endpoint !== identity.endpoint ||
    !sameOptional(entry.identity.modelInfoFormat, identity.modelInfoFormat) ||
    !sameOptional(entry.identity.modelInfoEndpoint, identity.modelInfoEndpoint) ||
    !isDiscoveryCacheFresh(entry.fetchedAt, ttlSeconds, now) ||
    !Array.isArray(entry.rawModels) ||
    !entry.enrichments || typeof entry.enrichments !== 'object' || Array.isArray(entry.enrichments)) {
    return undefined
  }
  return entry as DiscoveryCacheEntry
}

export function createDiscoveryCacheEntry(
  identity: DiscoveryCacheIdentity,
  rawModels: readonly Record<string, unknown>[],
  enrichments: Record<string, ModelEnrichmentResult>,
  fetchedAt: string = new Date().toISOString(),
): DiscoveryCacheEntry {
  return {
    version: 1,
    identity,
    fetchedAt,
    rawModels: sanitizeSensitiveFields(rawModels) as readonly Record<string, unknown>[],
    enrichments: sanitizeSensitiveFields(enrichments) as Record<string, ModelEnrichmentResult>,
  }
}

export function sanitizeSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSensitiveFields)
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const cleaned: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (/^(api[-_]?key|authorization|token|password|secret|credentials?)$/i.test(key)) {
      continue
    }
    cleaned[key] = sanitizeSensitiveFields(child)
  }
  return cleaned
}

export async function readDiscoveryCache(
  backend: DiscoveryCacheBackend,
  key: string,
  identity: DiscoveryCacheIdentity,
  ttlSeconds: number,
): Promise<DiscoveryCacheEntry | undefined> {
  try {
    return parseDiscoveryCacheEntry(await backend.get(key), identity, ttlSeconds)
  } catch {
    return undefined
  }
}

export async function writeDiscoveryCache(
  backend: DiscoveryCacheBackend,
  key: string,
  entry: DiscoveryCacheEntry,
): Promise<boolean> {
  try {
    await backend.set(key, entry as unknown as JsonValue)
    return true
  } catch {
    return false
  }
}
