export interface ActiveConnection {
  readonly type?: string
  readonly id?: string
  readonly name?: string
  readonly [key: string]: unknown
}

export interface ResolvedCredentialValue {
  readonly type?: string
  readonly key?: string
  readonly access?: string
  readonly [key: string]: unknown
}

export interface CredentialResolutionIntegration<TConn = any> {
  readonly connection?: {
    readonly active?: (integrationID: string) => Promise<TConn | undefined>
    readonly resolve?: (connection: TConn) => Promise<ResolvedCredentialValue | undefined>
  }
}

export interface CredentialResolutionContext<TConn = any> {
  readonly integration?: CredentialResolutionIntegration<TConn>
}

export interface ProviderForCredentialResolution {
  readonly id: string
  readonly settings: Record<string, unknown>
  readonly apiKey?: string
}

export async function resolveProviderCredential(
  ctx: CredentialResolutionContext,
  provider: ProviderForCredentialResolution,
  defaultIntegrationID?: (id: string) => string,
): Promise<string | undefined> {
  // 1. Explicit provider.settings.apiKey takes highest priority
  if (typeof provider.settings.apiKey === "string" && provider.settings.apiKey.trim().length > 0) {
    return provider.settings.apiKey.trim()
  }

  // 2. Pre-resolved provider.apiKey (if already provided)
  if (typeof provider.apiKey === "string" && provider.apiKey.trim().length > 0) {
    return provider.apiKey.trim()
  }

  const integration = ctx.integration
  if (!integration?.connection?.active || !integration?.connection?.resolve) {
    return undefined
  }

  // Candidate integration IDs to check in order
  const candidates: string[] = []
  if (typeof provider.settings.integrationID === "string" && provider.settings.integrationID.trim().length > 0) {
    candidates.push(provider.settings.integrationID.trim())
  }
  if (defaultIntegrationID) {
    const defId = defaultIntegrationID(provider.id)
    if (!candidates.includes(defId)) candidates.push(defId)
  }
  if (!candidates.includes(provider.id)) {
    candidates.push(provider.id)
  }

  for (const id of candidates) {
    try {
      const connection = await integration.connection.active(id)
      if (!connection) continue

      if (connection.type === "env" && typeof connection.name === "string") {
        const envVal = process.env[connection.name]
        if (typeof envVal === "string" && envVal.trim().length > 0) {
          return envVal.trim()
        }
      }

      const credential = await integration.connection.resolve(connection)
      if (credential?.type === "key" && typeof credential.key === "string" && credential.key.trim().length > 0) {
        return credential.key.trim()
      }
      if (credential?.type === "oauth" && typeof credential.access === "string" && credential.access.trim().length > 0) {
        return credential.access.trim()
      }
    } catch {
      // Failure resolving a specific connection candidate is non-fatal
    }
  }

  return undefined
}
