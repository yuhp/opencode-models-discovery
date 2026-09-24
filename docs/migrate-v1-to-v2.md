# Migrating Configuration from OpenCode v1 to OpenCode v2

This guide explains how to migrate `opencode-models-discovery` configuration between the OpenCode v1 and OpenCode v2 host formats.

OpenCode v2 support is currently in beta. The package contains separate adapters for the two host generations, so changing the configuration shape is required when moving a project from one host to the other.

## Configuration shape mapping

| OpenCode v1 | OpenCode v2 |
|---|---|
| `plugin` | `plugins` |
| `plugin: ["opencode-models-discovery"]` | `plugins: ["opencode-models-discovery@1.6.1"]` |
| `provider` | `providers` |
| `provider.<id>.npm` | `providers.<id>.package` |
| `provider.<id>.options` | `providers.<id>.settings` |
| `provider.<id>.options.baseURL` | `providers.<id>.settings.baseURL` |
| `provider.<id>.options.apiKey` | `providers.<id>.settings.apiKey` |
| `provider.<id>.options.modelsDiscovery` | `providers.<id>.settings.modelsDiscovery` |
| `provider.<id>.models` | `providers.<id>.models` |

The V2 provider package for OpenAI-compatible discovery is normally:

```json
"package": "@opencode-ai/ai/providers/openai-compatible"
```

The V1 package commonly uses:

```json
"npm": "@ai-sdk/openai-compatible"
```

## Before: OpenCode v1

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My Gateway",
      "options": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": "${GATEWAY_API_KEY}",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "models.dev",
          "smartModelName": true,
          "models": {
            "includeBy": [{ "field": "id", "match": "^(gpt|gemini)" }],
            "excludeBy": [{ "field": "id", "match": "image" }]
          }
        }
      }
    }
  }
}
```

## After: OpenCode v2

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@1.6.1"
  ],
  "providers": {
    "gateway": {
      "package": "@opencode-ai/ai/providers/openai-compatible",
      "name": "My Gateway",
      "settings": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": "${GATEWAY_API_KEY}",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "models.dev",
          "smartModelName": true,
          "models": {
            "includeBy": [{ "field": "id", "match": "^(gpt|gemini)" }],
            "excludeBy": [{ "field": "id", "match": "image" }]
          }
        }
      }
    }
  }
}
```

## Migration steps

1. Keep a backup of the working `opencode.json`.
2. Replace the V1 `plugin` array with the V2 `plugins` array of package names.
3. Rename `provider` to `providers`.
4. Move each provider's `npm` value to `package`.
5. Move each provider's `options` object to `settings`.
6. Keep `baseURL`, `apiKey`, and `modelsDiscovery` inside `settings`.
7. Set `modelsDiscovery.enabled` to `true` explicitly for every provider that should be discovered.
8. Check the discovery endpoint. V2 defaults to `/v1/models`; use `"endpoint": "/models"` for providers such as DeepSeek that expose a different path.
9. Restart OpenCode v2. If using the background service, run `opencode service restart` after changing a local plugin build or its configuration.

## Options that do not migrate directly

The following V1 behavior is not currently available in the OpenCode v2 adapter:

- `modelsDiscovery.cache` persisted disk discovery state
- cache-associated per-model overrides
- `/models-discovery:config` management of cached inventory and overrides
- V1 `auth.json` and `OPENCODE_AUTH_CONTENT` credential fallback
- `/models-discovery:migrate`
- V1 startup config-hook behavior

OpenCode v2 uses its provider registry and keeps discovered models in the background service's in-memory inventory. The same service can reuse the inventory across sessions. When the service restarts, the plugin runs normal discovery again. Disk persistence is therefore not required for the initial v2 beta; it may be added later for offline startup or restart recovery. The v2 agent tools `models_discovery_refresh` and `models_discovery_status` are available to the agent; they are not slash commands.

## Credentials

Do not copy real API keys into a public configuration example. Prefer an environment placeholder resolved by OpenCode v2:

```json
"apiKey": "${GATEWAY_API_KEY}"
```

Alternatively, omit `apiKey` when the provider host supplies credentials through its own supported mechanism. OpenCode v2 currently does not use the V1 plugin's auth-store fallback.

## Running both host generations

The published package contains both adapters. A V1 configuration is consumed by OpenCode v1, while a V2 configuration is consumed by OpenCode v2. Do not combine the `plugin`/`provider` V1 keys and the `plugins`/`providers` V2 keys in one configuration unless the host documentation explicitly supports that arrangement.

For the detailed option reference, see the [configuration guide](configuration.md). For the V1-only cache and auth behavior, see [persisted model discovery](persisted-model-discovery.md) and [connect and auth](connect-and-auth.md).
