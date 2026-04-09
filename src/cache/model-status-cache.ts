import type { CacheStats } from '../types'

// Model Status Cache for reducing API calls
export class ModelStatusCache {
  private cache = new Map<string, {
    models: string[]
    timestamp: number
    ttl: number
  }>()
  
  private readonly DEFAULT_TTL = 15000 // 15 seconds (reduced for better freshness)
  private readonly MAX_CACHE_SIZE = 50 // Prevent memory leaks
  
  // Get cached model status or fetch fresh data
  async getModels(baseURL: string, fetchFn: () => Promise<string[]>): Promise<string[]> {
    const now = Date.now()
    const cached = this.cache.get(baseURL)
    
    // Return cached data if still valid
    if (cached && (now - cached.timestamp) < cached.ttl) {
      return cached.models
    }
    
    // Fetch fresh data
    try {
      const models = await fetchFn()
      
      // Update cache with new data
      this.cache.set(baseURL, {
        models: [...models], // Create copy to prevent mutations
        timestamp: now,
        ttl: this.DEFAULT_TTL
      })
      
      // Prevent cache from growing too large
      if (this.cache.size > this.MAX_CACHE_SIZE) {
        this.cleanup()
      }
      
      
      return models
    } catch (error) {
      // If we have stale cached data, return it as fallback but mark as potentially invalid
      if (cached) {
        console.warn(`[opencode-model-discovery] Using stale cache data due to fetch error`, { 
          baseURL, 
          age: now - cached.timestamp,
          error: error instanceof Error ? error.message : String(error) 
        })
        // Invalidate cache if it's very old (> 5x TTL)
        if (now - cached.timestamp > cached.ttl * 5) {
          this.invalidate(baseURL)
        }
        return cached.models
      }
      throw error
    }
  }
  
  // Invalidate cache for specific URL
  invalidate(baseURL: string): void {
    this.cache.delete(baseURL)
  }
  
  // Invalidate entire cache
  invalidateAll(): void {
    this.cache.clear()
  }
  
  // Force refresh for specific URL (useful after model changes)
  async forceRefresh(baseURL: string, fetchFn: () => Promise<string[]>): Promise<string[]> {
    this.invalidate(baseURL)
    return this.getModels(baseURL, fetchFn)
  }
  
  // Get cache statistics
  getStats(): CacheStats {
    const now = Date.now()
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.entries()).map(([baseURL, data]) => ({
        baseURL,
        age: now - data.timestamp,
        modelCount: data.models.length,
        ttl: data.ttl
      }))
    }
  }
  
  // Cleanup old entries to prevent memory leaks
  private cleanup(): void {
    const now = Date.now()
    const toDelete: string[] = []
    
    for (const [baseURL, data] of this.cache.entries()) {
      // Delete entries older than 5x TTL or if cache is too large
      if (now - data.timestamp > data.ttl * 5 || this.cache.size > this.MAX_CACHE_SIZE) {
        toDelete.push(baseURL)
      }
    }
    
    toDelete.forEach(baseURL => this.cache.delete(baseURL))
    
    if (toDelete.length > 0) {
    }
  }
  
  // Configure TTL for specific use cases
  setTTL(baseURL: string, ttl: number): void {
    const cached = this.cache.get(baseURL)
    if (cached) {
      cached.ttl = ttl
    }
  }
  
  // Check if cache entry exists and is valid
  isValid(baseURL: string): boolean {
    const cached = this.cache.get(baseURL)
    const now = Date.now()
    return cached !== undefined && (now - cached.timestamp) < cached.ttl
  }
}