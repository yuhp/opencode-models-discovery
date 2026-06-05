const CACHE_VERSION = 1
const DEFAULT_TTL_MS = 3_600_000
const CACHE_FILE_NAME = 'models-discovery-cache.json'

type FsPromises = typeof import('node:fs/promises')

const memoryFiles = new Map<string, string>()
let fsPromises: FsPromises | null | undefined

async function getFs(): Promise<FsPromises | null> {
  if (fsPromises !== undefined) return fsPromises
  try {
    fsPromises = await import('node:fs/promises')
    return fsPromises
  } catch {
    fsPromises = null
    return null
  }
}

function joinPath(...parts: string[]): string {
  const [first = '', ...rest] = parts
  const absolutePrefix = first.startsWith('/') ? '/' : ''
  const start = first.replace(/[\\/]+$/g, '')
  const tail = rest.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, '')).filter(Boolean)
  const joined = [start, ...tail].filter(Boolean).join('/')
  if (absolutePrefix && !joined.startsWith('/')) return `${absolutePrefix}${joined}`
  return joined || absolutePrefix || '.'
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/g, '')
  const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (slash === -1) return '.'
  if (slash === 0) return normalized[0] ?? '/'
  return normalized.slice(0, slash)
}

function cacheTmpPath(filePath: string): string {
  return joinPath(dirname(filePath), `.${CACHE_FILE_NAME}.tmp.${process.pid}.${Date.now()}`)
}

export interface CachedProviderModels {
  key: string
  models: Record<string, any>
  discoveredAt: string
}

export interface ModelCacheData {
  version: typeof CACHE_VERSION
  timestamp: string
  providers: Record<string, CachedProviderModels>
}

export interface ModelCacheOptions {
  ttl?: number
  path?: string
  log?: (msg: string, extra?: Record<string, unknown>) => void
}

function defaultCacheDir(): string {
  if (process.env.VITEST) return joinPath(process.env.TMPDIR ?? '/tmp', 'opencode-models-discovery-cache')
  const xdg = process.env.XDG_CACHE_HOME
  if (xdg) return joinPath(xdg, 'opencode')
  const home = process.env.HOME ?? process.env.USERPROFILE
  if (home) return joinPath(home, '.cache', 'opencode')
  return joinPath(process.cwd(), '.opencode-cache')
}

function defaultCachePath(): string {
  return joinPath(defaultCacheDir(), CACHE_FILE_NAME)
}

function stale(data: ModelCacheData, ttlMs: number): boolean {
  return Date.now() - new Date(data.timestamp).getTime() > ttlMs
}

async function readTextFile(filePath: string): Promise<string | null> {
  const fs = await getFs()
  if (!fs) {
    return memoryFiles.get(filePath) ?? null
  }

  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

async function writeTextFile(filePath: string, contents: string): Promise<void> {
  const fs = await getFs()
  if (!fs) {
    memoryFiles.set(filePath, contents)
    return
  }

  const dir = dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmpPath = cacheTmpPath(filePath)
  await fs.writeFile(tmpPath, contents, 'utf-8')

  try {
    await fs.rename(tmpPath, filePath)
  } catch {
    await fs.writeFile(filePath, contents, 'utf-8')
    await fs.unlink(tmpPath).catch(() => {})
  }
}

async function deleteFile(filePath: string): Promise<void> {
  const fs = await getFs()
  if (!fs) {
    memoryFiles.delete(filePath)
    return
  }

  try {
    await fs.unlink(filePath)
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err
  }
}

export async function readCache(opts?: ModelCacheOptions): Promise<ModelCacheData | null> {
  const filePath = opts?.path ?? defaultCachePath()
  try {
    const raw = await readTextFile(filePath)
    if (!raw) return null
    const parsed: ModelCacheData = JSON.parse(raw)
    if (parsed.version !== CACHE_VERSION) return null
    return parsed
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      opts?.log?.('Failed to read cache', { path: filePath, error: err?.message ?? String(err) })
    }
    return null
  }
}

export async function writeCache(data: ModelCacheData, opts?: ModelCacheOptions): Promise<void> {
  const filePath = opts?.path ?? defaultCachePath()
  await writeTextFile(filePath, JSON.stringify(data))
  opts?.log?.('Cache written', { path: filePath })
}

export function isCacheFresh(data: ModelCacheData, opts?: ModelCacheOptions): boolean {
  return !stale(data, opts?.ttl ?? DEFAULT_TTL_MS)
}

export async function clearCache(opts?: ModelCacheOptions): Promise<void> {
  const filePath = opts?.path ?? defaultCachePath()
  try {
    await deleteFile(filePath)
  } catch {
  }
}

function fingerprint(value?: string): string {
  if (!value) return 'no-key'

  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `key-${(hash >>> 0).toString(16)}`
}

export function providerCacheKey(baseURL: string, endpoint: string, apiKey?: string): string {
  return `${baseURL}|${endpoint}|${fingerprint(apiKey)}`
}

export interface ModelCache {
  load(): Promise<ModelCacheData | null>
  readonly isFresh: boolean
  getProvider(providerName: string): Record<string, any> | null
  setProviders(providers: Record<string, CachedProviderModels>): Promise<void>
  clear(): Promise<void>
  readonly filePath: string
}

export function createModelCache(opts?: ModelCacheOptions): ModelCache {
  const resolvedOpts: ModelCacheOptions = { ttl: DEFAULT_TTL_MS, ...opts }
  let data: ModelCacheData | null = null

  return {
    async load(): Promise<ModelCacheData | null> {
      if (data) return data
      data = await readCache(resolvedOpts)
      return data
    },

    get isFresh(): boolean {
      if (!data) return false
      return isCacheFresh(data, resolvedOpts)
    },

    getProvider(providerName: string): Record<string, any> | null {
      return data?.providers[providerName]?.models ?? null
    },

    async setProviders(providers: Record<string, CachedProviderModels>): Promise<void> {
      const existing = data ?? (await readCache(resolvedOpts))
      data = {
        version: CACHE_VERSION,
        timestamp: new Date().toISOString(),
        providers: {
          ...(existing?.providers ?? {}),
          ...providers,
        },
      }
      await writeCache(data, resolvedOpts)
    },

    async clear(): Promise<void> {
      data = null
      await clearCache(resolvedOpts)
    },

    get filePath(): string {
      return resolvedOpts.path ?? defaultCachePath()
    },
  }
}
