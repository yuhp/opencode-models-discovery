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

export function indexEfforts(data: unknown, layout: 'flat' | 'providers' | 'mirror'): EffortIndex | undefined {
  if (!isObject(data)) return
  const routes = new Map<string, Efforts>()
  const shortNames = new Map<string, string | null>()
  const mirror = layout === 'mirror'

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
    if (layout === 'providers' || (mirror && !key.includes('/') && isObject(value.models))) {
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

export function matchModelsDevEfforts(primary?: EffortIndex, supplement?: EffortIndex): (modelID: string) => Efforts {
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
