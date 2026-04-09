// UI notification system for LM Studio plugin
export class ToastNotifier {
  private client: any // OpenCode client
  
  constructor(client: any) {
    this.client = client
  }
  
  // Show success toast
  async success(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-model-discovery] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: 'success',
          duration: duration || 3000
        }
      })
    } catch (error) {
      console.error(`[opencode-model-discovery] Failed to show success toast`, error)
    }
  }
  
  // Show error toast
  async error(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-model-discovery] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: 'error',
          duration: duration || 5000
        }
      })
    } catch (error) {
      console.error(`[opencode-model-discovery] Failed to show error toast`, error)
    }
  }
  
  // Show warning toast
  async warning(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-model-discovery] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: 'warning',
          duration: duration || 4000
        }
      })
    } catch (error) {
      console.error(`[opencode-model-discovery] Failed to show warning toast`, error)
    }
  }
  
  // Show info toast
  async info(message: string, title?: string, duration?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-model-discovery] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message,
          variant: 'info',
          duration: duration || 3000
        }
      })
    } catch (error) {
      console.error(`[opencode-model-discovery] Failed to show info toast`, error)
    }
  }
  
  // Show loading toast with progress
  async progress(message: string, title?: string, progress?: number): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-model-discovery] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: {
          title,
          message: progress !== undefined ? `${message} (${progress}%)` : message,
          variant: 'info',
          duration: progress !== undefined ? 0 : 2000 // No auto-dismiss if showing progress
        }
      })
    } catch (error) {
      console.error(`[opencode-model-discovery] Failed to show progress toast`, error)
    }
  }
  
  // Show detailed toast with actions
  async detailed(options: {
    title?: string
    message: string
    variant?: 'info' | 'success' | 'warning' | 'error'
    duration?: number
  }): Promise<void> {
    try {
      if (!this.client?.tui?.showToast) {
        console.warn('[opencode-model-discovery] Toast API not available (client.tui.showToast missing)')
        return
      }
      await this.client.tui.showToast({
        body: {
          title: options.title,
          message: options.message,
          variant: options.variant || 'info',
          duration: options.duration
        }
      })
    } catch (error) {
      console.error(`[opencode-model-discovery] Failed to show detailed toast`, error)
    }
  }
}