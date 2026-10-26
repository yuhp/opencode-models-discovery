/**
 * Resolves a model-info endpoint against a provider base URL.
 *
 * Absolute URLs are returned unchanged. Endpoints starting with "/" are
 * resolved against the provider origin, which is the common case for native
 * endpoints such as Ollama's /api/show. Other relative paths are resolved
 * against the provider base URL.
 */
export function buildModelInfoURL(baseURL: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint
  }
  return endpoint.startsWith('/')
    ? new URL(endpoint, new URL(baseURL).origin).toString()
    : new URL(endpoint, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString()
}
