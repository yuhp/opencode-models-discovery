import { ModelStatusCache } from '../cache/model-status-cache'
import { fetchModelsDirect } from '../utils/openai-compatible-api'

const modelStatusCache = new ModelStatusCache()

export function getLoadedModels(baseURL: string): Promise<string[]> {
  return modelStatusCache.getModels(baseURL, async () => {
    return await fetchModelsDirect(baseURL)
  })
}