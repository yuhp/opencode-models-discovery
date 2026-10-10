# OpenCode v2 TUI Operations and Integration Credentials PRD

## Status

Approved Proposal & In Progress. Phase 1 & Phase 2 completed:
- Phase 1: Public Integration Credential resolution, /connect deduplication, event reactivity, 401 host execution fix, and dual-layer authorization binding.
- Phase 2: Native TUI keymap commands (`/models-discovery-refresh`, `/models-discovery-refresh-force`, aliases `/md-refresh`, `/models-refresh`), cross-process RPC dispatch, and lightweight Toast notifications (`context.ui.toast.show`), eliminating session message pollution.
- Phase 3: Interactive TUI cache inspection, force refresh, provider cache clearing, and cache-isolation safeguards.

Phase 4 is split into two parts:
- Phase 4A: Promote `models_discovery_status` from an Agent Tool to the native TUI slash command `/models-discovery-status`, with interactive inspection of resolved provider and model metadata.
- Phase 4B: Per-model discovery overrides and customization are deferred until a demonstrated need for local metadata correction or model-level disabling exists.

The phase groups user-facing model discovery operations and credential resolution into one
TUI-oriented workflow. The existing V2 Agent Tools remain supported for automation and agent
use, while direct user actions are exposed through native TUI commands, dialogs, and toasts
backed by OpenCode v2's built-in RPC, Keymap, UI Dialog, and Integration APIs.

## Background

OpenCode v2 currently supports provider model discovery, manual refresh, host-managed caching,
model status inspection, and several metadata enrichment formats. Several operational capabilities
are intentionally incomplete or interim:

- `/models-discovery-refresh` uses an interim Server Command and Session-based feedback (`session.synthetic()`),
  which can advance an active Agent loop and trigger unintended LLM calls;
- users cannot inspect or clear V2 cache entries from the TUI;
- cache-associated per-model overrides are deferred and not yet available in V2;
- discovery can use an API key from provider settings, but public V2 integration credentials are
  not yet resolved and injected into discovery requests;
- sensitive credential data must remain strictly outside discovery status, logs, cache entries, and model
  configuration.

Investigation into `@opencode/plugin@2.0.14` and its sibling packages reveals that OpenCode v2
already provides:
1. **Host-resolved separate entrypoints**: The host loader resolves `server` (`server.(js|ts)`) and `tui` (`tui.(js|ts)`) entrypoints within a single plugin package or local directory.
2. **Cross-process RPC**: Standardized Server-TUI RPC via `@opencode/schema/rpc`, allowing the TUI to call server-side controllers cleanly without synthetic session messages.
3. **Built-in TUI Dialogs**: `context.ui.dialog` exposes standard `select`, `prompt`, `confirm`, and `alert` primitives, enabling multi-step configuration menus without requiring custom Solid JSX rendering.
4. **Public Integration Credentials**: `context.integration.connection.active()` and `resolve()` expose active provider credentials without private storage inspection.

## Goals

1. Replace the interim refresh feedback path with a native TUI command and toast flow using cross-process RPC.
2. Provide interactive TUI operations for inspecting, refreshing, and clearing V2 discovery cache data.
3. Provide a native TUI view for inspecting the resolved V2 discovery inventory and model metadata.
4. Resolve API keys through documented public V2 integration APIs (`ctx.integration.connection`) and inject them
   into discovery requests without duplicating secrets in configuration or plugin storage.
5. Reuse one server-side operation controller for startup, configuration changes, TUI actions,
   and existing Agent Tools.
6. Preserve V1 behavior, the V1/V2 cache boundary, and ensure cache clears never delete user model overrides.
7. Make all user-visible results safe, concise, and useful for diagnosing provider and model metadata issues.

## Non-Goals

