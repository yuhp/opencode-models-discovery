# OpenCode 2 Plugin Migration PRD

## Status

This document defines the OpenCode 2 migration work on the `v2` branch. It is a development and test plan, not a promise that every V1 behavior has a V2 equivalent.

The V1 implementation remains the stable release line. Do not modify the V1 plugin contract or release configuration as part of this work unless a later, explicit integration decision requires it.

## Background

`opencode-models-discovery` currently discovers models from OpenAI-compatible provider endpoints during the OpenCode V1 `config` hook. It directly mutates V1 provider configuration and injects discovered models before the session starts.

OpenCode 2 does not run V1 plugins. Its V2 plugin API uses a default `Plugin.define({ id, setup })` export and exposes a provider registry. Plugins register provider transforms and call `ctx.provider.reload()` to rebuild provider sources after their data changes.

OpenCode 2 can translate existing V1-shaped `opencode.json(c)` files in memory, but that does not make the V1 plugin API compatible. The V2 plugin must be implemented separately.

## Goals

- Discover chat-capable models from configured OpenAI-compatible providers.
- Add discovered models to the OpenCode 2 runtime provider registry without rewriting user configuration files.
- Preserve explicit user model configuration as the highest-priority source of model details.
- Preserve provider-scoped discovery controls: enablement, endpoint, timeout, model filters, display names, metadata enrichment, cache settings, and per-model overrides where supported.
- Reuse stable host-independent code for HTTP discovery, filtering, enrichment, model classification, and XDG cache storage where practical.
- Support a manual refresh and status inspection through V2 plugin tools.
- Keep all provider transform callbacks pure and replay-safe.
- Establish automated unit and OpenCode 2 integration coverage before any beta package publication.

## Non-Goals For The First V2 Beta

- Reusing the V1 `config` hook or mutating raw OpenCode configuration.
- Reading V1 OpenCode or Mimocode `auth.json` files directly.
- Mimocode support.
- V1 legacy global configuration detection, migration toast, or `/models-discovery:migrate`.
- Dynamic slash-command creation. The documented V2 command transform currently supports updating and removing commands, not adding new commands.
- Automatically writing command templates or configuration into a project or global OpenCode directory.
- Moving the V2 implementation to the package's `latest` release line.

## Relevant V2 Contract

Source documents:

- <https://opencode.ai/v2/docs/build/plugins>
- <https://opencode.ai/v2/docs/migrate-v1>
- <https://opencode.ai/v2/docs/providers>
- <https://opencode.ai/v2/docs/models>

The V2 API is beta. Plugin entrypoints, context methods, catalog draft shapes, and configuration may change. Implementation must use the installed `@opencode-ai/plugin@next` types as the source of truth and record the verified package and `opencode2` versions in test output or release notes.

### Plugin Entry Point

The V2 module must default-export a uniquely identified plugin:

```ts
import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "opencode.models-discovery",
  setup: async (ctx) => {
    // Register transforms, tools, refresh behavior, and cleanup.
  },
})
```

Plugin options are available unchanged at `ctx.options`. The plugin owns validation and defaults.

### Provider Lifecycle

The provider registry is the runtime directory that OpenCode uses to resolve providers and selectable models. It is built from built-in provider data, connections, and registered plugin transforms.

The implementation must separate three operations:

1. `refresh()` is plugin-owned. It can resolve supported public credential sources, request model endpoints, filter and enrich results, and replace an in-memory discovered inventory.
2. `ctx.provider.transform(callback)` registers a replayable mapping from configured plugin-option providers and the in-memory inventory to provider sources. The callback must not request the network, write files, start timers, or otherwise perform side effects.
3. `ctx.provider.reload()` rebuilds provider sources and replays all registered transforms. Call it after `refresh()` successfully replaces the inventory.

Expected flow:

```text
setup
  -> register provider transform once
  -> refresh
      -> fetch/cache/filter/enrich
      -> replace in-memory inventory
      -> provider.reload
          -> OpenCode rebuilds provider sources
          -> transform maps inventory into provider drafts
```

Do not register a new transform on each refresh. Do not assume registering a transform alone updates the current provider sources; explicitly call `reload()` after the initial inventory is ready.

### Model Mapping

V1 model configuration and V2 catalog drafts use different shapes:

| V1 output | V2 draft output |
| --- | --- |
| `id` | `modelID` |
| `tool_call` | `capabilities.tools` |
| `modalities.input` | `capabilities.input` |
| `modalities.output` | `capabilities.output` |
| `variants` object | `variants` array with `{ id, settings }` entries |
| `cost.cache_read` | `cost.cache.read` |
| `cost.cache_write` | `cost.cache.write` |

V2 custom provider configuration likewise changes from `provider.<id>.npm` and `options.baseURL` to `providers.<id>.package` and `settings.baseURL`. The V2 native compatible provider package is `@opencode-ai/ai/providers/openai-compatible`; the AI SDK compatible package form is `aisdk:@ai-sdk/openai-compatible`.

The exact shape accepted by `provider.models.set()` and `provider.add()` must be confirmed by the provider spike before implementing the full mapper.

## Proposed Architecture

Keep V2 code isolated initially. Do not refactor stable V1 modules merely to create a shared abstraction.

```text
src/                         V1 implementation, preserved during V2 work
src-v2/
  index.ts                   V2 Plugin.define entrypoint
  catalog.ts                 setup, inventory state, transform and reload orchestration
  provider-config.ts         V2 provider/options discovery configuration parsing
  discovery.ts               V2 provider descriptor to host-independent discovery input
  model-mapper.ts            discovered model to V2 catalog draft mapper
  tools.ts                   status and refresh tools
test-v2/
  catalog.test.ts
  model-mapper.test.ts
  integration/
```

Initially reuse the following V1 code where it is host independent:

- `src/utils/openai-compatible-api.ts`
- `src/utils/model-info/`
- `src/utils/models-dev-fetcher.ts`
- `src/plugin/provider-model-store.ts`
- filtering and discovery defaults in `src/types/plugin-config.ts`
- model formatting and classification helpers in `src/utils/`

After the V2 spike is proven, extract only genuinely shared functionality into a neutral `src/core/` directory. V1 and V2 adapters must retain separate OpenCode-specific entrypoints and types.

### In-Memory Inventory

The V2 adapter owns a memory-only inventory keyed by provider and model ID. It is the sole source read by the catalog transform:

```ts
type Inventory = Map<string, Map<string, DiscoveredV2Model>>
```

The refresh operation constructs a complete replacement inventory before assigning it. A failed provider refresh must not remove a still-valid fresh cache entry. An expired cache whose live refresh fails must not be injected; explicitly configured models remain available.

### Catalog Composition And Precedence

The required precedence is:

1. OpenCode built-in/catalog model data.
2. Plugin-discovered baseline metadata.
3. Per-model cached override, only for a currently discovered model.
4. Explicit user provider/model configuration.

The final composition must be demonstrated in an integration test. Catalog transforms execute in registration order and later mutations can observe earlier ones; do not depend on undocumented internal plugin phase order.

The initial spike must verify whether `catalog.model.update(providerID, modelID, callback)` creates a model that does not already exist. The official remote-model example implies that it can, but the public documentation does not explicitly guarantee add semantics.

### V2 Discovery Configuration

The preferred V2 location is plugin options because `modelsDiscovery` is plugin-private configuration and V2 provider `options` is passed to provider runtime packages. The plugin options also provide a reliable source for a provider that has no seed model.

