import type { OpenAIModel, OpenAIModelsResponse } from '../types'

const OPENAI_COMPATIBLE_MODELS_ENDPOINT = "/v1/models"

export interface ModelsDiscoveryResult {
  ok: boolean
  models: OpenAIModel[]
}

export function normalizeBaseURL(baseURL: string): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

export function buildAPIURL(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): string {
  const normalized = normalizeBaseURL(baseURL)
  return `${normalized}${endpoint}`
}

export async function discoverModelsFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT
): Promise<ModelsDiscoveryResult> {
  try {
    const url = buildAPIURL(baseURL, endpoint)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`
    }
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) {
      return { ok: false, models: [] }
    }

    const data = (await response.json()) as OpenAIModelsResponse
    return {
      ok: true,
      models: data.data ?? [],
    }
  } catch {
    return { ok: false, models: [] }
  }
}

export async function fetchModelsDirect(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): Promise<string[]> {
  try {
    const url = buildAPIURL(baseURL, endpoint)
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const data = (await response.json()) as OpenAIModelsResponse
    return data.data?.map(model => model.id) || []
  } catch {
    return []
  }
}

export async function autoDetectOpenAICompatibleProvider(): Promise<{ name: string; baseURL: string } | null> {
  const candidates = [
    { name: "LM Studio", ports: [1234, 8080, 11434] },
    { name: "Ollama", ports: [11434] },
    { name: "LocalAI", ports: [8080] },
  ]

  for (const candidate of candidates) {
    for (const port of candidate.ports) {
      const baseURL = `http://127.0.0.1:${port}`
      const discovery = await discoverModelsFromProvider(baseURL)
      if (discovery.ok) {
        return { name: candidate.name, baseURL }
      }
    }
  }
  return null
}

export function isOpenAICompatibleProvider(provider: any): boolean {
  return provider &&
         typeof provider === 'object' &&
         provider.npm === "@ai-sdk/openai-compatible"
}

export function hasOpenAICompatibleURL(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const baseURL = provider.options?.baseURL || ""
  return /\/v1(\/|$)/.test(baseURL)
}

export function hasModelsDiscoveryEndpoint(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const endpoint = provider.options?.modelsDiscovery?.endpoint
  return typeof endpoint === 'string' && endpoint.length > 0
}

export function canDiscoverModels(provider: any): boolean {
  return isOpenAICompatibleProvider(provider) || hasOpenAICompatibleURL(provider) || hasModelsDiscoveryEndpoint(provider)
}

export function isValidModel(model: any): model is { id: string; [key: string]: any } {
  return model &&
         typeof model === 'object' &&
         typeof model.id === 'string' &&
         model.id.length > 0
}