- Changing the OpenCode v1 adapter, V1 commands, V1 cache format, or V1 auth fallback.
- Importing or automatically sharing V1 XDG cache files with V2.
- Reading OpenCode internal databases, service files, `auth.json`, or Mimocode credential files.
- Writing arbitrary changes to `opencode.json` from the plugin.
- Implementing OAuth flows, API-key creation, provider account linking, or secret rotation inside
  this plugin (delegated to OpenCode v2 integrations).
- Replacing the existing Agent Tools with TUI-only functionality.
- Exposing raw API keys, Authorization headers, OAuth tokens, or complete credential objects.
- Making V2 stable or removing its beta designation as part of this phase.

## Architecture Overview

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        OpenCode v2 TUI Process                         │
│                                                                        │
│  src/tui.ts (TUI Plugin: @opencode/plugin/tui)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Commands & Dialogs (via context.keymap & context.ui.dialog)      │  │
│  │  - /models-discovery-refresh                                     │  │
│  │  - /models-discovery-cache (Inspect / Clear / Force)             │  │
│  │  - /models-discovery-status (Inspect Providers / Models)         │  │
│  │ Feedback                                                         │  │
│  │  - context.ui.toast.show()                                       │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    │ context.client.rpc(...)           │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ RPC Transport (IPC / HTTP)
┌────────────────────────────────────┼───────────────────────────────────┐
│                                    │                                   │
│                        OpenCode v2 Server Process                      │
│                                    ▼                                   │
│  src/v2/index.ts (Server Plugin: @opencode/plugin)                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ RPC Handlers (registered via context.rpc.register)               │  │
│  │  - refresh({ force })                                            │  │
│  │  - cache.inspect() / cache.clear()                               │  │
│  │  - status() / cache.inspect() / cache.clear()                    │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    │                                   │
│  ┌─────────────────────────────────▼────────────────────────────────┐  │
│  │ Shared Discovery & Operations Controller                         │  │
│  │  ├─ Integration Credential Resolver (ctx.integration.connection) │  │
│  │  ├─ Host Storage Cache Manager (ctx.storage)                     │  │
│  │  ├─ Model Override Storage Manager (ctx.storage)                 │  │
│  │  └─ Catalog Reload & Transform Manager (ctx.provider)            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Packaging and Dual Entrypoint Resolution

OpenCode v2's host resolver (`Host.resolve(target)`) resolves:
- `server`: resolved from subpaths `["server", ""]`, loading `dist/server.js` or `dist/index.js`.
- `tui`: resolved from subpath `["tui"]`, loading `dist/tui.js`.
- `rpc`: resolved from subpath `["rpc"]`.

To support this seamlessly:
1. `package.json` declares:
   ```json
   {
     "exports": {
       ".": { "types": "./src/index.ts", "default": "./dist/index.js" },
       "./server": { "types": "./src/server.ts", "default": "./dist/server.js" },
       "./tui": { "types": "./src/tui.ts", "default": "./dist/tui.js" }
     }
   }
   ```
2. Build script adds `compile:tui`:
   ```bash
   esbuild src/tui.ts --bundle --format=esm --platform=node --packages=external --target=node18 --sourcemap --keep-names --outfile=dist/tui.js
   ```
3. Local directory references (`file:///path/to/dist`) resolve `dist/server.js` in daemon mode and `dist/tui.js` in TUI mode.

## Cross-Process RPC Contract

Defined in `src/v2/rpc.ts` via `@opencode/schema/rpc`:

