import type { LoadingStatus, ModelLoadingState } from '../types'

// Model Loading State Monitor with periodic polling
export class ModelLoadingMonitor {
  private loadingStates = new Map<string, ModelLoadingState>()
  private pollingIntervals = new Map<string, NodeJS.Timeout>()
  private readonly POLL_INTERVAL = 2000 // 2 seconds
  private readonly LOADING_TIMEOUT = 300000 // 5 minutes
  
  // Start monitoring a specific model
  startMonitoring(modelId: string, baseURL: string): void {
    const currentState = this.loadingStates.get(modelId) || { status: 'not_loaded' }
      
    if (currentState.status === 'loading') {
      return // Already monitoring
    }
    
    this.loadingStates.set(modelId, {
      status: 'loading',
      startTime: Date.now(),
      progress: 0
    })
    
    console.info(`[opencode-models-discovery-wz] Started monitoring model loading`, { modelId, baseURL })
    
    // Clear any existing interval
    this.stopMonitoring(modelId)
    
    // Start polling
    const interval = setInterval(() => {
      this.checkLoadingProgress(modelId, baseURL, async () => [])
    }, this.POLL_INTERVAL)
    
    this.pollingIntervals.set(modelId, interval)
    
    // Set timeout
    setTimeout(() => {
      const state = this.loadingStates.get(modelId)
      if (state && state.status === 'loading') {
        this.updateState(modelId, 'error', undefined, undefined, 'Loading timeout after 5 minutes')
      }
    }, this.LOADING_TIMEOUT)
  }
  
  // Stop monitoring a model
  stopMonitoring(modelId: string): void {
    const interval = this.pollingIntervals.get(modelId)
    if (interval) {
      clearInterval(interval)
      this.pollingIntervals.delete(modelId)
    }
  }
  
  // Check loading progress
  private async checkLoadingProgress(modelId: string, baseURL: string, getModelsFn?: () => Promise<string[]>): Promise<void> {
    try {
      const models = await getModelsFn?.() || []
      
      const isLoaded = models.includes(modelId)
      const state = this.loadingStates.get(modelId)
      
      if (!state || state.status !== 'loading') {
        this.stopMonitoring(modelId)
        return
      }
      
      if (isLoaded) {
        const duration = Date.now() - (state.startTime || Date.now())
        this.updateState(modelId, 'loaded', 100, 0)
        this.stopMonitoring(modelId)
        console.info(`[opencode-models-discovery-wz] Model loading completed`, {
          modelId,
          duration: `${duration}ms`,
          totalModels: this.loadingStates.size
        })
      } else {
        // Estimate progress based on time elapsed
        const elapsed = Date.now() - (state.startTime || Date.now())
        const progress = Math.min(90, (elapsed / this.LOADING_TIMEOUT) * 100)
        const eta = Math.max(0, this.LOADING_TIMEOUT - elapsed)
        
        this.updateState(modelId, 'loading', progress, eta)
      }
    } catch (error) {
      this.updateState(modelId, 'error', undefined, undefined, 
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  
  // Update loading state
  private updateState(
    modelId: string, 
    status: LoadingStatus,
    progress?: number,
    eta?: number,
    error?: string
  ): void {
    const currentState = this.loadingStates.get(modelId) || { status: 'not_loaded' }
    
    const newState = {
      ...currentState,
      status,
      progress,
      eta,
      error
    }
    
    this.loadingStates.set(modelId, newState)
    
    // Log state changes
    if (currentState.status !== status) {
      if (status === 'loaded') {
        console.info(`[opencode-models-discovery-wz] Model loading completed`, { modelId })
      } else if (status === 'error') {
        console.warn(`[opencode-models-discovery-wz] Model loading failed`, { modelId, error })
      } else if (status === 'loading') {
        console.info(`[opencode-models-discovery-wz] Model loading started`, { modelId })
      }
    }
  }
  
  // Get current state
  getState(modelId: string): ModelLoadingState | undefined {
    return this.loadingStates.get(modelId)
  }
  
  // Get all monitoring states
  getAllStates(): Map<string, ModelLoadingState> {
    return new Map(this.loadingStates)
  }
  
  // Cleanup all monitoring
  cleanup(): void {
    for (const [modelId, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval)
      this.pollingIntervals.delete(modelId)
    }
    this.loadingStates.clear()
  }
}
