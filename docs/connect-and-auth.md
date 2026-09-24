# `/connect` and Auth-Backed Discovery

For custom OpenAI-compatible providers, you still need to define the provider in `opencode.json` so OpenCode and this plugin know the provider id, npm package, and `baseURL`.

This page documents the OpenCode v1 `/connect` and auth-store integration. OpenCode v2 support is currently in beta and does not use the V1 auth-store fallback; configure credentials in `providers.<id>.settings` according to the [V2 configuration guide](configuration.md#opencode-v2-configuration-beta-support).

However, you do not have to hardcode `options.apiKey` when the provider credential is managed through OpenCode `/connect`.

## Example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-models-discovery@latest"
  ],
  "provider": {
    "test_provider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Test Provider",
      "options": {
        "baseURL": "http://127.0.0.1:4000/v1",
        "modelsDiscovery": {
          "enabled": true
        }
      }
    }
  }
}
```

Then run `/connect`, choose the same provider id, and save the API key there.

## Credential Precedence

Discovery requests resolve credentials in this order:

1. `provider.<name>.options.apiKey`
2. OpenCode resolved provider key, when available during plugin startup
3. Host auth store for same-id `type: "api"` credentials

This preserves existing explicit `apiKey` configs while also allowing custom providers to rely on `/connect` without duplicating secrets in `opencode.json`.

## How It Works

1. On OpenCode startup, the plugin's `config` hook is called.
2. The plugin iterates through all configured providers.
3. For each provider, it checks whether it is OpenAI-compatible by npm, by a `/v1` baseURL, by an explicit discovery endpoint override, or by a forced provider-level discovery override.
4. For each accessible provider, it resolves discovery auth from explicit config first and then from OpenCode-managed auth when available.
5. It queries the configured models endpoint, defaulting to `/v1/models`.
6. Discovered models are automatically merged into the provider's configuration.
7. The enhanced configuration is used for the current session.

## Notes

- OpenCode's provider resolution API can time out inside the `config` hook, so the plugin includes a fallback for `/connect` API-key credentials.
- That fallback first respects `OPENCODE_AUTH_CONTENT`, then reads a host-specific auth store location derived from `xdg-basedir`.
- When `OPENCODE=1` is present, the plugin reads `~/.local/share/opencode/auth.json`.
- When `MIMOCODE=1` is present, the plugin reads `~/.local/share/mimocode/auth.json`.
- When neither host marker is present, the plugin defaults to `~/.local/share/opencode/auth.json`.
- The plugin never writes the recovered key back into `opencode.json` and never logs the secret value.
