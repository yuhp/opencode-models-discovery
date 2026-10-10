import { promises as fs } from 'node:fs'
import path from 'node:path'
import { xdgData } from 'xdg-basedir'
import { isDiscoveredRawModel } from '../core/model-types'
import { sanitizeSensitiveFields } from '../core/discovery-cache'

const STATE_VERSION = 2
const PLUGIN_DATA_DIRECTORY = 'opencode-models-discovery'
const PROVIDERS_DIRECTORY = 'providers'

export interface ProviderModelStoreIdentity {
  id: string
  baseURL: string
  endpoint: string
}

export type ProviderModelOverride = Record<string, unknown>

export interface ProviderModelState {
  version: typeof STATE_VERSION
  provider: ProviderModelStoreIdentity
  fetchedAt: string
  models: Record<string, Record<string, unknown> & { id: string }>
  /** Raw discovery responses used to re-run the shared pipeline on cache hits. */
  rawModels?: Record<string, Record<string, unknown> & { id: string }>
  overrides?: Record<string, ProviderModelOverride>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasSameIdentity(actual: ProviderModelStoreIdentity, expected: ProviderModelStoreIdentity): boolean {
  return actual.id === expected.id && actual.baseURL === expected.baseURL && actual.endpoint === expected.endpoint
}

function isIdentity(value: unknown): value is ProviderModelStoreIdentity {
  return isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.baseURL === 'string' &&
    typeof value.endpoint === 'string'
}

function isOverrides(value: unknown): value is Record<string, ProviderModelOverride> {
  return isPlainObject(value) && Object.entries(value).every(([modelID, override]) => modelID.length > 0 && isPlainObject(override))
}

function isProviderModelState(value: unknown): value is ProviderModelState {
  if (!isPlainObject(value) || value.version !== STATE_VERSION || !isIdentity(value.provider) ||
    typeof value.fetchedAt !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !isPlainObject(value.models) || !Object.entries(value.models).every(([modelID, model]) =>
      modelID.length > 0 && isDiscoveredRawModel(model) && model.id === modelID)) {
    return false
  }

  return (value.rawModels === undefined || (isPlainObject(value.rawModels) && Object.entries(value.rawModels).every(([modelID, model]) =>
    modelID.length > 0 && isDiscoveredRawModel(model) && model.id === modelID
  ))) && (value.overrides === undefined || isOverrides(value.overrides))
}

function sanitizeModels(models: Record<string, Record<string, unknown> & { id: string }>): Record<string, Record<string, unknown> & { id: string }> {
  return Object.fromEntries(Object.entries(models).map(([modelID, model]) => [
    modelID,
    sanitizeSensitiveFields(model) as Record<string, unknown> & { id: string },
  ]))
}

export function getProviderStateFileName(providerID: string): string {
  return `provider-${encodeURIComponent(providerID)}.json`
}

export function isInventoryFresh(state: ProviderModelState, ttlSeconds: number, now: number = Date.now()): boolean {
  return Date.parse(state.fetchedAt) + ttlSeconds * 1000 > now
}

export class ProviderModelStore {
  private readonly providersDirectory: string | undefined

  constructor(rootDirectory: string | undefined = xdgData) {
    this.providersDirectory = rootDirectory
      ? path.join(rootDirectory, PLUGIN_DATA_DIRECTORY, PROVIDERS_DIRECTORY)
      : undefined
  }

  getStatePath(providerID: string): string | undefined {
    return this.providersDirectory ? path.join(this.providersDirectory, getProviderStateFileName(providerID)) : undefined
  }

  async read(identity: ProviderModelStoreIdentity): Promise<ProviderModelState | undefined> {
    const statePath = this.getStatePath(identity.id)
    if (!statePath) {
      return undefined
    }

    try {
      const state = JSON.parse(await fs.readFile(statePath, 'utf8')) as unknown
      return isProviderModelState(state) && hasSameIdentity(state.provider, identity) ? state : undefined
    } catch {
      return undefined
    }
  }

  async saveModels(
    identity: ProviderModelStoreIdentity,
    models: Record<string, Record<string, unknown> & { id: string }>,
    previousState?: ProviderModelState,
    rawModels?: Record<string, Record<string, unknown> & { id: string }>,
  ): Promise<boolean> {
    const statePath = this.getStatePath(identity.id)
    if (!statePath) {
      return false
    }

    const state: ProviderModelState = {
      version: STATE_VERSION,
      provider: identity,
      fetchedAt: new Date().toISOString(),
      models: sanitizeModels(models),
      ...(rawModels ? { rawModels: sanitizeModels(rawModels) } : {}),
      ...(previousState?.overrides && Object.keys(previousState.overrides).length > 0
        ? { overrides: previousState.overrides }
        : {}),
    }
    const temporaryPath = path.join(path.dirname(statePath), `.${path.basename(statePath)}.${process.pid}.${Date.now()}.tmp`)

    try {
      await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 })
      await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
      await fs.rename(temporaryPath, statePath)
      return true
    } catch {
      try {
        await fs.unlink(temporaryPath)
      } catch {
        // A failed cleanup must not affect discovery.
      }
      return false
    }
  }
}

export function createProviderModelStore(rootDirectory?: string): ProviderModelStore {
  return new ProviderModelStore(rootDirectory)
}

export function mergeModelOverride(base: Record<string, unknown>, override: ProviderModelOverride | undefined): Record<string, unknown> {
  if (!override) {
    return base
  }

  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (key === 'id') {
      continue
    }

    const current = merged[key]
    merged[key] = isPlainObject(current) && isPlainObject(value)
      ? mergeModelOverride(current, value)
      : value
  }
  return merged
}
