import { validateHookInput } from '../utils/validation'
import type { PluginLogger } from './logger'

export function createEventHook(
  logger: PluginLogger,
  invalidateCache?: () => Promise<void>,
) {
  return async ({ event }: { event: any }) => {
    const validation = validateHookInput('event', { event })
    if (!validation.isValid) {
      logger.error('Invalid event input', { errors: validation.errors })
      return
    }

    if (event.type === "session.created" || event.type === "session.updated") {
      return
    }

    if (
      event.type === "command.executed"
      && event.properties?.name === "models"
      && typeof event.properties?.arguments === "string"
      && event.properties.arguments.includes("--refresh")
    ) {
      logger.info("Models refresh detected, clearing discovery cache")
      await invalidateCache?.()
    }
  }
}