Proposed native V2 shape:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "opencode-models-discovery-v2",
      "options": {
        "providers": {
          "local": {
            "enabled": true,
            "endpoint": "/v1/models",
            "timeoutMs": 3000,
            "modelInfoFormat": "vllm",
            "models": {
              "includeBy": [{ "field": "id", "match": "^qwen" }],
              "excludeBy": [{ "field": "id", "match": "embedding" }]
            },
            "cache": {
              "enabled": true,
              "ttlSeconds": 86400
            }
          }
        }
      }
    }
  ],
  "providers": {
    "local": {
      "name": "Local server",
      "package": "aisdk:@ai-sdk/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:1234/v1"
      }
    }
  }
}
```

The spike must determine whether the V2 catalog exposes enough reliable information to support this lookup, including provider ID, runtime package, `settings.baseURL`, and explicit model overlays.

Optional compatibility reading of V1-shaped `provider.<id>.options.modelsDiscovery` may be considered later because OpenCode 2 translates V1 config in memory. It is not part of the first beta contract, and it must not recreate the V1 migration command.

### Authentication

Discovery authentication must use only public V2 interfaces.

Priority for the first beta:

1. `providers.<id>.settings.apiKey`, including an environment substitution resolved by OpenCode.
2. A public V2 integration/provider resolution capability, if the spike proves it provides an API key or an authenticated request mechanism suitable for the models endpoint.
3. No auth header for local unauthenticated servers.

Do not read OpenCode service database files, V1 `auth.json`, `OPENCODE_AUTH_CONTENT`, or Mimocode files as a V2 fallback. If public V2 APIs cannot support `/connect` credentials for the discovery request, document `/connect` discovery as unsupported in the initial beta instead of relying on internal storage formats.

### Plugin Tools

Provide tools rather than dynamic commands:

- `models_discovery_status`: returns provider discovery/cache status and current discovered model counts.
- `models_discovery_refresh`: performs a refresh and returns a concise result.

Tool results can return model-visible `content` and therefore provide information to the current agent turn. They must not call `ctx.session.prompt()` to inject a new user turn. If the plugin later needs to add request-time context, use the documented `ctx.session.hook("request")` carefully and ensure the hook is fast and idempotent.

## Delivery Phases

### Phase 0: Catalog And Auth Spike

Purpose: validate the beta APIs that determine feasibility before porting V1 functionality.

Implement a minimal local V2 plugin that:

1. Uses `Plugin.define` with a stable plugin ID.
2. Logs or records the result of `ctx.catalog.provider.list()` without exposing credentials.
3. Registers one catalog transform backed by a fixed in-memory model.
4. Calls `catalog.model.update()` for a model absent from configuration.
5. Calls `ctx.catalog.reload()`.
6. Verifies the model is visible from `opencode2 api get /api/model` and the model picker.
7. Selects the model and verifies a request reaches a local mock OpenAI-compatible server at the configured `settings.baseURL`, using the configured `modelID`.
8. Tests a provider configured with an explicit or environment-backed API key and confirms discovery receives the expected authorization header.
9. Investigates public integration/provider APIs for `/connect` credential resolution without reading internal storage.

Exit criteria:

- A previously absent custom model can be made selectable through public catalog APIs.
- Reload replays the registered transform with current in-memory state.
- The exact provider and model draft TypeScript shapes are captured in code and tests.
- The team decides whether plugin options are the V2 discovery configuration boundary.
- `/connect` support has either a verified public implementation path or an explicit initial-beta exclusion.

### Phase 1: Core V2 Discovery

Implement:

- V2 provider discovery and option parsing.
- OpenAI-compatible provider identification.
- Standard and custom model endpoints.
- Request timeout handling.
- Valid-model validation and embedding exclusion.
- `includeBy`, `excludeBy`, `includeRegex`, and `excludeRegex` behavior.
- Raw and smart display names.
- V2 model mapping for basic identity, limits, capabilities, and variants.
- Catalog refresh/reload flow.
- Explicit model precedence.
- Status and manual-refresh tools.

Exit criteria:

- A live provider's discovered model set appears after plugin setup.
- A refresh replaces the discovered model set without restarting OpenCode.
- Explicit user model overrides are retained.
- Failed discovery does not break OpenCode startup or remove explicit models.

### Phase 2: Cache And Metadata Enrichment

Port and adapt:

- XDG provider model cache and TTL handling.
- Cached per-model overrides, with the V2 model shape.
- models.dev enrichment.
- Bifrost inline metadata.
- vLLM inline metadata.
- LiteLLM model-info endpoint.
- LM Studio inventory endpoint.
- llama-swap metadata if present on the V2 branch's V1 baseline.

For each format, update output mapping to the V2 `capabilities`, `limit`, `cost`, compatibility, and variants shapes. Preserve the existing policy of leaving unknown metadata unset rather than guessing.

Exit criteria:

- Each supported enrichment format has isolated unit coverage.
- Cached inventories avoid model and metadata requests while fresh.
- An expired cache is not used after a failed live refresh.
- Cache files remain credential-free and use restrictive permissions.

### Phase 3: Documentation, Packaging, And Beta Release

Implement:

- V2-specific README and configuration documentation.
- A clear compatibility matrix for V1, OpenCode 2, `/connect`, and Mimocode.
- A beta package identity and release process that cannot replace V1 `latest` accidentally.
- A supported local-plugin development example under `.opencode/plugins/` or an explicit V2 `plugins` entry.
- Upgrade notes explaining that the old V1 plugin cannot run in OpenCode 2.

Release guidance:

- Do not change the V1 `latest` package in the initial V2 work.
- Prefer a temporary `opencode-models-discovery-v2` package name or an isolated beta/next distribution channel.
- Pin or narrowly constrain the validated `@opencode-ai/plugin@next` version.
- Test the packed and installed package, not only a workspace-local import.

## Test Plan

### Unit Tests

Retain V1 tests unchanged. Add V2 tests separately, covering:

- plugin setup registers exactly one catalog transform.
- refresh invokes reload only after inventory replacement.
- transform does no network or filesystem work.
- repeated reloads use the latest inventory without duplicate transform registration.
- custom model injection and V2 field mapping.
- model filters, model categorization, timeout, provider failure, and partial provider failure.
- explicit configured models supersede discovered baseline values.
- cache identity, TTL, sanitation, stale-cache failure behavior, and overrides.
- each metadata format's V1-to-V2 mapping, especially variants and capability fields.
- plugin tool schema validation and returned content.

### Integration Tests

Run OpenCode 2 against a local mock OpenAI-compatible HTTP server:

1. Start `opencode2` with a local V2 plugin and an empty custom provider model map.
2. Confirm plugin load with `opencode2 api get /api/plugin`.
3. Confirm the discovered model with `opencode2 api get /api/model`.
4. Execute a session using that model and assert the mock sees the configured API model ID and endpoint.
5. Change the mock inventory, invoke the refresh tool, and confirm the catalog updates without restart.
6. Assert configured API key/env auth is forwarded to discovery but never emitted by logs, status tools, or cache files.
7. Verify an unavailable provider does not prevent models from another provider appearing.
8. Run the same tests using the packed/installed plugin artifact.

Manual checks:

- Confirm model picker visibility and selection in the TUI.
- Confirm plugin reload behavior after editing a locally discovered plugin file.
- Confirm behavior after upgrading the V2 plugin package version and restarting OpenCode 2.
- If public `/connect` support is implemented, verify an API-key connection end-to-end without storing a duplicate secret in config.

## Risks And Open Questions

| Item | Risk | Required resolution |
| --- | --- | --- |
| `catalog.model.update` create semantics | The public docs show update but do not explicitly promise it creates new models. | Prove with Phase 0 integration test before porting discovery. |
| Catalog draft/provider shapes | Beta types and draft shape can change. | Compile against a pinned plugin version and record it. |
| Explicit model precedence | Transform ordering may affect whether user details win. | Verify with catalog integration tests; adjust composition approach based on observed public contract. |
| Private config placement | Passing `modelsDiscovery` through provider `settings` may affect provider packages. | Use plugin options by default; only support provider settings if proven safe. |
| `/connect` credentials | V2 storage is service-owned and V1 file fallbacks are invalid. | Use a documented V2 resolution mechanism or exclude in initial beta. |
| Dynamic commands/toasts | Public V2 APIs do not expose V1 equivalents. | Use tools and logs; distribute optional command templates separately only if needed. |
| OpenCode 2 beta churn | V2 API may change before stable release. | Isolate source, pin versions, and run integration tests on upgrade. |
| Package compatibility | V1 and V2 plugin APIs are mutually incompatible. | Keep separate entrypoints and release channels until V2 is stable. |

## Definition Of Done For Initial V2 Beta

- The V2 plugin uses only documented/public OpenCode 2 plugin APIs.
- A configured OpenAI-compatible provider can dynamically expose at least one previously unconfigured model in the V2 catalog.
- The model is selectable and requests reach the configured endpoint with the expected upstream model ID.
- Discovery failure is non-fatal.
- Explicit model config is preserved and proven by tests.
- Refresh, filters, cache, and the selected initial enrichment formats have automated coverage.
- The package is installable and verified outside the repository worktree.
- Documentation states the exact V2 config shape, version compatibility, known auth limits, and unsupported V1-only features.
- V1 `dev`/`main` behavior and release path remain unchanged until an explicit major-version release decision.
