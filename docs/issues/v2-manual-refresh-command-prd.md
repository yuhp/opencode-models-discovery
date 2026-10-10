# V2 Manual Model Refresh Command PRD

## Status

Proposal. The current Server Command implementation is accepted as an interim solution. A future iteration may
replace its Session-based feedback with a TUI-only toast flow.

This document defines a future OpenCode v2 `/models-discovery-refresh` command and its relationship with
`config.updated`, the existing Agent Tools, and the startup retry flow.

## Background

`opencode-models-discovery` provides two V2 Agent Tools:

- `models_discovery_refresh`
- `models_discovery_status`

The refresh tool can be called by an Agent, but users need a direct TUI command to trigger model discovery.

Model discovery depends on two runtime states:

1. The latest configuration in the OpenCode Provider Registry.
2. The plugin's in-memory `providers`, `discovery`, and `inventory` state.

Requesting model discovery alone is insufficient after a user changes a provider `baseURL`, endpoint, filters, or
enablement. A manual refresh must therefore reuse the complete configuration refresh flow rather than introduce a
second network-request implementation.

## Goals

- Provide a user-facing `/models-discovery-refresh` TUI command.
- Reuse one configuration refresh operation from the command and `config.updated`.
- Keep `models_discovery_refresh` and the startup retry flow on the same operation.
- Serialize all refresh entry points through one queue.
- Always refresh from the current OpenCode configuration and remote provider state.
- Preserve the existing full-replacement semantics: failed or empty discovery results do not restore the old
  discovery inventory.
- Avoid modifying user configuration files or introducing separate configuration storage.
- Provide usable refresh feedback with the current Server Command implementation.
- Define a migration path to TUI-only toast feedback without changing the refresh operation itself.

## Non-Goals

- Writing or modifying `opencode.json` from the command.
- Managing API keys, OAuth, or other credentials from the command.
- Adding persistent model inventory or a new cache.
- Faking or publishing a `config.updated` event.
- Restoring the old discovery inventory after a failed request.
- Implementing the command as a new Agent prompt.
- Removing the existing Agent Tools.
- Changing OpenCode v1 commands, configuration, or plugin behavior.

## User Experience

The user runs the following command in the OpenCode v2 TUI:

```text
/models-discovery-refresh
```

On success, the current Server Command displays a refresh result in the active session. The future TUI-only adapter will
display the same result as a toast:

```text
Model discovery refreshed: discovered 12 models from 2 providers.
```

When no provider has discovery enabled:

```text
Model discovery refreshed: discovered 0 models from 0 providers.
```

On failure, the current command displays a readable safe error. The future TUI-only adapter will display it as an error
toast. Error messages and logs must not contain API keys,
Authorization headers, OAuth tokens, raw credential objects, or complete sensitive provider settings.

## Feedback Strategy

### Interim implementation

The current implementation may use the Server Plugin Command API and `ctx.session.synthetic()` to report the result.
This keeps the command available while the TUI-only integration path is being evaluated.

The interim implementation must continue to avoid direct calls to:

```ts
ctx.session.prompt()
ctx.session.generate()
```

It must also keep the refresh result safe and must not include credentials.

### Future TUI-only implementation

`ctx.session.synthetic()` must not be considered the final feedback mechanism.

Although `session.synthetic()` does not directly call an LLM API, it injects a message into the current Session. If
that Session has an active or continuing Agent loop, the injected message can cause the loop to continue and indirectly
trigger another LLM request. This violates the requirement that a manual refresh should complete without an Agent
model call.

The intended follow-up design is:

```text
TUI Plugin command
  -> invoke a server-side refresh operation through a supported RPC/client path
  -> receive { providers, models } or a safe error
  -> call ctx.ui.toast.show(...)
  -> do not call session.synthetic(), session.prompt(), or session.generate()
```

The server-side plugin remains responsible for refresh orchestration. A separate TUI adapter and a supported
server-to-TUI invocation path can be introduced in a later iteration. The current interim implementation is not
blocked on that migration.

## Terminology

### Configuration Refresh

The complete configuration-driven discovery flow is:

```text
provider.reload()
  -> read the latest Provider Registry
  -> syncConfiguredProviders()
  -> integration.reload()
  -> resolve active credentials
  -> request provider model lists and optional metadata
  -> build a replacement inventory
  -> controller.replaceInventory()
  -> provider.reload() to materialize the new inventory
```

### Inventory Refresh

An inventory refresh uses the already synchronized `providers` and `discovery` state to resolve credentials, request
remote data, filter and enrich models, and replace the inventory.

### Transform Registration

Provider, Integration, Tool, and Command transforms are registered once during plugin setup. Configuration changes and
manual refreshes must not register duplicate callbacks.

## Functional Requirements

### FR-1: Register the Refresh Command

The future implementation must expose:

```text
/models-discovery-refresh
```

The final implementation should use the V2 TUI plugin API and a TUI keymap slash command, for example:

```ts
context.keymap.layer(() => ({
  mode: "global",
  commands: [{
    id: "opencode.models-discovery.refresh",
    title: "Refresh discovered models",
    slash: { name: "models-discovery-refresh" },
    run: async () => {
      // invoke the server-side refresh operation
      // show ctx.ui.toast.show(...) with the result
    },
  }],
}))
```

The interim Server Command must not submit a prompt. It may use `session.synthetic()` for result feedback as described
in the interim feedback strategy. The future TUI-only command must not submit a prompt or inject a synthetic Session
message.

### FR-2: Reuse the Configuration Refresh Operation

The server-side implementation must expose one reusable operation, for example:

```ts
refreshFromCurrentConfig(): Promise<RefreshResult>
```

It must perform the same complete flow as `config.updated`:

1. Call `ctx.provider.reload()` so `ctx.provider.list()` sees current configuration.
2. Call `syncConfiguredProviders()` to update `providers` and `discovery`.
3. Call `ctx.integration.reload()` when integrations are configured.
4. Resolve active credentials.
5. Request model lists and optional metadata.
6. Build a complete replacement inventory.
7. Call `controller.replaceInventory()`.
8. Let `replaceInventory()` reload the Provider Registry so the inventory is materialized.
9. Return the current provider and model counts.

The command must reuse the business operation, not construct a fake OpenCode event.

### FR-3: Share One Operation Across All Entry Points

The following entry points must use the same refresh operation:

```text
startup                 -> refreshFromCurrentConfig()
config.updated          -> refreshFromCurrentConfig()
models_discovery_refresh -> refreshFromCurrentConfig()
/models-discovery-refresh -> refreshFromCurrentConfig()
bootstrap retry         -> refreshFromCurrentConfig()
```

There must be no separate provider request implementation in the command, no inventory-only behavior in the Agent
Tool, and no separate configuration-reading logic in the retry path.

### FR-4: Serialize Refresh Operations

All refresh entry points must use one Promise queue. A later operation must not concurrently modify `providers`,
`discovery`, `inventory`, or the Provider Registry.

Recommended structure:

```ts
let operationChain = Promise.resolve()

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = operationChain.then(operation)
  operationChain = run.then(() => undefined, () => undefined)
  return run
}

function refreshFromCurrentConfig() {
  return enqueue(async () => {
    await ctx.provider.reload()
    await syncConfiguredProviders()
    return refreshInventoryInternal()
  })
}
```

`refreshInventoryInternal()` must not enqueue itself, or nested queue waits can deadlock.

### FR-5: Command Feedback

The interim Server Command must report success and failure through the currently supported Session feedback path.
The current implementation may use:

```ts
await ctx.session.synthetic({
  sessionID,
  text: formatRefreshResult(result),
})
```

The future TUI-only implementation should report success and failure with `context.ui.toast.show()`:

```ts
context.ui.toast.show({
  title: "Model Discovery",
  message: formatRefreshResult(result),
  variant: "success",
})
```

Failure feedback should use `variant: "error"` and a safe, non-sensitive message.

The command must not call:

```ts
ctx.session.prompt()
ctx.session.generate()
```

Until the TUI-only migration is implemented, `ctx.session.synthetic()` remains permitted as interim feedback, with the
known risk described above. The Agent Tool may continue returning model-visible content because that is its intended
execution model.

### FR-6: Failure Semantics

The feature follows the existing full-rebuild rules:

- A provider that fails its request is omitted from the replacement inventory for that refresh.
- A valid empty model list produces no discovered models for that provider.
- Filters can exclude all models.
- A configuration read failure clears the synchronized plugin configuration; later refreshes use the empty state.
- The old discovery inventory is not restored after a failed request.
- Explicitly configured providers and models remain governed by OpenCode's base configuration and Provider transform
  semantics; the plugin must not restore them from the old discovery inventory.

If orchestration fails, the server operation must return a safe failure to the TUI adapter and Agent Tool and record a
safe error in logs.

### FR-7: Register Transforms Once

The following registrations must occur once per plugin lifecycle:

```ts
ctx.command.transform(...)
ctx.tool.transform(...)
ctx.provider.transform(...)
ctx.integration.transform(...)
```

Configuration updates and manual refreshes must not invoke them again. Refresh callbacks may reference mutable plugin
state, but must not capture a stale provider snapshot.

### FR-8: Do Not Leak Credentials

Refresh results, TUI toasts, Agent Tool content, status output, and logs must not contain:

- API keys;
- Authorization headers;
- OAuth access tokens;
- raw integration credential objects;
- complete provider settings containing sensitive values.

## Suggested Code Structure

```text
syncConfiguredProviders()
  read ctx.provider.list() and update providers/discovery

refreshInventoryInternal()
  use current providers/discovery for integration, credentials, HTTP discovery,
  and inventory replacement

refreshFromCurrentConfig()
  enter the shared queue, reload providers, sync configuration,
  then call refreshInventoryInternal

registerDiscoveryTools()
  register models_discovery_refresh and models_discovery_status

server refresh API
  expose the shared operation to the TUI adapter through a supported API

TUI plugin
  register /models-discovery-refresh and show success/error toasts

event loop
  config.updated -> refreshFromCurrentConfig()
```

