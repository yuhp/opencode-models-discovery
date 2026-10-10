import type { DiscoveredRawModel } from './model-types'

export interface ModelFieldFilter {
  readonly field: string
  readonly equals?: string | number | boolean | null
  readonly match?: RegExp
}

export interface ModelFilter {
  readonly includeBy: readonly ModelFieldFilter[]
  readonly excludeBy: readonly ModelFieldFilter[]
  readonly includeRegex: readonly RegExp[]
  readonly excludeRegex: readonly RegExp[]
}

function matchesField(model: DiscoveredRawModel, filter: ModelFieldFilter): boolean {
  if (!Object.prototype.hasOwnProperty.call(model, filter.field)) return false

  const value = model[filter.field]
  if (filter.match) {
    filter.match.lastIndex = 0
    return typeof value === 'string' && filter.match.test(value)
  }

  return value === filter.equals
}

function matchesRegex(regex: RegExp, value: string): boolean {
  regex.lastIndex = 0
  return regex.test(value)
}

/**
 * Applies the shared discovery filter contract. Exclusions always win over
 * inclusions, including when both regex lists are configured.
 */
export function matchesModelFilter(model: DiscoveredRawModel, filter: ModelFilter): boolean {
  if (filter.excludeBy.some((entry) => matchesField(model, entry))) return false
  if (filter.excludeRegex.some((regex) => matchesRegex(regex, model.id))) return false
  if (filter.includeBy.length > 0 && !filter.includeBy.some((entry) => matchesField(model, entry))) return false
  if (filter.includeRegex.length > 0 && !filter.includeRegex.some((regex) => matchesRegex(regex, model.id))) return false
  return true
}
