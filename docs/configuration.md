# Configuration Guide

This plugin discovers models for OpenAI-compatible providers and merges them into the active OpenCode config at startup.

Use `provider.<name>.options.modelsDiscovery` for provider-specific behavior. This is the only supported configuration boundary in `1.0.0`.

OpenCode's own provider config still controls provider identity, npm package, `baseURL`, credentials, and provider availability. This plugin controls model discovery for providers that OpenCode has made available.

## Provider-Level Configuration

Each provider can configure discovery behavior through `provider.<name>.options.modelsDiscovery`:

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "modelsDiscovery": {
          "enabled": true,
          "models": {
            "includeBy": [
              { "field": "id", "match": "^llama" }
            ]
          },
          "smartModelName": true
        }
      }
    }
  }
}
```

| Option | Type | Description |
|--------|------|-------------|
| `provider.<name>.options.modelsDiscovery.enabled` | `boolean` | Force enable or disable discovery for a single provider |
| `provider.<name>.options.modelsDiscovery.endpoint` | `string` | Provider-specific models endpoint as an origin-relative path beginning with `/`. Defaults to `/v1/models` |
| `provider.<name>.options.modelsDiscovery.timeoutMs` | positive finite `number` | Per-request timeout for the provider's models and provider-specific metadata endpoints. Defaults to `3000` |
| `provider.<name>.options.modelsDiscovery.modelInfoEndpoint` | `string` | Override a format-specific metadata endpoint as an origin-relative path or complete URL. Defaults to `/v1/model/info` for `"litellm"` and `/api/v1/models` for `"lmstudio"` |
| `provider.<name>.options.modelsDiscovery.modelInfoFormat` | `string` | Model info response format. Currently supports `"bifrost"`, `"litellm"`, `"models.dev"`, `"vllm"`, `"lmstudio"`, `"llama-swap"`, and `"omniroute"` |
| `provider.<name>.options.modelsDiscovery.filterNonChat` | `boolean` | When model info is available, skip models whose `model_info.mode` is not `chat`. Defaults to `true` |
| `provider.<name>.options.modelsDiscovery.models.includeRegex` | `string[]` | Shortcut regex allow-list for discovered model ids only |
| `provider.<name>.options.modelsDiscovery.models.excludeRegex` | `string[]` | Shortcut regex deny-list for discovered model ids only |
| `provider.<name>.options.modelsDiscovery.models.includeBy` | `{ field: string, equals: string \| number \| boolean \| null }[]` or `{ field: string, match: string }[]` | Allow-list for top-level raw provider model fields |
| `provider.<name>.options.modelsDiscovery.models.excludeBy` | `{ field: string, equals: string \| number \| boolean \| null }[]` or `{ field: string, match: string }[]` | Deny-list for top-level raw provider model fields |
| `provider.<name>.options.modelsDiscovery.smartModelName` | `boolean` | Use human-friendly display names instead of raw discovered model ids |
| `provider.<name>.options.modelsDiscovery.cache.enabled` | `boolean` | Opt in to provider-scoped cached filtered and enriched model configurations; defaults to `false` |
| `provider.<name>.options.modelsDiscovery.cache.ttlSeconds` | non-negative finite `number` | Cache lifetime in seconds; defaults to `86400` |

Recommended approach:

1. Keep the plugin entry simple: `"plugin": ["opencode-models-discovery"]`.
2. Put endpoint, enablement, and model filtering rules on each provider.
3. Use `modelsDiscovery.endpoint` whenever a provider does not follow the usual `/v1/models` convention.
4. Use OpenCode `/connect` credentials or `provider.<name>.options.apiKey` for secrets; do not duplicate API keys unless needed.

If `provider.<name>.options.modelsDiscovery.endpoint` is omitted, the plugin uses `/v1/models`.

Endpoint paths are resolved from the provider URL origin, not appended to a versioned `baseURL` path. For example, with `baseURL: "https://gateway.example/v1beta"`, `endpoint: "/v1/models"` requests `https://gateway.example/v1/models`. Discovery always uses the provider host; use the provider `baseURL` to select a different host.

The config hook waits up to `5000` milliseconds for discovery by default. When one or more providers set `modelsDiscovery.timeoutMs` above that value, the hook uses the largest configured provider timeout instead. This gives a slow provider enough time to inject its discovered models before OpenCode continues startup.

For a provider whose models or provider-specific metadata endpoint needs more than the default `3000` milliseconds, configure a larger timeout on that provider:

```json
{
  "provider": {
    "slow-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://gateway.example.com/v1",
        "modelsDiscovery": {
          "enabled": true,
          "timeoutMs": 15000
        }
      }
    }
  }
}
```

This allows up to `15000` milliseconds for each discovery request to `slow-gateway` and raises the config hook wait budget to the same value. Other providers keep their own request timeouts.

## Persisted Model Discovery Cache

Caching is disabled unless `modelsDiscovery.cache.enabled` is explicitly `true`. When enabled, a provider's latest successful filtered and metadata-enriched discovered model configurations are cached in plugin-owned XDG data at:

```text
${XDG_DATA_HOME}/opencode-models-discovery/providers/provider-<encoded-provider-id>.json
```

When `XDG_DATA_HOME` is unset, the plugin uses the `xdg-basedir` data-directory fallback. Provider ids are encoded before being used in file names. Cache files are never written to OpenCode or Mimocode auth locations, including `${xdgData}/opencode/auth.json` and `${xdgData}/mimocode/auth.json`.

```json
{
  "modelsDiscovery": {
    "cache": {
      "enabled": true,
      "ttlSeconds": 86400
    }
  }
}
```

A fresh cached model set is injected without requesting the provider models endpoint, resolving credentials, or repeating metadata enrichment. Once expired, the plugin refreshes it live. If the refresh fails, the expired cached models are not injected; only explicit `provider.<name>.models` entries remain active.

Each cache file contains a version, provider id, normalized base URL, endpoint, fetch time, and the final discovered model configurations, including enriched OpenCode capability metadata. Models rejected by filters, categorization, or metadata enrichment eligibility are not cached. It never contains API keys, authorization headers, credentials, or raw model-info endpoint responses. A cache file with another provider identity or an unsupported schema version is treated as a cache miss.

Saved per-model overrides are separate from plugin-generated cached model configurations and are managed through `/models-discovery:config`. Overrides merge recursively for objects, replace arrays, cannot change `id`, and apply only when the model is present in the current valid discovered model set. An override for a model absent from a refreshed model set stays saved but inactive until that model returns.

See [Persisted Model Discovery Cache](persisted-model-discovery.md) for the complete cache schema, lifecycle, override behavior, and security boundary.

## Model Assembly And Customization

For each eligible provider, the plugin produces its final `provider.<name>.models` map in this order:

1. Obtain the discovered model set from a fresh provider request or a valid persisted cache entry.
2. For a live request, apply model filters, build OpenCode model configuration, and apply the optional `modelInfoFormat` enrichment.
3. Apply saved plugin-managed per-model overrides when present.
4. Apply matching explicit `provider.<name>.models.<model-id>` configuration from `opencode.json`.
5. Preserve explicit model entries whose ids were not discovered as standalone models.

For a matching model id, the discovered or cached configuration is the base and explicit configuration is a recursive override. Nested objects merge, while arrays and scalar values replace the existing value. The discovered model id remains authoritative, so an explicit `id` value cannot rename it.

```json
{
  "provider": {
    "gateway": {
      "models": {
        "example-model": {
          "options": {
            "customRouting": true
          },
          "variants": {
            "high": {
              "reasoningEffort": "high"
            }
          }
        },
        "manual-only-model": {
          "name": "Manual Only Model"
        }
      }
    }
  }
}
```

If `example-model` was discovered with a name, limits, modalities, and capability metadata, those fields remain available and `options.customRouting` plus `variants.high` are added. `manual-only-model` remains available even if the provider does not return it from its discovery endpoint.

OpenCode validates `provider.<name>.models.<model-id>` against its own model schema before plugins run. Use documented model fields such as `options` or `variants` for custom values; arbitrary top-level keys are removed by OpenCode and cannot be merged by this plugin.

The persisted cache stores only the filtered and enriched discovered base models. It does not store explicit `provider.<name>.models` configuration, so explicit customizations are applied from the active OpenCode config on every startup. This keeps provider inventory data separate from user configuration.

## Default Enablement

1. `provider.<name>.options.modelsDiscovery.enabled = true` forces discovery for that provider.
2. `provider.<name>.options.modelsDiscovery.enabled = false` disables discovery for that provider.
3. If `enabled` is omitted, `OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED` controls the default when set.
4. If the environment variable is omitted or invalid, the built-in default is `true`.
5. OpenCode `enabled_providers` and `disabled_providers` control whether providers are available at all. This plugin does not override those OpenCode provider availability settings.

