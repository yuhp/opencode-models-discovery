# opencode-models-discovery

[![npm version](https://img.shields.io/npm/v/opencode-models-discovery.svg?color=blue)](https://www.npmjs.com/package/opencode-models-discovery)
[![npm downloads](https://img.shields.io/npm/dt/opencode-models-discovery.svg)](https://www.npmjs.com/package/opencode-models-discovery)
[![release](https://github.com/yuhp/opencode-models-discovery/actions/workflows/release.yml/badge.svg)](https://github.com/yuhp/opencode-models-discovery/actions/workflows/release.yml)
[![license](https://img.shields.io/github/license/yuhp/opencode-models-discovery)](https://github.com/yuhp/opencode-models-discovery/blob/main/LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D1.4.0-blueviolet)](https://opencode.ai)

> A universal OpenCode plugin for dynamic model discovery across any OpenAI-compatible provider.

Originally inspired by [opencode-lmstudio](https://github.com/agustif/opencode-lmstudio), this project has been refactored into a general-purpose model discovery plugin with provider-level discovery controls, model filtering, metadata enrichment, and `/connect`-backed credential support.

## Features

- Works with any OpenAI-compatible provider
- Discovers models dynamically from provider model endpoints
- Injects discovered models into OpenCode provider config automatically
- Supports provider-level enablement, endpoint overrides, and model filters
- Supports regex-based model id filtering and raw provider field equality filtering
- Can enrich model limits and reasoning metadata from provider-specific endpoints
- Supports OpenCode `/connect` credentials for custom providers
- Optionally caches discovered provider models in plugin-owned XDG data files

## Installation

```bash
npm install opencode-models-discovery
# or
bun add opencode-models-discovery
```

## Quick Start

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-models-discovery@latest"
  ],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "modelsDiscovery": {
          "enabled": true
        }
      }
    }
  }
}
```

On startup, the plugin will query the provider's models endpoint and merge discovered models into the active OpenCode config.

### Slow Providers

Discovery requests time out after `3000` milliseconds by default. For a slow local server or gateway, set a larger timeout for that provider:

```json
{
  "modelsDiscovery": {
    "timeoutMs": 15000
  }
}
```

The setting applies to that provider's models endpoint and provider-specific metadata endpoint. OpenCode normally waits up to `5000` milliseconds for discovery during startup; when a provider configures a larger `timeoutMs`, the plugin raises that wait budget to the largest configured provider timeout so its discovered models can be injected before startup continues.

See the [configuration guide](docs/configuration.md#provider-level-configuration) for the full provider configuration.

## v1.0 Configuration Boundary

Version `1.0.0` uses provider-level discovery configuration only. Put discovery settings under `provider.<id>.options.modelsDiscovery`.

Plugin-level global discovery options are still detected for migration help, but they are no longer applied at runtime:

Deprecated plugin-level options:

- `discovery.enabled`
- `providers.include`
- `providers.exclude`
- `models.includeRegex`
- `models.excludeRegex`
- `smartModelName`

Configuration should live on each provider instead:

```json
{
  "provider": {
    "lmstudio": {
      "options": {
        "modelsDiscovery": {
          "enabled": true,
          "models": {
            "includeBy": [
              { "field": "id", "match": "^llama" }
            ],
            "excludeBy": [
              { "field": "available", "equals": false },
              { "field": "id", "match": "embedding" }
            ]
          },
          "smartModelName": true,
          "modelInfoFormat": "models.dev"
        }
      }
    }
  }
}
```

Only add the fields you need. For example, do not add filters unless you actually want filtering.

- Discovery remains enabled by default for providers unless disabled.
- Set `provider.<id>.options.modelsDiscovery.enabled = false` to disable discovery for one provider.
- Set `OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED=false` to make providers without explicit `modelsDiscovery.enabled` default to disabled.
- Explicit provider-level `modelsDiscovery.enabled` always wins over the environment default.

When legacy global config is detected, the plugin logs a warning, shows a migration toast, and injects `/models-discovery:migrate` into OpenCode commands.

Prefer `models.includeBy` and `models.excludeBy` for model filtering. They filter top-level raw fields returned by a provider's `/v1/models` response. Each field rule uses either `equals` for strict equality or `match` for regex matching against string field values. Use `{ "field": "id", "match": "..." }` for id/name regex filtering. `includeBy` and `excludeBy` are cumulative, and `excludeBy` wins over `includeBy`. `models.includeRegex` and `models.excludeRegex` are retained as legacy id-only shortcuts; when `includeRegex` is configured, `excludeRegex` is not applied. Provider-specific fields such as `available` are not part of the generic OpenAI-compatible contract, so configure these filters only when your provider returns those fields.

## Helper Commands

The plugin injects helper commands into OpenCode's runtime command list.

### `/models-discovery:config`

Opens an assistant-guided configuration flow using OpenCode's `customize-opencode` skill. Use this when setting up the plugin, adding provider-level discovery config, enabling metadata enrichment, disabling discovery for a provider, or managing a persisted discovery cache and its model overrides.

This command is available whenever the plugin is loaded.

## Persisted Model Discovery Cache

Caching is opt-in per provider. When enabled, the plugin stores the last successful filtered and metadata-enriched discovered model configuration under its own XDG data directory and reuses it until its TTL expires. A fresh cache avoids model-endpoint requests, credential resolution, and enrichment requests. Expired cached models are never used if a refresh fails.

```json
{
  "provider": {
    "local-vllm": {
      "options": {
        "baseURL": "http://127.0.0.1:8000/v1",
        "modelsDiscovery": {
          "enabled": true,
          "cache": {
            "enabled": true,
            "ttlSeconds": 86400
          }
        }
      }
    }
  }
}
```

The cache lives at `${XDG_DATA_HOME}/opencode-models-discovery/providers/provider-<encoded-provider-id>.json`, using `xdg-basedir`'s data-directory fallback when `XDG_DATA_HOME` is unset. It contains only models that passed discovery filters and enrichment eligibility checks, including their resulting OpenCode capability metadata. These files never contain credentials, auth headers, or OpenCode/Mimocode auth data. Saved per-model overrides are managed through `/models-discovery:config`; they are applied only to models present in the latest valid cached model set. Matching explicit `provider.<id>.models` configuration is recursively merged last, while explicit models not returned by discovery remain standalone. Explicit config is never written to the cache. See [model assembly and customization](docs/configuration.md#model-assembly-and-customization) and [persisted model discovery cache](docs/persisted-model-discovery.md) for details.

### `/models-discovery:migrate`

Opens an assistant-guided migration flow using OpenCode's `customize-opencode` skill. It looks for OpenCode config files that declare this plugin and moves legacy plugin-level discovery options into `provider.<id>.options.modelsDiscovery` where safe.

This command is injected only when legacy global discovery config is detected.

The migration assistant is instructed to inspect project config, user global config, and `OPENCODE_CONFIG` when present. It should not edit managed or organization-controlled config unless you explicitly ask it to.

## Model Metadata Enrichment

Discovery adds model ids to your OpenCode provider config. Some providers only expose minimal `/models` responses, so the plugin can optionally enrich discovered models with OpenCode-compatible capability metadata such as context limits, output limits, reasoning, tool calling, attachments, structured output, temperature support, and modalities.

Metadata enrichment is explicit. The plugin does not contact external metadata sources unless configured.

For models.dev enrichment:

```json
{
  "modelsDiscovery": {
    "enabled": true,
    "modelInfoFormat": "models.dev",
    "modelInfoEndpoint": "https://your-mirror.example/models.json"
  }
}
```

`modelInfoEndpoint` is optional for `models.dev`; it must be a complete URL and defaults to `https://models.dev/models.json`. Use it to configure an accessible mirror or proxy. For LiteLLM and LM Studio, it accepts either an origin-relative path or a complete URL.

For LiteLLM-compatible model info endpoints, `/v1/model/info` is used by default:

```json
{
  "modelsDiscovery": {
    "enabled": true,
    "modelInfoFormat": "litellm"
  }
}
```

For Bifrost AI Gateway's inline `/v1/models` metadata, without another metadata request:

```json
{
  "modelsDiscovery": {
    "enabled": true,
    "modelInfoFormat": "bifrost"
  }
}
```

For LM Studio 0.4.0+'s native v1 REST inventory endpoint:

```json
{
  "modelsDiscovery": {
    "enabled": true,
    "modelInfoFormat": "lmstudio"
  }
}
```

For llama-swap's inline `/v1/models` metadata, without another metadata request:

```json
{
  "modelsDiscovery": {
    "enabled": true,
    "modelInfoFormat": "llama-swap"
  }
}
```

If metadata cannot be fetched or matched safely, discovery still succeeds and the plugin leaves unknown capability fields unset rather than guessing defaults. See [model metadata enrichment](docs/configuration.md#model-metadata-enrichment) for format-specific behavior and configuration.

## Upgrade Note

If you upgrade the plugin and OpenCode still behaves like it is using an older build, refresh the OpenCode plugin cache and restart OpenCode.

This can happen because OpenCode may continue using a previously cached package after the npm package itself has been updated.

After changing `opencode.json`, restart OpenCode. OpenCode loads config at startup, so command and provider changes are not guaranteed to take effect in an already-running session.

OpenCode Desktop runs plugins in a plain Node runtime instead of Bun, and Node cannot load the raw TypeScript sources this package used to publish. The package now ships precompiled JavaScript (`dist/`) as its runtime entry, so Desktop hosts can load it. If the plugin never runs on Desktop, remove the stale cache directory (`~/.cache/opencode/packages/opencode-models-discovery@latest`) and restart, so the published build is reinstalled.

## `/connect` Support

For custom OpenAI-compatible providers, you still define the provider in `opencode.json` so OpenCode and this plugin know the provider id, npm package, and `baseURL`.

If the API credential is managed through OpenCode `/connect`, you do not need to duplicate the same key in `provider.<name>.options.apiKey`.

Discovery auth precedence is:

1. `provider.<name>.options.apiKey`
2. OpenCode resolved provider key, when available during plugin startup
3. OpenCode `/connect` auth store for same-id `type: "api"` credentials

Details and examples: [`docs/connect-and-auth.md`](docs/connect-and-auth.md)

## Mimocode Compatibility

This plugin is also compatible with Mimocode as an OpenCode-compatible host.

When startup-time discovery needs to recover `/connect`-managed API credentials from the local auth store, the plugin selects the host data directory from runtime environment markers:

- `OPENCODE=1` or no host marker: `~/.local/share/opencode/auth.json`
- `MIMOCODE=1`: `~/.local/share/mimocode/auth.json`

This keeps the same provider configuration model while allowing the plugin to work in both OpenCode and Mimocode environments.

## Documentation

- Configuration guide: [`docs/configuration.md`](docs/configuration.md)
- Persisted model discovery cache: [`docs/persisted-model-discovery.md`](docs/persisted-model-discovery.md)
- `/connect` credentials and auth-backed discovery: [`docs/connect-and-auth.md`](docs/connect-and-auth.md)
- Community provider examples: [`docs/config_example/`](docs/config_example/)
- Provider compatibility and detection rules: [`docs/providers.md`](docs/providers.md)
- Upgrade notes: [`docs/upgrading.md`](docs/upgrading.md)

Provider users are welcome to contribute community-maintained configuration examples under [`docs/config_example/`](docs/config_example/). Please target the `community/config-examples` branch and keep example PRs scoped to a new example file plus its README link.

## Requirements

- OpenCode with plugin support
- At least one OpenAI-compatible provider running locally or remotely
- Provider API accessible through either a `/v1`-style base URL or an explicitly configured discovery endpoint

## Logging

When available, the plugin writes logs through OpenCode's structured server log API via `client.app.log(...)` using the service name `opencode-models-discovery`.

If structured logging is unavailable in the runtime, the plugin falls back to prefixed `console.*` output. Key log categories are emitted through metadata such as `plugin`, `config`, `discovery`, `event`, and `filtering` to make local debugging easier with `opencode --print-logs`.

## Star History

<a href="https://sh.yuhp.dev/star-history/opencode-models-discovery">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://sh.yuhp.dev/star-history/opencode-models-discovery?theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://sh.yuhp.dev/star-history/opencode-models-discovery?theme=light" />
    <img alt="Star History Chart" src="https://sh.yuhp.dev/star-history/opencode-models-discovery?theme=light" />
  </picture>
</a>

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request.

## License

MIT

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with OpenCode in any way.

This project is not affiliated with, endorsed by, or sponsored by [models.dev](https://models.dev/). Optional models.dev metadata enrichment uses the public models.dev index only when explicitly configured by the user.
