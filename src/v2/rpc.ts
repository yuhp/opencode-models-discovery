import { Rpc } from "@opencode/schema/rpc"

export interface RpcModelValues {
  readonly name: string
  readonly limit: { readonly context: number; readonly output: number; readonly input?: number }
  readonly capabilities: { readonly tools: boolean; readonly input: string[]; readonly output: string[] }
  readonly reasoning?: boolean
  readonly attachment?: boolean
}

export interface RpcDiscoveryFailureEvent {
  readonly providerID: string
  readonly status?: number
  readonly statusText?: string
  readonly message: string
  readonly isAuthError?: boolean
}

export interface RpcRefreshInput {
  readonly force?: boolean
}

export interface RpcRefreshOutput {
  readonly providers: number
  readonly models: number
  readonly failures?: readonly RpcDiscoveryFailureEvent[]
}

export interface RpcStatusInput {
  readonly providerID?: string
  readonly details?: boolean
  readonly rawCache?: boolean
}

export interface RpcStatusOutput {
  readonly report: string
  readonly providers: readonly {
    readonly id: string
    readonly name: string
    readonly modelCount: number
    readonly error?: RpcDiscoveryFailureEvent
    readonly models: readonly { readonly id: string; readonly name: string; readonly detail: string; readonly override?: RpcModelOverride; readonly defaultValues?: RpcModelValues }[]
  }[]
}

export interface RpcCacheEntry {
  readonly providerID: string
  readonly status: "fresh" | "expired" | "empty" | "corrupt"
  readonly fetchedAt?: string
  readonly ttlSeconds?: number
  readonly modelCount?: number
}

export interface RpcCacheInspectInput {
  readonly providerID?: string
}

export interface RpcCacheInspectOutput {
  readonly entries: readonly RpcCacheEntry[]
}

export interface RpcCacheClearInput {
  readonly providerID?: string
}

export interface RpcCacheClearOutput {
  readonly cleared: number
}

export interface RpcModelOverride {
  readonly providerID: string
  readonly modelID: string
  readonly patch: Record<string, unknown>
  readonly enabled: boolean
  readonly updatedAt: string
}

export interface RpcOverrideListInput {
  readonly providerID?: string
}

export interface RpcOverrideListOutput {
  readonly overrides: readonly RpcModelOverride[]
}

export interface RpcOverrideSetInput {
  readonly providerID: string
  readonly modelID: string
  readonly patch: Record<string, unknown>
  readonly enabled?: boolean
}

export interface RpcOverrideSetOutput {
  readonly success: boolean
  readonly override?: RpcModelOverride
}

export interface RpcOverrideDeleteInput {
  readonly providerID: string
  readonly modelID: string
}

export interface RpcOverrideDeleteOutput {
  readonly success: boolean
}

export const DiscoveryRpcDefinition = Rpc.define({
  id: "opencode.models-discovery",
  methods: {
    status: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          details: { type: "boolean" },
          rawCache: { type: "boolean" },
        },
      },
      output: {
        type: "object",
        properties: {
          report: { type: "string" },
          providers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                modelCount: { type: "number" },
                error: {
                  type: "object",
                  properties: {
                    providerID: { type: "string" },
                    status: { type: "number" },
                    statusText: { type: "string" },
                    message: { type: "string" },
                    isAuthError: { type: "boolean" },
                  },
                  required: ["providerID", "message"],
                },
                models: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      detail: { type: "string" },
                      override: { type: "object" },
                      defaultValues: { type: "object" },
                    },
                    required: ["id", "name", "detail"],
                  },
                },
              },
              required: ["id", "name", "modelCount", "models"],
            },
          },
        },
        required: ["report", "providers"],
      },
    },
    refresh: {
      input: {
        type: "object",
        properties: {
          force: { type: "boolean" },
        },
      },
      output: {
        type: "object",
        properties: {
          providers: { type: "number" },
          models: { type: "number" },
          failures: {
            type: "array",
            items: {
              type: "object",
              properties: {
                providerID: { type: "string" },
                status: { type: "number" },
                statusText: { type: "string" },
                message: { type: "string" },
                isAuthError: { type: "boolean" },
              },
              required: ["providerID", "message"],
            },
          },
        },
        required: ["providers", "models"],
      },
    },
    cacheInspect: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
        },
      },
      output: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                providerID: { type: "string" },
                status: { type: "string" },
                fetchedAt: { type: "string" },
                ttlSeconds: { type: "number" },
                modelCount: { type: "number" },
              },
              required: ["providerID", "status"],
            },
          },
        },
        required: ["entries"],
      },
    },
    cacheClear: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
        },
      },
      output: {
        type: "object",
        properties: {
          cleared: { type: "number" },
        },
        required: ["cleared"],
      },
    },
    overrideList: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
        },
      },
      output: {
        type: "object",
        properties: {
          overrides: {
            type: "array",
            items: {
              type: "object",
              properties: {
                providerID: { type: "string" },
                modelID: { type: "string" },
                patch: { type: "object" },
                enabled: { type: "boolean" },
                updatedAt: { type: "string" },
              },
              required: ["providerID", "modelID", "patch", "enabled", "updatedAt"],
            },
          },
        },
        required: ["overrides"],
      },
    },
    overrideSet: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          modelID: { type: "string" },
          patch: { type: "object" },
          enabled: { type: "boolean" },
        },
        required: ["providerID", "modelID", "patch"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          override: {
            type: "object",
            properties: {
              providerID: { type: "string" },
              modelID: { type: "string" },
              patch: { type: "object" },
              enabled: { type: "boolean" },
              updatedAt: { type: "string" },
            },
            required: ["providerID", "modelID", "patch", "enabled", "updatedAt"],
          },
        },
        required: ["success"],
      },
    },
    overrideDelete: {
      input: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          modelID: { type: "string" },
        },
        required: ["providerID", "modelID"],
      },
      output: {
        type: "object",
        properties: {
          success: { type: "boolean" },
        },
        required: ["success"],
      },
    },
  },
  events: {
    discoveryFailed: {
      schema: {
        type: "object",
        properties: {
          providerID: { type: "string" },
          status: { type: "number" },
          statusText: { type: "string" },
          message: { type: "string" },
          isAuthError: { type: "boolean" },
        },
        required: ["providerID", "message"],
      },
    },
  },
})