Accepted false values are `false`, `0`, `no`, and `off`. Accepted true values are `true`, `1`, `yes`, and `on`. Invalid values warn and fall back to `true`.

## Model Filters

Provider-level filters live under `provider.<name>.options.modelsDiscovery.models`.

Prefer `includeBy` and `excludeBy` for model filtering. They work for `id` and for other top-level raw fields returned in the provider's `/v1/models` response.

Use `includeBy` or `excludeBy` with `field: "id"` and `match` when filtering model ids by regex. This is the recommended form for new config.

`includeRegex` and `excludeRegex` are retained as shortcuts for id-only regex filtering. They are regular expressions evaluated against the discovered model id and cannot filter non-id fields.

Use `includeBy` and `excludeBy` when filtering by top-level fields returned in the provider's raw `/v1/models` response. Each rule must include exactly one of:

- `equals`: strict equality against `string`, `number`, `boolean`, or `null` field values
- `match`: regular expression matching against string field values

```json
{
  "modelsDiscovery": {
    "models": {
      "excludeBy": [
        { "field": "available", "equals": false },
        { "field": "id", "match": "embedding" }
      ],
      "includeBy": [
        { "field": "id", "match": "^deepseek" }
      ]
    }
  }
}
```

`includeBy` keeps a model when it matches at least one rule. `excludeBy` removes a model when it matches any rule, and exclusion wins when both include and exclude rules match. Missing fields do not match. Nested paths, type coercion, arrays, and objects are not supported.

`includeBy` and `excludeBy` can replace `includeRegex` and `excludeRegex` for id filtering by using `field: "id"` with `match`.

### Filter Order And Combination

`includeBy` and `excludeBy` are cumulative. A model must pass `includeBy` first, then `excludeBy`, before it can be injected.

Recommended field-filter order is:

1. `includeBy`
2. `excludeBy`

Within that order:

- `includeBy` is an allow-list: when configured, a model must match at least one rule.
- `excludeBy` is a deny-list: when a model matches any rule, it is removed.
- `excludeBy` wins over `includeBy` when both match the same model.

`includeRegex` and `excludeRegex` are retained as legacy id-only shortcuts. They are not fully cumulative with each other: when `includeRegex` is configured, the model id only needs to match `includeRegex`, and `excludeRegex` is not applied. `excludeRegex` is applied only when `includeRegex` is not configured.

Prefer `includeBy` and `excludeBy` with `field: "id"` and `match` when you need both allow-list and deny-list regex behavior for model ids.

Provider-specific raw fields such as `available` are not part of the generic OpenAI-compatible model list contract. The plugin does not hardcode provider-specific behavior; use `includeBy` or `excludeBy` only when your provider returns the field.

## Legacy Global Config

Version `1.0.0` ignores legacy plugin-level discovery configuration at runtime. It still detects legacy config so users can migrate.

Legacy plugin-level options:

- `discovery.enabled`
- `providers.include`
- `providers.exclude`
- `models.includeRegex`
- `models.excludeRegex`
- `smartModelName`

When legacy global config is detected, the plugin logs a warning, shows a toast, and injects `/models-discovery:migrate` to guide migration. The legacy fields do not change discovery behavior.

Use `/models-discovery:config` for assistant-guided provider-level setup. Use `/models-discovery:migrate` when legacy plugin-level config is detected.

Community provider examples live in [`docs/config_example/`](config_example/).

## Model Metadata Enrichment

The generic OpenAI-compatible `/v1/models` endpoint only guarantees a small model list shape. Extra metadata such as context limits, tool calling, reasoning, image input, or structured output is provider-specific, so metadata enrichment is opt-in.

The plugin currently supports seven model info formats:

| Format | Source | Requires `modelInfoEndpoint` | Notes |
|--------|--------|------------------------------|-------|
| `"bifrost"` | Fields in Bifrost's `/v1/models` response | No | Reads Bifrost inline limits, modalities, and base pricing when present |
| `"litellm"` | Provider-specific model info endpoint | No | Uses `/v1/model/info` by default; set `modelInfoEndpoint` to override it |
| `"models.dev"` | `https://models.dev/models.json` | No | Uses the public models.dev metadata index |
| `"vllm"` | Fields in the provider's `/v1/models` response | No | Reads vLLM-style `max_model_len` when present |
| `"lmstudio"` | LM Studio 0.4.0+ `/api/v1/models` inventory | No | Uses `/api/v1/models` by default; set `modelInfoEndpoint` for another path |
| `"llama-swap"` | Fields in llama-swap's `/v1/models` response | No | Reads inline context, modalities, and function-calling metadata when present |
| `"omniroute"` | Fields in OmniRoute's `/v1/models` response | No | Reads OmniRoute inline limits, modalities, and capabilities when present |

