import { DEFAULT_MODELS_DEV_URL } from './models-dev-fetcher.js'

const PROVIDER_URL = 'https://models.dev/api.json'
type Efforts = readonly string[] | undefined
interface EffortIndex {
  routes: Map<string, Efforts>
  // A null route means more than one model has this short name.
  shortNames: Map<string, string | null>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function namedEfforts(options: unknown): Efforts {
  if (!Array.isArray(options)) return
  for (const option of options) {
    if (option?.type !== 'effort' || !Array.isArray(option.values)) continue
    const names: string[] = option.values.flatMap((value: unknown) =>
      typeof value === 'string' && value.trim() ? [value.trim()] : [],
    )
    // An explicit empty or default-only declaration takes precedence over the supplement.
    if (names.length || !option.values.length) return [...new Set(names.filter(name => name !== 'default'))]
  }
}

function indexEfforts(data: unknown, url: string): EffortIndex | undefined {
  if (!isObject(data)) return
  const routes = new Map<string, Efforts>()
  const shortNames = new Map<string, string | null>()
  const mirror = url !== DEFAULT_MODELS_DEV_URL && url !== PROVIDER_URL

  function add(key: string, row: Record<string, unknown>, provider?: string) {
    // Public keys identify provider routes, even when a gateway key contains slashes.
    // Mirrors use the same explicit ID projection as their ordinary model metadata.
    const id = mirror && typeof row.id === 'string' && row.id ? row.id : key
    const route = provider && !(mirror && id.includes('/')) ? provider + '/' + id : id
    if (!id.trim() || (!mirror && !route.includes('/'))) return

    const efforts = namedEfforts(row.reasoning_options)
    if (routes.has(route)) {
      const previous = routes.get(route)
      if (previous?.length !== efforts?.length || previous?.some(name => !efforts?.includes(name))) {
        routes.set(route, []) // Conflicting aliases cannot establish this route's efforts.
      }
      return
    }
    routes.set(route, efforts)
    const shortName = route.slice(route.indexOf('/') + 1)
    if (!shortName.includes('/')) shortNames.set(shortName, shortNames.has(shortName) ? null : route)
  }

  for (const [key, value] of Object.entries(data)) {
    if (!isObject(value)) continue
    if (url === PROVIDER_URL || (mirror && !key.includes('/') && isObject(value.models))) {
      if (!key.trim() || !isObject(value.models)) continue
      for (const [id, row] of Object.entries(value.models)) {
        if (isObject(row)) add(id, row, key)
      }
    } else {
      add(key, value)
    }
  }
  if (routes.size) return { routes, shortNames }
}

const indexCache = new Map<string, Promise<EffortIndex | undefined>>()

async function fetchIndex(url: string): Promise<EffortIndex | undefined> {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) })
    if (response.ok) return indexEfforts(await response.json(), url)
  } catch {
    // The optional catalog can be retried on a later discovery.
  }
}

function loadIndex(url: string): Promise<EffortIndex | undefined> {
  const cached = indexCache.get(url)
  if (cached) return cached
  const pending = fetchIndex(url).then(index => {
    if (!index) indexCache.delete(url)
    return index
  })
  indexCache.set(url, pending)
  return pending
}

export async function loadModelsDevEfforts(endpoint = DEFAULT_MODELS_DEV_URL): Promise<(modelID: string) => Efforts> {
  const [primary, supplement] = await Promise.all([
    loadIndex(endpoint),
    endpoint === DEFAULT_MODELS_DEV_URL ? loadIndex(PROVIDER_URL) : undefined,
  ])
  return modelID => {
    let route: string | null | undefined = modelID
    if (!modelID.includes('/')) {
      if (!primary) return // A missing primary index cannot establish a unique short name.
      route = primary.routes.has(modelID) ? modelID : primary.shortNames.get(modelID)
      if (route === undefined) route = supplement?.shortNames.get(modelID)
    }
    if (route == null) return
    const efforts = primary?.routes.get(route) ?? supplement?.routes.get(route)
    return efforts?.length ? efforts : undefined
  }
}

export const modelsDevEffortsTestUtils = { resetCache: () => indexCache.clear() }