```ts
import { Rpc } from "@opencode/schema/rpc"

export const DiscoveryRpcDefinition = Rpc.define({
  id: "opencode.models-discovery",
  methods: {
    refresh: {
      input: {
        force: { type: "boolean", optional: true },
      },
      output: {
        providers: { type: "number" },
        refreshedProviders: { type: "number" },
        cachedProviders: { type: "number" },
        failedProviders: { type: "number" },
        discoveredModels: { type: "number" },
        cacheBypassed: { type: "boolean" },
        failures: {
          type: "array",
          items: {
            type: "object",
            properties: {
              providerId: { type: "string" },
              reason: { type: "string" },
            },
          },
        },
      },
    },
    cacheInspect: {
      input: {
        providerID: { type: "string", optional: true },
      },
      output: {
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              providerID: { type: "string" },
              status: { type: "string" }, // "fresh" | "expired" | "empty" | "corrupt"
              fetchedAt: { type: "number", optional: true },
              ttlSeconds: { type: "number", optional: true },
              modelCount: { type: "number", optional: true },
            },
          },
        },
      },
    },
    cacheClear: {
      input: {
        providerID: { type: "string", optional: true }, // undefined means all providers
      },
      output: {
        cleared: { type: "number" },
      },
    },
    overrideList: {
      input: {
        providerID: { type: "string", optional: true },
      },
      output: {
        overrides: {
          type: "array",
          items: {
            type: "object",
            properties: {
              providerID: { type: "string" },
              modelID: { type: "string" },
              patch: { type: "object" },
              enabled: { type: "boolean" },
              updatedAt: { type: "string" },
            },
          },
        },
      },
    },
    overrideSet: {
      input: {
        providerID: { type: "string" },
        modelID: { type: "string" },
        patch: { type: "object" },
        enabled: { type: "boolean", optional: true },
      },
      output: {
        success: { type: "boolean" },
      },
    },
    overrideDelete: {
      input: {
        providerID: { type: "string" },
        modelID: { type: "string" },
      },
      output: {
        success: { type: "boolean" },
      },
    },
  },
  events: {},
})
```

- **Server-Side Registration**:
  `ctx.rpc.register(DiscoveryRpcDefinition, handlers)`
- **TUI-Side Invocation**:
  `const client = ctx.client.rpc(DiscoveryRpcDefinition)` -> `await client.refresh({ force: false })`

## User Experience and Interactive Flows

All TUI commands register through `context.keymap.layer(...)` with both `slash` and `palette: true`:

### 1. Manual Refresh (`/models-discovery-refresh`)

1. User enters `/models-discovery-refresh` in prompt or selects from palette.
2. TUI runs `await client.refresh({ force: false })`.
3. TUI displays `context.ui.toast.show(...)`:
   - Success: `Model discovery refreshed: discovered 14 models from 2 providers.` (`variant: "success"`)
   - Partial: `Model discovery refreshed: 14 models from 2 providers (1 provider failed).` (`variant: "warning"`)
   - Failure: `Model discovery failed: authentication failed for 1 provider.` (`variant: "error"`)
4. **No message is injected into the session**; the agent loop is unaffected.

### 2. Cache Operations (`/models-discovery-cache`)

Uses `context.ui.dialog.select` and `context.ui.dialog.confirm` to build a clean terminal menu:

1. Main Action Selection:
   - `[📊 Inspect Cache Status]`: Shows provider cache states (fresh/expired/TTL/model count) in an alert or dialog.
   - `[🔄 Force Refresh (Bypass Cache)]`: Calls `client.refresh({ force: true })` and shows toast.
   - `[🗑️ Clear Provider Cache]`: Prompts user with a provider list (`dialog.select`), asks for confirmation (`dialog.confirm`), calls `client.cacheClear({ providerID })`, and shows toast.
   - `[💥 Clear All Discovery Caches]`: Confirms and clears all provider discovery caches.

### 3. Discovery Status (`/models-discovery-status`)

The existing `models_discovery_status` Agent Tool becomes available through a native TUI command. The command reuses the server-side status controller and displays the resolved, post-processing model inventory without exposing credentials.

1. User enters `/models-discovery-status` in the prompt or selects it from the palette.
2. TUI calls the status RPC with the active location.
3. TUI presents a three-level browsing flow:
   - **Provider list**: shows Provider ID, display name, and the total number of resolved models;
   - **Model list**: after selecting a Provider, shows each model ID and display name;
   - **Model details**: after selecting a model, shows its resolved identity, API model ID, context/output/input limits, modalities, tools, reasoning, attachments, and variants.