### llama-swap Model Info

Use `modelInfoFormat: "llama-swap"` for a [llama-swap](https://github.com/mostlygeek/llama-swap) provider. It reads llama-swap's inline metadata from the same `/v1/models` response and does not make another metadata request.

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "llama-swap": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-swap",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "llama-swap"
        }
      },
      "models": {}
    }
  }
}
```

For each discovered model, the plugin maps `context_length` to `limit.context`, falling back to `meta.n_ctx`. Because llama-swap does not report a distinct output limit, the plugin writes `limit.output: 0` to preserve OpenCode's output-token fallback. Optional `meta.llamaswap.max_input_tokens` and `meta.llamaswap.max_output_tokens` values override the corresponding limits when present. It maps `architecture.input_modalities` and `architecture.output_modalities` to lower-case OpenCode modalities, and maps `capabilities.function_calling` or a `tools` entry in `supported_parameters` to `tool_call`. When `smartModelName: true` is set, a non-empty llama-swap `name` becomes the display name. Missing or malformed metadata is left unset.

### OmniRoute Model Info

Use `modelInfoFormat: "omniroute"` for an [OmniRoute](https://github.com/diegosouzapw/OmniRoute) provider. It reads OmniRoute's documented inline metadata from the same `/v1/models` response and does not make another metadata request.

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "omniroute": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OmniRoute",
      "options": {
        "baseURL": "http://127.0.0.1:20128/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "omniroute"
        }
      },
      "models": {}
    }
  }
}
```

For each discovered model, the plugin maps `context_length`, `max_input_tokens`, and `max_output_tokens` to `limit.context`, `limit.input`, and `limit.output` when both context and output limits are present. It maps `input_modalities` and `output_modalities` to lower-case OpenCode modalities, translating `SPEECH` to `audio` and ignoring unsupported values. When no valid input modalities are reported, `capabilities.vision: true` enables `text` and `image` input. The plugin also maps OmniRoute's `attachment`, `reasoning`, `tool_calling`, `structured_output`, and `temperature` capability booleans. Missing or malformed metadata is left unset.

This format is intentionally explicit because these fields are OmniRoute extensions to the generic OpenAI-compatible model-list response. For the most complete OmniRoute integration, including dynamic provider support, use OmniRoute's official `@omniroute/opencode-plugin`.

### Bifrost Model Info

Use `modelInfoFormat: "bifrost"` for a Bifrost AI Gateway provider. It reads Bifrost's documented inline metadata from the same `/v1/models` response and does not make another metadata request.

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "bifrost": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Bifrost",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "bifrost"
        }
      },
      "models": {}
    }
  }
}
```

For each discovered model, the plugin maps Bifrost's reported `context_length`, `max_input_tokens`, and `max_output_tokens` to `limit.context`, `limit.input`, and `limit.output`. Limits are added only when both the context and output limits are available, as OpenCode requires both. It maps `architecture.input_modalities` and `architecture.output_modalities` to lower-case OpenCode modalities, translating Bifrost's `SPEECH` value to `audio` and ignoring unsupported values. Bifrost's `pricing.prompt` and `pricing.completion` are USD per-token rates; the plugin converts them to OpenCode's USD per-million-token `cost.input` and `cost.output` values. Costs are added only when both rates are available. Other pricing fields, scoped pricing overrides, and tiered pricing are not represented by this format.

When `smartModelName: true` is set for the provider, Bifrost's `normalized_name` is used when it is available. Missing or malformed fields are left unset. The normal unpaginated Bifrost `/v1/models` request returns the complete aggregated list; avoid configuring a `page_size` unless you intentionally want a paged subset.

### LiteLLM Model Info

LiteLLM exposes a richer `/v1/model/info` endpoint in addition to the OpenAI-compatible `/v1/models` endpoint.

Set `modelInfoFormat` to `"litellm"` to enable it. The plugin requests `/v1/model/info` by default; set `modelInfoEndpoint` only when the provider uses another path.

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "litellm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteLLM",
      "options": {
        "baseURL": "http://127.0.0.1:4000/v1",
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/v1/models",
          "modelInfoFormat": "litellm"
        }
      },
      "models": {}
    }
  }
}
```

