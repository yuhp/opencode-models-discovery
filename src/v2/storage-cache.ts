import type { Plugin } from '@opencode/plugin'
import type { DiscoveryCacheBackend } from '../core/discovery-cache'

/** Adapts the host-managed V2 storage domain to the shared cache backend. */
export function createV2StorageCache(storage: Plugin.Context['storage']): DiscoveryCacheBackend {
  return {
    get: storage.get,
    set: storage.set,
    remove: storage.remove,
  }
}
