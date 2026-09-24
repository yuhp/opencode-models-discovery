# Persisted Model Discovery Cache

This feature belongs to the OpenCode v1 adapter. OpenCode v2 support is currently in beta and does not currently include the V1 persisted disk cache.

Persisted model discovery cache is an opt-in, provider-scoped cache for discovered OpenAI-compatible models. It reduces provider startup requests by saving the latest successful discovered model configuration in the plugin's XDG data directory.

The cache is plugin-owned data. It does not replace `opencode.json`, and it does not write to OpenCode or Mimocode configuration or auth stores.

## Enable Caching

Configure caching under `provider.<id>.options.modelsDiscovery.cache`:

```json
{
  "provider": {
    "local-vllm": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:8000/v1",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "vllm",
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

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cache.enabled` | `boolean` | `false` | Enables the persisted discovery cache for this provider. |
| `cache.ttlSeconds` | non-negative finite number | `86400` | Cache lifetime in seconds. |

Caching is disabled unless `cache.enabled` is explicitly `true`. A `ttlSeconds` value of `0` writes successful discovery results but causes every later startup to refresh the cache.

## Cached Models

After a successful live discovery, the plugin applies its normal discovery pipeline before saving:

1. Validates provider model entries.
2. Applies raw-field and id filters.
3. Excludes unsupported model categories such as embeddings.
4. Applies configured metadata enrichment and model-info eligibility checks.
5. Saves only the resulting OpenCode model configurations.

As a result, models excluded by filters or enrichment eligibility are not cached. Metadata added by enrichers, such as vLLM context/output limits or LiteLLM capabilities, is cached and reused.

The current cache schema is version `2`:

```json
{
  "version": 2,
  "provider": {
    "id": "openrouter",
    "baseURL": "https://openrouter.ai/api",
    "endpoint": "/v1/models"
  },
  "fetchedAt": "2026-07-22T03:00:00.000Z",
  "models": {
    "openai/gpt-5-codex": {
      "id": "openai/gpt-5-codex",
      "name": "GPT-5-Codex",
      "limit": {
        "context": 400000,
        "input": 272000,
        "output": 128000
      },
      "attachment": false,
      "reasoning": true,
      "tool_call": true,
      "structured_output": true,
      "temperature": false,
      "modalities": {
        "input": ["text", "image"],
        "output": ["text"]
      }
    }
  }
}
```

Older or unsupported cache schema versions are cache misses. The plugin refreshes them from the provider and rewrites the cache after a successful discovery.

## Cache Location

Each provider cache is stored at:

```text
${XDG_DATA_HOME}/opencode-models-discovery/providers/provider-<encoded-provider-id>.json
```

When `XDG_DATA_HOME` is unset, the plugin uses the `xdg-basedir` `xdgData` fallback. Provider IDs are encoded before forming a file name, so a raw provider ID is never used directly as a path component.

The plugin does not store its cache in host-owned locations, including:

```text
${xdgData}/opencode/auth.json
${xdgData}/mimocode/auth.json
```

## Cache Validity And Refresh

A cache file is usable only when all of the following are true:

- The schema version is supported.
- The provider ID, normalized base URL, and models endpoint match the current provider configuration.
- `fetchedAt + ttlSeconds` is later than the current time.

For a valid cache hit, the plugin injects cached model configurations directly. It does not request the provider models endpoint, resolve an API key, or repeat metadata enrichment.

For a missing, invalid, identity-mismatched, or expired cache entry, the plugin resolves credentials through its usual precedence rules and requests the provider models endpoint. A successful response replaces cached `models` and updates `fetchedAt`.

If refresh fails, expired cached models are not injected. Explicit `provider.<id>.models` entries still remain active. The prior cache file and any user overrides are retained for a later successful refresh.

## Per-Model Overrides

User customization is kept separate from plugin-generated `models` in an optional top-level `overrides` object. The following `variants` field is an OpenCode override choice, not a field from models.dev metadata:

```json
{
  "version": 2,
  "provider": {
    "id": "openrouter",
    "baseURL": "https://openrouter.ai/api",
    "endpoint": "/v1/models"
  },
  "fetchedAt": "2026-07-22T03:00:00.000Z",
  "models": {
    "openai/gpt-5-codex": {
      "id": "openai/gpt-5-codex",
      "name": "GPT-5-Codex"
    }
  },
  "overrides": {
    "openai/gpt-5-codex": {
      "reasoning": true,
      "variants": {
        "high": {
          "reasoningEffort": "high"
        }
      }
    }
  }
}
```

The runtime precedence is:

```text
cached or live discovered models
  < persisted per-model overrides
  < explicit provider.<id>.models in opencode.json
```

Override objects merge recursively. Arrays replace the generated array, and an override cannot replace a model `id`. OpenCode recognizes `variants` as variant-specific request configuration. Its contents are provider-specific: for example, OpenAI-compatible reasoning models can use `{ "reasoningEffort": "high" }`, while Anthropic thinking configuration belongs under the model `options.thinking` object rather than `variants`.

## models.dev Metadata Shape

The current `https://models.dev/models.json` response is a flat object keyed by `provider/model`, with each model repeating the same `id`. Its observed model capability shape includes:

```json
{
  "openai/gpt-5-codex": {
    "id": "openai/gpt-5-codex",
    "limit": {
      "context": 400000,
      "input": 272000,
      "output": 128000
    },
    "attachment": false,
    "reasoning": true,
    "tool_call": true,
    "structured_output": true,
    "temperature": false,
    "modalities": {
      "input": ["text", "image"],
      "output": ["text"]
    }
  }
}
```

`limit` is singular. `context`, `input`, and `output` are independently optional. The plugin copies usable positive limits and direct boolean capability fields when they are present. `structured_output` and `temperature` can be omitted by models.dev; omission remains unset rather than being interpreted as `false`. The fetched models.dev dataset does not currently expose `variants`; use that field only as an explicit OpenCode override when supported by the target model.

An override is applied only when its model exists in the current valid discovered model set. If a refresh no longer returns the model, the override remains stored but inactive. If a later refresh returns the model again, the override applies again automatically.

Use `/models-discovery:config` to enable caching, inspect the selected provider's cache, and manage overrides. The assistant-guided flow must ask for confirmation before deleting an override or invalidating cached models. Force refresh removes or invalidates cached models while preserving overrides.

## Security And Failure Behavior

- Cache files omit API keys, authorization headers, credentials, passwords, tokens, secrets, and raw model-info endpoint responses.
- Cache writing uses a same-directory temporary file and rename; supported systems use restrictive permissions.
- Missing files, invalid JSON, unsupported schemas, unreadable files, and write failures are non-fatal. They behave as a cache miss or leave the current live discovery result active.
- A failed cache write after live discovery does not discard models discovered for the current OpenCode session.