4. The model list provides a return action to go back to the Provider list; closing a dialog exits the flow.
5. The command accepts an optional Provider filter, for example `/models-discovery-status --provider hyy`.
6. The presentation uses structured sections and one property per line rather than embedding the Markdown status report in the detail view.
7. No model configuration is changed by this command.

### 4. Model Override Management (`/models-discovery-override`) — Deferred

Allows users to customize discovered models without touching code:

1. **Step 1 - Select Provider**: `dialog.select` from configured providers.
2. **Step 2 - Select Model**: `dialog.select` from models discovered or overridden for that provider.
3. **Step 3 - Select Action**:
   - `Set Display Name`: `dialog.prompt` -> updates `patch.name`.
   - `Set Context Window Limit`: `dialog.prompt` -> updates `patch.limit.context`.
   - `Set Max Output Tokens Limit`: `dialog.prompt` -> updates `patch.limit.output`.
   - `Set Reasoning Effort`: `dialog.select(['low', 'medium', 'high'])` -> updates reasoning variant.
   - `Toggle Enable/Disable`: flips `override.enabled`.
   - `Delete Override`: `dialog.confirm` -> calls `client.overrideDelete(...)`.
4. Saves to host storage via RPC and calls `ctx.provider.reload()`, immediately updating the runtime catalog.

## Integration Credentials Resolution

### Resolution Flow

In `src/v2/discovery.ts`, discovery authenticates providers in priority order:

1. **Explicit Setting**: `provider.settings.apiKey` (with `${ENV_VAR}` expansion performed by OpenCode).
2. **Public Integration Connection**:
   When `settings.apiKey` is not set, resolve via `ctx.integration`:
   ```ts
   const targetID = (provider.settings.integrationID as string) || provider.id
   const activeConn = await ctx.integration.connection.active(targetID)
   if (activeConn) {
     const credential = await ctx.integration.connection.resolve(activeConn)
     // credential:
     // - { type: "key", key: string } -> Authorization: Bearer <key>
     // - { type: "oauth", access: string, refresh: string } -> Authorization: Bearer <access>
     // - activeConn.type === "env" -> process.env[activeConn.name]
   }
   ```
3. **Unauthenticated**: No Authorization header for local servers.

### Security Redaction Rules

- The resolved secret exists only within the immediate fetch execution scope.
- `credential.key` and `credential.access` must never be written to:
  - V2 host cache (`ctx.storage`);
  - Model draft definitions;
  - RPC returned outputs;
  - Tool outputs (`models_discovery_status`);
  - Log entries or error messages.

## Storage and Precedence Boundaries

### Storage Separation in `ctx.storage`

The plugin utilizes two distinct storage key prefixes:
1. `discovery-cache:${providerID}`: Remote provider discovery response & enrichment (ephemeral, TTL-governed).
2. `discovery-override:${providerID}`: User model customization rules (durable, indefinite lifetime).

**Rule**: Clearing cache records (`cacheClear`) will strictly match `discovery-cache:*` and **never** delete user overrides.

### Catalog Precedence

When assembling final models in `ctx.provider.transform`:
```text
OpenCode built-in/catalog baseline
  -> Discovered model baseline (fresh or cached)
  -> Enabled V2 model override (patch merged)
  -> User explicit models (providers.<id>.models.<modelID> in opencode.json)
```

Explicit user configuration in `opencode.json` remains the absolute highest authority.

### Inactive Overrides Handling

If a model is temporarily omitted from upstream discovery, its override is marked `inactive` in storage. It is not discarded. If the model is returned on a subsequent discovery run, the override immediately re-attaches.

## Delivery Phases