When model info is available, the plugin uses LiteLLM `model_info` fields to populate OpenCode model configuration:

- `max_input_tokens`, `max_output_tokens`, and `max_tokens` become `limit.context`, `limit.input`, and `limit.output`
- `modalities.input` and `modalities.output` become `modalities`, normalized to lowercase (`speech` becomes `audio`) and limited to `text`, `audio`, `image`, `video`, and `pdf`; the undeclared side defaults to `["text"]`, but a declared side that contains no supported values makes the whole declaration untrustworthy and the existing configuration is left untouched
- `supports_vision: true` without `modalities` falls back to input `["text", "image"]`
- `supports_reasoning` enables `reasoning`
- `supports_*_reasoning_effort` and `supported_openai_params` create reasoning `variants`: `low`, `medium`, and `high` are kept unless the matching flag is explicitly `false`, while `none`, `minimal`, `xhigh`, and `max` require the flag to be `true`
- By default, entries whose `model_info.mode` is not `chat` are skipped

### vLLM Model Info

Use `modelInfoFormat: "vllm"` for a vLLM-compatible provider whose `/v1/models` response includes a numeric `max_model_len` field for each model. This does not make another metadata request.

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "local-vllm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local vLLM",
      "options": {
        "baseURL": "http://127.0.0.1:8000/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "vllm"
        }
      },
      "models": {}
    }
  }
}
```

For each discovered model with a positive numeric `max_model_len`, the plugin sets `limit.context` and `limit.output` to that value. `max_model_len` represents the total request sequence length shared by prompt and generated tokens; it is not used as an independent input limit.

`max_model_len` is not part of the standard OpenAI-compatible `/v1/models` response. If a vLLM deployment or proxy does not expose it, discovery still succeeds but no limit is added. This format does not infer reasoning, tool-calling, modalities, or other capabilities.

### LM Studio Model Info

Use `modelInfoFormat: "lmstudio"` with LM Studio 0.4.0+, which officially released the native v1 REST API and `GET /api/v1/models`, to discover models through `/v1/models` and enrich them from `/api/v1/models`. Set `modelInfoEndpoint` only when LM Studio uses another inventory path.

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "lmstudio"
        }
      },
      "models": {}
    }
  }
}
```

Only models returned by `/v1/models` are injected. A model is enriched only when its `id` exactly matches an inventory `key`; inventory-only models are not injected. `modelsDiscovery.endpoint` controls discovery, while `modelsDiscovery.modelInfoEndpoint` controls the inventory request.

When available, the plugin sets `limit.context` from the largest loaded instance `config.context_length`, otherwise it uses `max_context_length`. LM Studio does not report a distinct output limit, so the plugin writes `limit.output: 0`: this satisfies OpenCode's requirement that a limit object include both context and output while preserving OpenCode's default or configured output-token fallback. The plugin maps `capabilities.vision` to image input, `capabilities.trained_for_tool_use` to `tool_call`, and reported reasoning options to `reasoning` plus `low`, `medium`, and `high` variants. Missing or malformed metadata is left unset without preventing discovery.

### models.dev Metadata

Use `modelInfoFormat: "models.dev"` to enrich discovered models from the public [models.dev](https://models.dev) metadata index.

This project is not affiliated with, endorsed by, or sponsored by [models.dev](https://models.dev/).

This does not require `modelInfoEndpoint`, because the source is fixed to `https://models.dev/models.json`:

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "openrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenRouter",
      "options": {
        "baseURL": "https://openrouter.ai/api/v1",
        "apiKey": "YOUR_OPENROUTER_API_KEY",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "models.dev"
        }
      },
      "models": {}
    }
  }
}
```

When a discovered model can be matched to models.dev metadata, the plugin may populate:

- `limit.context`, `limit.input`, and `limit.output`
- `attachment`
- `reasoning`
- `tool_call`
- `structured_output`
- `temperature`
- `modalities`

The current models.dev data uses a flat `provider/model`-keyed object. Its `limit` object is singular, and its `context`, `input`, and `output` fields are independently optional. `structured_output` and `temperature` may also be omitted; the plugin leaves omitted fields unset rather than inferring `false`. The current models.dev dataset does not provide `variants` metadata.

Matching is intentionally conservative:

- Exact model ids are preferred.
- Provider ids are not used for models.dev matching; only the model id segment after the provider prefix is matched.
- Prefix matching is limited to strong model id segment variants, such as date-suffixed model ids.

If models.dev cannot be fetched, or if no safe match is found, discovery still succeeds and the plugin leaves metadata fields unset. It does not inject hardcoded default context or output limits for unknown models.

Because this option makes a public network request to models.dev during discovery, it is disabled unless explicitly configured.

For providers with custom metadata paths or non-standard behavior:

```json
{
  "provider": {
    "custom": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:9000/v1",
        "modelsDiscovery": {
          "modelInfoEndpoint": "/custom/model-info",
          "modelInfoFormat": "litellm",
          "filterNonChat": false
        }
      }
    }
  }
}
```

## Example Configurations

### Mixed Providers

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/v1/models",
          "models": {
            "includeBy": [
              { "field": "id", "match": "^gpt-" }
            ]
          },
          "smartModelName": true
        }
      },
      "models": {}
    },
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "sk-example-deepseek-key",
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/models",
          "smartModelName": true
        }
      },
      "models": {}
    }
  }
}
```

