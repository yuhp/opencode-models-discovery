import { validateHookInput } from '../utils/validation'
import type { PluginLogger } from './logger'

export function createEventHook(logger: PluginLogger) {
  return async ({ event }: { event: any }) => {
    const validation = validateHookInput('event', { event })
    if (!validation.isValid) {
      logger.error('Invalid event input', { errors: validation.errors })
      return
    }
    
    if (event.type === "session.created" || event.type === "session.updated") {
      // Reserved for future session-aware discovery diagnostics.
    }
  }
}
