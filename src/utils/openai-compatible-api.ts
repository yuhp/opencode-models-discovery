import http from 'node:http'
import https from 'node:https'
import type { OpenAIModel, OpenAIModelsResponse } from '../types'

const OPENAI_COMPATIBLE_MODELS_ENDPOINT = "/v1/models"
const CLIENT_MODELS_ENDPOINT = "/v1/models?client_version="
const REQUEST_TIMEOUT_MS = 3000

const hasUsableNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

function mergeClientModelMetadata(model: OpenAIModel, clientModels: Record<string, unknown>[]): OpenAIModel {
  const metadata = clientModels.find((candidate) => candidate.id === model.id || candidate.slug === model.id)
  if (!metadata) return model

  const merged = { ...model }
  const contextWindow = hasUsableNumber(metadata.context_window)
    ? metadata.context_window
    : hasUsableNumber(metadata.max_context_window)
      ? metadata.max_context_window
      : metadata.context_length
  if (hasUsableNumber(contextWindow)) merged.context_window = contextWindow
  if (typeof metadata.default_reasoning_level === 'string') {
    merged.default_reasoning_level = metadata.default_reasoning_level
  }
  if (Array.isArray(metadata.supported_reasoning_levels)) {
    merged.supported_reasoning_levels = metadata.supported_reasoning_levels
  }
  if (Array.isArray(metadata.input_modalities)) {
    merged.input_modalities = metadata.input_modalities
  }
  return merged
}

export interface ModelsDiscoveryResult {
  ok: boolean
  models: OpenAIModel[]
}

export interface ModelInfoDiscoveryResult {
  ok: boolean
  data: unknown
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

function requestJson<T>(urlStr: string, headers: Record<string, string>): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (data: T | undefined) => {
      if (!settled) {
        settled = true
        resolve(data)
      }
    }

    const urlObj = new URL(urlStr)
    const mod = urlObj.protocol === 'https:' ? https : http

    const req = mod.get(urlObj, { headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => data += chunk)
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          finish(undefined)
          return
        }

        try {
          finish(JSON.parse(data) as T)
        } catch {
          finish(undefined)
        }
      })
      res.on('error', () => finish(undefined))
    })

    req.on('error', () => finish(undefined))
    req.on('timeout', () => {
      req.destroy()
      finish(undefined)
    })
  })
}

export async function discoverModelsFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT
): Promise<ModelsDiscoveryResult> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  const data = await requestJson<OpenAIModelsResponse>(url, headers)
  if (!data) return { ok: false, models: [] }

  const models = data.data ?? []
  if (endpoint !== OPENAI_COMPATIBLE_MODELS_ENDPOINT || models.length === 0) {
    return { ok: true, models }
  }

  const clientData = await requestJson<{ models?: Record<string, unknown>[] }>(
    buildAPIURL(baseURL, CLIENT_MODELS_ENDPOINT),
    headers
  )
  const clientModels = Array.isArray(clientData?.models) ? clientData.models : []
  return { ok: true, models: models.map((model) => mergeClientModelMetadata(model, clientModels)) }
}

export async function discoverModelInfoFromProvider(
  baseURL: string,
  apiKey?: string,
  endpoint: string = "/v1/model/info"
): Promise<ModelInfoDiscoveryResult> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`
  }

  const data = await requestJson<unknown>(url, headers)
  return data !== undefined ? { ok: true, data } : { ok: false, data: undefined }
}

export async function fetchModelsDirect(baseURL: string, endpoint: string = OPENAI_COMPATIBLE_MODELS_ENDPOINT): Promise<string[]> {
  const url = buildAPIURL(baseURL, endpoint)
  const headers = { "Content-Type": "application/json" }

  const data = await requestJson<OpenAIModelsResponse>(url, headers)
  return data?.data?.map(model => model.id) || []
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