Recommended result type and formatter:

```ts
interface RefreshResult {
  readonly providers: number
  readonly models: number
}

function formatRefreshResult(result: RefreshResult): string {
  return `Model discovery refreshed: discovered ${result.models} models from ${result.providers} providers.`
}
```

## Lifecycle and Cleanup

Plugin cleanup must:

1. Abort the event subscription.
2. Stop bootstrap retries.
3. Prevent new refresh operations after unload.
4. Dispose registrations if the runtime requires plugins to manage them explicitly.
5. Ensure an unloaded plugin's command or Agent Tool cannot modify the Provider Registry.

The TUI adapter must also remove its keymap layer and release any RPC/client listeners during cleanup.

## Compatibility

- Implement only in the OpenCode v2 adapters.
- Do not change the OpenCode v1 `server()` adapter.
- Do not generate a V1 command.
- Keep `models_discovery_refresh` and `models_discovery_status` compatible.
- Update documentation that says V2 dynamic commands are unsupported once the TUI adapter is validated.
- Record the `session.synthetic()` feedback path as an interim limitation until the TUI-only migration is complete.

## Test Plan

### Unit Tests

Add or update `test/v2/plugin.test.ts` and TUI adapter tests to cover:

1. The server-side refresh operation is shared by startup, events, retry, and Agent Tool.
2. The TUI slash command is registered once.
3. The command name and description are correct.
4. The command invokes the current-config refresh operation.
5. Success displays a success toast.
6. Failure displays a safe error toast.
7. The interim command does not call `session.prompt` or `session.generate`; the future TUI adapter must not call any
   Session feedback API.
8. Tool, command, and `config.updated` use the same refresh path.
9. Provider reload occurs before configuration synchronization.
10. Command and event refresh operations are serialized.
11. Transform registration counts remain one after repeated refreshes.
12. Results do not contain API keys or Authorization headers.
13. Empty configuration returns zero providers and zero models.
14. Provider discovery failures follow the replacement-inventory rules.

### Integration Tests

Using OpenCode v2 and a local mock OpenAI-compatible server:

1. Start a project with one discovery-enabled provider.
2. Confirm the initial model exists through `/api/model`.
3. Change the mock server's model response.
4. Run `/models-discovery-refresh` in the TUI.
5. Confirm the current command reports its result and document the known Session feedback behavior. After the TUI-only
   migration, confirm the TUI shows a toast and no LLM request is generated for the command.
6. Confirm the new model appears and filtered models disappear.
7. Change the provider endpoint or filter configuration.
8. Run the command again and verify the latest configuration is used.
9. Confirm no service restart is required.
10. Confirm Agent Tool and `config.updated` produce the same inventory.
11. Confirm failures do not expose credentials.
12. Confirm one failing provider does not prevent the remaining providers from following the existing isolation rules.

### Regression Tests

- All V1 tests remain passing.
- Existing V2 tests and new tests remain passing.
- Package-loadability checks remain passing; the former packed-package host E2E was removed because it depended on machine-specific OpenCode paths and live provider endpoints.
- Plugin setup registers Provider, Integration, Tool, and TUI command behavior once.

## Acceptance Criteria

The feature is complete when:

- Users can execute `/models-discovery-refresh` in the TUI.
- The command displays the refreshed provider/model counts in a TUI toast.
- The interim command uses the accepted Server Command feedback path; the future TUI-only command does not write to the
  active Session or trigger an LLM request.
- The command, Agent Tool, `config.updated`, startup, and retry use one configuration refresh operation.
- Manual refresh reloads current Provider configuration instead of using stale plugin state.
- All refresh entry points are serialized.
- No refresh entry point duplicates transform registration.
- Added and removed models are reflected in `/api/model` without restarting OpenCode.
- Credentials are absent from toasts, tool output, and logs.
- OpenCode v1 behavior is unchanged.
- Documentation no longer claims that the validated V2 TUI command is unsupported.

## Risks and Open Questions

| Area | Risk | Mitigation |
| --- | --- | --- |
| TUI/server split | The TUI and server plugin contexts expose different APIs. | Use a supported client or RPC path and test against the target OpenCode version. |
| Synthetic feedback | `session.synthetic()` can advance an active Agent loop and indirectly trigger an LLM call. | Accept it as an interim limitation; migrate to TUI toast feedback later. |
| Command API version | V2 command and TUI APIs may change. | Use the installed `@opencode/plugin` types and add compile/integration coverage. |
| Command concurrency | The command and events may refresh simultaneously. | Use the shared operation queue. |
| Configuration failure | Clearing configuration may temporarily remove discovered models. | Preserve full-rebuild semantics and show a safe failure toast. |
| Provider partial failure | Providers may return different results in one refresh. | Keep provider isolation and test partial failures. |
| Documentation drift | Older V2 docs may still describe dynamic commands as unsupported. | Update the docs only after the TUI implementation is validated. |
