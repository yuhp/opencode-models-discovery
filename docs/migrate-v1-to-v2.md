# Migrating Configuration from OpenCode v1 to OpenCode v2

This guide explains how to migrate `opencode-models-discovery` configuration between the OpenCode v1 and OpenCode v2 host formats.

OpenCode v2 is the stable, primary integration. The package contains separate adapters for the two host generations, so changing the configuration shape is required when moving a project from one host to the other. Existing OpenCode v1 users may remain on the legacy adapter while planning migration.

## Configuration shape mapping

| OpenCode v1 | OpenCode v2 |
|---|---|
| `plugin` | `plugins` |
| `plugin: ["opencode-models-discovery"]` | `plugins: ["opencode-models-discovery@2.0.1"]` |
| `provider` | `providers` |
| `provider.<id>.npm` | `providers.<id>.package` |
| `provider.<id>.options` | `providers.<id>.settings` |
| `provider.<id>.options.baseURL` | `providers.<id>.settings.baseURL` |
| `provider.<id>.options.apiKey` | `providers.<id>.settings.apiKey` |
| `provider.<id>.options.modelsDiscovery` | `providers.<id>.settings.modelsDiscovery` |
| `provider.<id>.models` | `providers.<id>.models` |

The V2 provider package for OpenAI-compatible discovery is normally:

```json
"package": "@opencode/ai/providers/openai-compatible"
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

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@2.0.1"
  ],
  "providers": {
    "gateway": {
      "package": "@opencode/ai/providers/openai-compatible",
      "name": "My Gateway",
      "settings": {
        "baseURL": "https://gateway.example.com/v1",
        // Optional: omit if managing credentials interactively via OpenCode '/connect'
        "apiKey": "{env:GATEWAY_API_KEY}",
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

V2 caching is optional and independent from the V1 disk cache. V2 model overrides are also independent and use the `overrides:<providerID>:<modelID>` host-storage namespace. If desired, add the following under the V2 provider's `settings.modelsDiscovery`:

```json
"cache": {
  "enabled": true,
  "ttlSeconds": 86400
}
```

This stores raw discovery models and enrichment results through the host-provided storage API. V1 cache files are not imported. Use `/models-discovery-console` to inspect models and edit supported V2 overrides without changing provider configuration.

## Options that do not migrate directly

The following V1 behavior does not migrate directly to the OpenCode v2 adapter:

- V1 `modelsDiscovery.cache` persisted disk discovery state and its XDG file format
- V1 cache-associated per-model override files and `/models-discovery:config` management
- `/models-discovery:config` management of cached inventory and overrides
- V1 `auth.json` and `OPENCODE_AUTH_CONTENT` credential fallback
- `/models-discovery:migrate`
- V1 startup config-hook behavior

OpenCode v2 uses its provider registry and keeps discovered models in the background service's inventory. When enabled, V2 also persists raw discovery responses and enrichment results through the host-provided storage API, separately from the V1 disk-cache format. V2 caching is disabled by default and can be inspected with `models_discovery_status` and `rawCache: true`. The V2 agent tools `models_discovery_refresh` and `models_discovery_status` are available to the agent, and `/models-discovery-refresh` and `/models-discovery-console` are available as direct TUI commands. V1 remains a supported legacy compatibility path with separate cache and credential behavior.

## Credentials

Do not copy real API keys into a public configuration example. Prefer an environment placeholder resolved by OpenCode v2:

```jsonc
"apiKey": "{env:GATEWAY_API_KEY}"
```

Alternatively, omit `apiKey` entirely and use OpenCode v2's native `/connect` command. When you connect a provider via `/connect`, the plugin resolves credentials dynamically through OpenCode v2's integration API and injects runtime authentication headers. OpenCode v2 uses this native integration architecture instead of reading V1 `auth.json` files from disk. See [Connect and Auth Documentation](connect-and-auth.md) for full details.

## Running both host generations

The published package contains both adapters. A V1 configuration is consumed by OpenCode v1, while a V2 configuration is consumed by OpenCode v2. Do not combine the `plugin`/`provider` V1 keys and the `plugins`/`providers` V2 keys in one configuration unless the host documentation explicitly supports that arrangement.

For the detailed option reference, see the [configuration guide](configuration.md). For the V1-only cache and auth behavior, see [persisted model discovery](persisted-model-discovery.md) and [connect and auth](connect-and-auth.md).