### Phase 1: Shared RPC Definition & Public Credential Integration
- Create `src/v2/rpc.ts` with `DiscoveryRpcDefinition`.
- Implement `V2CredentialResolver` using `ctx.integration.connection.active` and `resolve`.
- Mount RPC handlers on Server Plugin setup (`src/v2/index.ts`).
- Add tests for credential resolution priority, error handling, and secret redaction.

### Phase 2: TUI Plugin Entrypoint & Native Refresh Command
- Configure `package.json` exports and `compile:tui` build target.
- Implement `src/tui.ts` using `@opencode/plugin/tui`.
- Implement native `/models-discovery-refresh` invoking RPC and showing `context.ui.toast.show()`.
- Deprecate or retire the interim Server Command feedback.

### Phase 3: Interactive TUI Cache Operations
- Implement server-side `cacheInspect` and `cacheClear` RPC handlers.
- Implement `/models-discovery-cache` using `dialog.select` and `dialog.confirm`.
- Add tests verifying cache inspection status reporting and cache clear isolation.

### Phase 4A: Native TUI Discovery Status
- Define or expose a status RPC contract based on the existing `models_discovery_status` Agent Tool output.
- Implement `/models-discovery-status` using the active TUI location and native dialog/alert presentation.
- Display resolved provider and model metadata, cache state, capabilities, limits, and safe failure details.
- Support readable filtering or selection for provider/model details where needed.
- Add tests covering status serialization, metadata presentation, filtering, and secret redaction.

### Phase 4B: V2 Per-Model Overrides — Deferred
- Implement versioned V2 override storage and catalog transform merging.
- Implement `overrideList`, `overrideSet`, and `overrideDelete` RPC handlers.
- Implement `/models-discovery-override` dialog workflow in TUI.
- Add tests verifying override precedence, merging rules, and inactive override retention.

Phase 4B is intentionally deferred. It should be scheduled only after real usage demonstrates a need for provider metadata correction, local model renaming, per-model limits, or model-level enable/disable controls. The deferred scope must not block Phase 4A status inspection.

### Phase 5: Verification, Packaging & Documentation
- End-to-end loadability and entrypoint tests for both `server` and `tui`.
- Update user documentation (`docs/configuration.md`, `README.md`) with the new TUI slash commands and integration credentials guide.
- Verify full test suite passes.

## Test Plan

### Unit Tests
- RPC method handler input validation and output serialization.
- `V2CredentialResolver` handles `key`, `oauth`, `env`, missing connection, and resolution failure.
- API keys are absent from status reports, cache records, and error structures.
- Status RPC and `/models-discovery-status` presentation expose resolved provider/model metadata without secrets.
- Cache clear accurately deletes cache entries without impacting override entries.

The following tests belong to deferred Phase 4B and are not required for Phase 4A:
- Override merging correctly handles name, context limit, output limit, and reasoning effort.
- Catalog transform correctly orders: discovered < override < explicit config.
- Inactive overrides remain preserved when upstream models disappear.

### Host Integration Checks
Using mock host context:
1. Verify `Host.resolve` correctly locates `server` and `tui` entrypoints.
2. Verify TUI command dispatch invokes the Server RPC handler.
3. Verify toast is displayed with correct message format.
4. Verify dialog selection transitions through multi-step menus cleanly.
5. Verify `/models-discovery-status` renders the resolved inventory for the active location.

## Definition of Done

- `/models-discovery-refresh` runs via native TUI Keymap command and reports via Toast without synthetic session messages.
- `/models-discovery-cache` provides interactive cache inspection and clearing.
- `/models-discovery-status` provides native TUI inspection of resolved provider and model metadata.
- OpenCode v2 Integration credentials can be consumed automatically by model discovery requests.
- All unit, typecheck, lint, and entrypoint loadability tests pass.
- Documentation accurately describes all new capabilities while noting V2 beta status.

Per-model customization via `/models-discovery-override` is explicitly deferred and is not part of the current Definition of Done.
