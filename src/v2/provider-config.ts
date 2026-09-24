export interface ModelFieldFilter {
  readonly field: string
  readonly equals?: string | number | boolean | null
  readonly match?: string
}

export interface ProviderDiscoveryOptions {
  readonly enabled: boolean
  readonly endpoint: string
  readonly timeoutMs: number
  readonly includeRegex: RegExp[]
  readonly excludeRegex: RegExp[]
  readonly includeBy: ModelFieldFilter[]
  readonly excludeBy: ModelFieldFilter[]
  readonly smartModelName: boolean
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function regexes(value: unknown): RegExp[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((pattern) => {
    if (typeof pattern !== "string") return []
    try {
      return [new RegExp(pattern)]
    } catch {
      return []
    }
  })
}

function filters(value: unknown): ModelFieldFilter[] {
  if (!Array.isArray(value)) return []
  const result: ModelFieldFilter[] = []
  for (const filter of value) {
    const entry = object(filter)
    if (!entry || typeof entry.field !== "string") continue
    if (typeof entry.match === "string") {
      try {
        new RegExp(entry.match)
        result.push({ field: entry.field, match: entry.match })
      } catch {
        continue
      }
      continue
    }
    if (entry.equals === null || ["string", "number", "boolean"].includes(typeof entry.equals)) {
      result.push({ field: entry.field, equals: entry.equals as ModelFieldFilter["equals"] })
    }
  }
  return result
}

export function parseProviderDiscoveryOptions(raw: unknown): ProviderDiscoveryOptions | undefined {
  const value = object(raw)
  if (!value) return undefined
  if (value.enabled !== true) return undefined

  const models = object(value.models)
  const endpoint = typeof value.endpoint === "string" && value.endpoint.startsWith("/") ? value.endpoint : "/v1/models"
  const timeoutMs = typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs > 0
    ? Math.max(1_000, Math.floor(value.timeoutMs))
    : 5_000

  return {
    enabled: true,
    endpoint,
    timeoutMs,
    includeRegex: regexes(models?.includeRegex),
    excludeRegex: regexes(models?.excludeRegex),
    includeBy: filters(models?.includeBy),
    excludeBy: filters(models?.excludeBy),
    smartModelName: value.smartModelName === true,
  }
}
