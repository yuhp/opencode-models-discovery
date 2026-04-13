import type { PluginInput } from '@opencode-ai/plugin'

const SERVICE_NAME = 'opencode-models-discovery'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogExtra = Record<string, unknown>

type PluginClient = PluginInput['client'] | null | undefined

export interface PluginLogger {
  debug(message: string, extra?: LogExtra): void
  info(message: string, extra?: LogExtra): void
  warn(message: string, extra?: LogExtra): void
  error(message: string, extra?: LogExtra): void
  child(extra: LogExtra): PluginLogger
}

function getConsoleMethod(level: LogLevel): typeof console.log {
  if (level === 'error') {
    return console.error
  }

  if (level === 'warn') {
    return console.warn
  }

  if (level === 'debug') {
    return console.debug
  }

  return console.info
}

function mergeExtra(baseExtra: LogExtra, extra?: LogExtra): LogExtra | undefined {
  const merged = {
    ...baseExtra,
    ...extra,
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function fallbackToConsole(level: LogLevel, message: string, extra?: LogExtra) {
  const log = getConsoleMethod(level)
  const prefix = `[${SERVICE_NAME}] ${message}`

  if (extra && Object.keys(extra).length > 0) {
    log(prefix, extra)
    return
  }

  log(prefix)
}

export function createPluginLogger(client?: PluginClient, baseExtra: LogExtra = {}): PluginLogger {
  const log = (level: LogLevel, message: string, extra?: LogExtra) => {
    const mergedExtra = mergeExtra(baseExtra, extra)

    try {
      if (client?.app?.log) {
        void client.app.log({
          body: {
            service: SERVICE_NAME,
            level,
            message,
            extra: mergedExtra,
          },
        }).catch(() => {
          fallbackToConsole(level, message, mergedExtra)
        })
        return
      }
    } catch {
      // Fall back to console logging when structured logging is unavailable.
    }

    fallbackToConsole(level, message, mergedExtra)
  }

  return {
    debug(message, extra) {
      log('debug', message, extra)
    },
    info(message, extra) {
      log('info', message, extra)
    },
    warn(message, extra) {
      log('warn', message, extra)
    },
    error(message, extra) {
      log('error', message, extra)
    },
    child(extra) {
      return createPluginLogger(client, mergeExtra(baseExtra, extra) || {})
    },
  }
}
