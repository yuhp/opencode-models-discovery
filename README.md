# opencode-models-discovery

[![npm version](https://img.shields.io/npm/v/opencode-models-discovery.svg?color=blue)](https://www.npmjs.com/package/opencode-models-discovery)
[![npm downloads](https://img.shields.io/npm/dt/opencode-models-discovery.svg)](https://www.npmjs.com/package/opencode-models-discovery)
[![release](https://github.com/yuhp/opencode-models-discovery/actions/workflows/release.yml/badge.svg)](https://github.com/yuhp/opencode-models-discovery/actions/workflows/release.yml)
[![license](https://img.shields.io/github/license/yuhp/opencode-models-discovery)](https://github.com/yuhp/opencode-models-discovery/blob/main/LICENSE)
[![OpenCode v1](https://img.shields.io/badge/OpenCode%20v1-%3E%3D1.18.29-blueviolet)](https://opencode.ai/v1/docs)
[![OpenCode v2](https://img.shields.io/badge/OpenCode%20v2-%3E%3D2.2.6-blueviolet)](https://opencode.ai/v2/docs/)

> Discover models from OpenAI-compatible providers and add them to OpenCode automatically.

This plugin queries a provider's model endpoint, applies optional filters, and injects the discovered models into OpenCode. It supports OpenCode v2 as the primary integration and keeps a separate OpenCode v1 adapter for legacy configurations.

## Features

- Dynamic model discovery from `/v1/models` or a configured endpoint
- Provider-level enablement, endpoint overrides, timeouts, and model filters
- Optional human-friendly model names
- Optional metadata enrichment for limits, reasoning, tools, attachments, structured output, and modalities
- OpenCode v2 `/connect` credentials, host-managed storage, refresh commands, and model console
- OpenCode v1 XDG caching, helper commands, and compatibility with Mimocode
- Works with any provider that returns an OpenAI-compatible model-list response

## OpenCode v2 (recommended)

OpenCode v2 uses `plugins` and `providers`. Discovery settings belong under `providers.<id>.settings.modelsDiscovery` and require `enabled: true` for that provider.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@2.1.2"
  ],
  "providers": {
    "gateway": {
      "name": "My Gateway",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://gateway.example.com/v1",
        "apiKey": "{env:GATEWAY_API_KEY}",
        "modelsDiscovery": {
          "enabled": true,
          "smartModelName": true,
          "models": {
            "includeBy": [{ "field": "id", "match": "^(gpt|gemini)" }]
          }
        }
      }
    }
  }
}
```

The plugin requests `/v1/models` by default. For a provider that exposes `/models`, set `"endpoint": "/models"`. The endpoint is resolved from the provider URL's origin.

You can omit `apiKey` and manage credentials with OpenCode's native `/connect` command. Resolved credentials are used in memory and are not written to configuration, caches, or logs.

For the complete V2 configuration reference, see [Configuration Guide](docs/configuration.md#opencode-v2-configuration-stable-support).

### V2 commands and tools

- `/models-discovery-refresh` refreshes discovered models.
- `/models-discovery-console` browses providers, models, metadata, and caches.
- `models_discovery_refresh` and `models_discovery_status` are available as agent tools.
- Pass `rawCache: true` to `models_discovery_status` to inspect cached raw models and enrichment results.

V2 caching is disabled by default and uses OpenCode's host-provided storage when enabled. After rebuilding a local plugin, restart the background service with `opencode service restart`.

## OpenCode v1 (legacy compatibility)

For OpenCode v1 (`1.18.29+`), use `plugin`, `provider`, and `options`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-models-discovery@2.1.2"],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "modelsDiscovery": {
          "enabled": true,
          "smartModelName": true
        }
      }
    }
  }
}
```

V1 discovery is configured per provider at `provider.<id>.options.modelsDiscovery`. V1 remains supported for compatibility, security fixes, and severe regressions; new discovery, TUI, RPC, cache, and override features target V2 first.

For V1 migration, helper commands, disk caching, filters, and legacy configuration details, see:

- [Configuration Guide](docs/configuration.md)
- [Migrating from V1 to V2](docs/migrate-v1-to-v2.md)
- [Persisted Model Discovery Cache](docs/persisted-model-discovery.md)
- [Upgrade Guide](docs/upgrading.md)

## Metadata enrichment

Enrichment is opt-in. Without `modelInfoFormat`, the plugin does not contact external metadata sources and leaves unknown fields unset.

Supported formats include:

`aiproxy`, `bifrost`, `litellm`, `lmstudio`, `llama-swap`, `models.dev`, `ollama`, `omniroute`, `openrouter`, and `vllm`.

Example using `models.dev`:

```json
{
  "modelsDiscovery": {
    "enabled": true,
    "modelInfoFormat": "models.dev"
  }
}
```

`models.dev` uses `https://models.dev/models.json` by default and supports a custom `modelInfoEndpoint`. Provider-specific formats read metadata from the provider's own response or endpoint. See [Model Metadata Enrichment](docs/configuration.md#model-metadata-enrichment) for format-specific paths and behavior.

## Common options

All options are provider-scoped. The exact configuration path depends on the host:

| Host | Configuration path |
|---|---|
| OpenCode v2 | `providers.<id>.settings.modelsDiscovery` |
| OpenCode v1 | `provider.<id>.options.modelsDiscovery` |

Frequently used options:

| Option | Description |
|---|---|
| `enabled` | Enable or disable discovery for one provider |
| `endpoint` | Model-list endpoint; defaults to `/v1/models` |
| `timeoutMs` | Per-request timeout; V2 defaults to 5000 ms and V1 to 3000 ms |
| `models.includeBy` / `excludeBy` | Filter raw top-level provider fields with `equals` or `match` |
| `smartModelName` | Use provider-supplied human-friendly names when available |
| `modelInfoFormat` | Enable provider-specific metadata enrichment |
| `cache.enabled` | Enable provider model caching; disabled by default |

See the [full configuration reference](docs/configuration.md) for defaults, filter semantics, cache behavior, model assembly, and V1/V2 differences.

## Documentation

- [Configuration Guide](docs/configuration.md)
- [Provider Compatibility](docs/providers.md)
- [Connect and Auth](docs/connect-and-auth.md)
- [Migrate V1 to V2](docs/migrate-v1-to-v2.md)
- [Persisted Model Discovery Cache](docs/persisted-model-discovery.md)
- [Upgrade Guide](docs/upgrading.md)
- [Community configuration examples](docs/config_example/)

## Requirements

- OpenCode with plugin support
- At least one local or remote OpenAI-compatible provider
- A provider model-list endpoint returning an OpenAI-compatible response

For local plugin development, run `npm run compile` and reference the generated directory with `file:///absolute/path/to/opencode-models-discovery/dist`. OpenCode v2 expects a directory rather than a direct JavaScript entry file.

## Contributing

Contributions are welcome. Please feel free to submit a pull request. Community provider examples should be added under [`docs/config_example/`](docs/config_example/) on the `community/config-examples` branch.

## License

MIT

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with OpenCode. It is also not affiliated with, endorsed by, or sponsored by [models.dev](https://models.dev/). The optional models.dev metadata source is used only when explicitly configured.

<a href="https://sh.yuhp.dev/star-history/opencode-models-discovery">
  <img alt="Star History Chart" src="https://sh.yuhp.dev/star-history/opencode-models-discovery?theme=light" />
</a>
