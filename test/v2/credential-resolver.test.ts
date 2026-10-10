import { describe, expect, it, vi } from "vitest"
import { resolveProviderCredential, type CredentialResolutionContext } from "../../src/v2/credential-resolver.js"

describe("resolveProviderCredential", () => {
  it("prefers explicit settings.apiKey when provided", async () => {
    const ctx: CredentialResolutionContext = {
      integration: {
        connection: {
          active: vi.fn().mockResolvedValue({ id: "conn-1" }),
          resolve: vi.fn().mockResolvedValue({ type: "key", key: "integration-key" }),
        },
      },
    }

    const key = await resolveProviderCredential(ctx, {
      id: "my-provider",
      settings: { apiKey: "explicit-key" },
    })

    expect(key).toBe("explicit-key")
    expect(ctx.integration?.connection?.active).not.toHaveBeenCalled()
  })

  it("resolves key-type credential from active integration connection", async () => {
    const active = vi.fn().mockImplementation(async (id: string) => {
      if (id === "opencode.models-discovery.my-provider") {
        return { type: "credential", id: "conn-1" }
      }
      return undefined
    })
    const resolve = vi.fn().mockResolvedValue({ type: "key", key: "sk-integration-secret" })

    const ctx: CredentialResolutionContext = {
      integration: { connection: { active, resolve } },
    }

    const key = await resolveProviderCredential(
      ctx,
      { id: "my-provider", settings: {} },
      (id) => `opencode.models-discovery.${id}`,
    )

    expect(key).toBe("sk-integration-secret")
    expect(active).toHaveBeenCalledWith("opencode.models-discovery.my-provider")
    expect(resolve).toHaveBeenCalledWith({ type: "credential", id: "conn-1" })
  })

  it("resolves oauth-type credential using access token", async () => {
    const active = vi.fn().mockResolvedValue({ type: "credential", id: "conn-oauth" })
    const resolve = vi.fn().mockResolvedValue({ type: "oauth", access: "gho_token123", refresh: "ghr_refresh" })

    const ctx: CredentialResolutionContext = {
      integration: { connection: { active, resolve } },
    }

    const key = await resolveProviderCredential(ctx, {
      id: "github-copilot",
      settings: {},
    })

    expect(key).toBe("gho_token123")
  })

  it("resolves env-type connection from process.env", async () => {
    process.env["TEST_RESOLVER_API_KEY"] = "sk-from-env"

    const active = vi.fn().mockResolvedValue({ type: "env", name: "TEST_RESOLVER_API_KEY" })
    const resolve = vi.fn()

    const ctx: CredentialResolutionContext = {
      integration: { connection: { active, resolve } },
    }

    const key = await resolveProviderCredential(ctx, {
      id: "env-provider",
      settings: {},
    })

    expect(key).toBe("sk-from-env")
    expect(resolve).not.toHaveBeenCalled()

    delete process.env["TEST_RESOLVER_API_KEY"]
  })

  it("honors settings.integrationID override", async () => {
    const active = vi.fn().mockImplementation(async (id: string) => {
      if (id === "custom-integration-id") {
        return { type: "credential", id: "conn-custom" }
      }
      return undefined
    })
    const resolve = vi.fn().mockResolvedValue({ type: "key", key: "custom-secret" })

    const ctx: CredentialResolutionContext = {
      integration: { connection: { active, resolve } },
    }

    const key = await resolveProviderCredential(ctx, {
      id: "provider-x",
      settings: { integrationID: "custom-integration-id" },
    })

    expect(key).toBe("custom-secret")
    expect(active).toHaveBeenCalledWith("custom-integration-id")
  })

  it("returns undefined when connection or resolution fails", async () => {
    const active = vi.fn().mockRejectedValue(new Error("Connection lookup failed"))
    const resolve = vi.fn()

    const ctx: CredentialResolutionContext = {
      integration: { connection: { active, resolve } },
    }

    const key = await resolveProviderCredential(ctx, {
      id: "failing-provider",
      settings: {},
    })

    expect(key).toBeUndefined()
  })

  it("returns undefined when no integration context exists", async () => {
    const key = await resolveProviderCredential({}, {
      id: "plain-provider",
      settings: {},
    })

    expect(key).toBeUndefined()
  })
})
