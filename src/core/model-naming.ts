import { extractModelOwner, formatModelName } from '../utils/format-model-name'
import type { DiscoveredRawModel } from './model-types'

export interface NamedDiscoveredModel {
  readonly id: string
  readonly raw?: DiscoveredRawModel
  name: string
}

export function resolveModelOwner(model: Pick<NamedDiscoveredModel, 'id' | 'raw'>): string | undefined {
  if (typeof model.raw?.owned_by === 'string' && model.raw.owned_by.trim().length > 0) {
    return model.raw.owned_by.trim()
  }
  return extractModelOwner(model.id)
}

export function getOwnerLabel(model: Pick<NamedDiscoveredModel, 'id' | 'raw'>): string | undefined {
  const rawOwner = resolveModelOwner(model)
  if (!rawOwner) return undefined

  return rawOwner
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

export function resolveModelDisplayName(
  model: DiscoveredRawModel,
  smartModelName: boolean,
  metadataName?: unknown,
): string {
  if (!smartModelName) return model.id
  if (typeof metadataName === 'string' && metadataName.trim().length > 0) return metadataName.trim()
  return formatModelName(model as { id: string }) || model.id
}

/** Adds owner suffixes only to colliding names within the supplied provider. */
export function disambiguateModelNames<T extends NamedDiscoveredModel>(models: readonly T[]): void {
  const groups = new Map<string, T[]>()
  for (const model of models) {
    const group = groups.get(model.name) ?? []
    group.push(model)
    groups.set(model.name, group)
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue

    const labels = group.map(getOwnerLabel)
    const uniqueLabels = labels.every((label, index) => label && labels.indexOf(label) === index)
    for (const [index, model] of group.entries()) {
      const suffix = uniqueLabels ? labels[index] : model.id
      model.name = `${model.name} (${suffix ?? model.id})`
    }
  }
}