In this example:

1. `lmstudio` explicitly enables discovery and uses the default `/v1/models` endpoint.
2. `lmstudio` limits discovery to model ids matching `^gpt-` with `includeBy`.
3. `deepseek` explicitly enables discovery but uses `"/models"` instead of `/v1/models`.
4. The API key uses an example placeholder and should be replaced in real configs.

### Provider-First Style

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1",
        "modelsDiscovery": {
          "enabled": true,
          "models": {
            "includeBy": [
              { "field": "id", "match": "^qwen/" }
            ]
          }
        }
      }
    },
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "apiKey": "YOUR_DEEPSEEK_API_KEY",
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/models",
          "smartModelName": true
        }
      }
    }
  }
}
```

In this example:

1. The plugin entry is simple and contains no legacy global discovery config.
2. `ollama` uses the default discovery path derived from its `/v1` baseURL.
3. `deepseek` does not rely on `/v1/models` and explicitly uses `"/models"`.
4. Each provider can evolve independently without changing global include or endpoint rules.

## Provider Filtering

For new configs, enable or disable discovery on the provider itself:

```json
{
  "provider": {
    "ollama": {
      "options": {
        "modelsDiscovery": {
          "enabled": true
        }
      }
    },
    "lmstudio": {
      "options": {
        "modelsDiscovery": {
          "enabled": false
        }
      }
    }
  }
}
```

Legacy plugin-level provider filters are ignored in `1.0.0` and are shown here only to help identify config that should be migrated:

| Option | Type | Description |
|--------|------|-------------|
| `providers.include` | `string[]` | If non-empty, only these providers will be discovered |
| `providers.exclude` | `string[]` | These providers will be skipped when `include` is empty |

```json
{
  "plugin": [
    ["opencode-models-discovery", {
      "providers": {
        "include": ["ollama"],
        "exclude": ["lmstudio"]
      }
    }]
  ]
}
```

## Model Filtering Reference

Control which discovered models are auto-injected with provider-level field filters:

| Option | Type | Description |
|--------|------|-------------|
| `provider.<name>.options.modelsDiscovery.models.includeBy` | `{ field: string, equals: string \| number \| boolean \| null }[]` or `{ field: string, match: string }[]` | If non-empty, only discovered models matching at least one rule will be added for this provider |
| `provider.<name>.options.modelsDiscovery.models.excludeBy` | `{ field: string, equals: string \| number \| boolean \| null }[]` or `{ field: string, match: string }[]` | Discovered models matching any rule will be skipped for this provider |
| `provider.<name>.options.modelsDiscovery.models.includeRegex` | `string[]` | Id-only shortcut for `includeBy` with `field: "id"` and `match` |
| `provider.<name>.options.modelsDiscovery.models.excludeRegex` | `string[]` | Id-only shortcut for `excludeBy` with `field: "id"` and `match` |

Filtering only applies to auto-discovered models. Models already explicitly configured by the user are preserved.

```json
{
  "provider": {
    "ollama": {
      "options": {
        "modelsDiscovery": {
          "models": {
            "includeBy": [
              { "field": "id", "match": "^qwen/|gpt-4" }
            ],
            "excludeBy": [
              { "field": "id", "match": "embedding|test" }
            ]
          }
        }
      }
    }
  }
}
```

Legacy plugin-level model filters are ignored in `1.0.0`. Move them to `provider.<name>.options.modelsDiscovery.models` when you still need those filters. Prefer migrating regex id filters to `includeBy`/`excludeBy` rules using `field: "id"` and `match`; provider-level `includeRegex`/`excludeRegex` remain available as id-only shortcuts.
