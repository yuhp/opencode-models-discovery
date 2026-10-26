# OpenCode v2 Issue: Provider Settings Merged Rather Than Replaced on Configuration Reload

## Status

- Reported to upstream OpenCode: [#56834](https://github.com/anomalyco/opencode/issues/56834) (Closed)
- Root cause identified as plugin-side behavior; issue closed upstream with comment.
- Fixed in `src/v2/catalog.ts` by omitting cached `settings` in `editor.add`.

## Resolution & Root Cause Analysis

### Initial Misconception
Initially, it appeared that OpenCode host was performing an in-memory `deepMerge` across config reloads without deleting absent keys, because:
- Changing a key value (e.g. `true` -> `false`) took effect immediately.
- Deleting a key left the stale value indefinitely in `GET /api/provider/{id}`.

### Actual Root Cause
OpenCode core actually creates provider state afresh on every reload from `initial: () => new Map()`. The stale values were being injected by **this plugin's** own transform:

1. **Plugin Execution Order** (`packages/core/src/plugin/supervisor.ts`):
   - Plugin lifecycle boots in order: `internal.pre` -> user plugins (`sdk.all()`, `instance.all()`) -> `internal.post`.
   - `ConfigProviderPlugin` is registered in `internal.post`.
   - Consequently, on every provider state rebuild, user plugin transforms run **before** `ConfigProviderPlugin`.

2. **Transform Injection Loop** (`src/v2/catalog.ts`):
   - In `createProviderController`, the transform iterated cached providers. When `editor.get(providerID)` returned `undefined` (because state was freshly cleared), it executed `editor.add(...)` with `settings: provider.settings` containing stale settings cached from an earlier `ctx.provider.list()`.
   - Next, `ConfigProviderPlugin` ran: `provider.settings = Provider.mergeOverlay(provider.settings, item.settings)`. Since `Provider.mergeOverlay` performs an additive merge, keys not present in the new configuration (`item.settings`) were retained from the plugin-injected draft object.
   - Finally, the plugin's `config.updated` handler called `ctx.provider.list()`, read the resurrected keys, and re-cached them, making the staleness permanent until a daemon restart or plugin deactivation.

### Control Matrix (Verification)

| Scenario | Edit | Result |
|---|---|---|
| Plugin disabled | delete `customObject.bar` | ✅ gone immediately (3s/8s/15s) |
| Plugin enabled, provider without `modelsDiscovery` | delete `customObject.bar` | ✅ gone immediately |
| Plugin enabled, provider with `modelsDiscovery` (before fix) | delete `smartModelName` | ❌ resurrected indefinitely |
| Same as above, then hot-remove plugin from config | — | ✅ stale key disappears immediately |
| Service restart | — | ✅ clean |

### Fix Applied
In `src/v2/catalog.ts`:
- Omitted `settings: provider.settings` in `editor.add`.
- Provider `settings` are authoritatively owned by the configuration file and populated by `ConfigProviderPlugin`. The plugin only contributes `headers`, `integrationID`, and discovered `models`.
- Added regression tests in `test/v2/catalog.test.ts`. Verified live that deleting keys from `opencode.json` takes effect immediately on reload.

## Summary

When `opencode.json` is modified while the OpenCode background service is running, OpenCode emits a `config.updated` lifecycle event and updates its in-memory provider registry. However, the host performs an object merge (`deepMerge`) on `providers.<id>.settings` instead of replacing the settings object with the new file contents.

As a result:
- **Modifying an existing key** (e.g., from `true` to `false`) correctly overwrites the in-memory value.
- **Deleting an existing key** from `opencode.json` leaves the previous in-memory value intact because the key is absent in the new file and is not deleted by the merge operation.
- Calling `ctx.provider.list()` or `GET /api/provider` continues to return the deleted key with its old value.

## Environment

- OpenCode version: `2.0.30`
- `@opencode/plugin`: `2.0.26`
- OS: macOS (Darwin arm64)

## Steps to Reproduce

1. Configure a provider in `opencode.json` with an explicit setting:
   ```json
   {
     "providers": {
       "my-provider": {
         "name": "My Provider",
         "package": "@opencode/ai/providers/openai-compatible",
         "settings": {
           "baseURL": "http://127.0.0.1:8000/v1",
           "modelsDiscovery": {
             "enabled": true,
             "smartModelName": true
           }
         }
       }
     }
   }
   ```
2. Start or observe the running OpenCode service. Querying `ctx.provider.list()` shows:
   ```json
   "settings": {
     "modelsDiscovery": {
       "enabled": true,
       "smartModelName": true
     }
   }
   ```
3. Edit `opencode.json` to **delete** `"smartModelName": true`:
   ```json
   {
     "providers": {
       "my-provider": {
         "name": "My Provider",
         "package": "@opencode/ai/providers/openai-compatible",
         "settings": {
           "baseURL": "http://127.0.0.1:8000/v1",
           "modelsDiscovery": {
             "enabled": true
           }
         }
       }
     }
   }
   ```
4. Observe the `config.updated` event fired by OpenCode.
5. In the event listener or via `ctx.provider.list()`, inspect `my-provider.settings.modelsDiscovery`.

## Observed Behavior

`ctx.provider.list()` still contains:
```json
"modelsDiscovery": {
  "enabled": true,
  "smartModelName": true
}
```
The deleted property `"smartModelName"` is preserved in memory.

If step 3 is changed to explicitly set `"smartModelName": false`, `ctx.provider.list()` immediately reflects `"smartModelName": false`.

## Expected Behavior

When `opencode.json` changes, the provider's `settings` object should reflect the exact parsed contents of the updated configuration file (or missing keys should be deleted/reset), so that deleting a setting reverts it to its default behavior.

## Workaround

- **Fixed in plugin**: With the fix in `src/v2/catalog.ts`, settings are no longer injected during `editor.add`, so deleting keys works as expected without workarounds.
- For earlier plugin versions:
  - Users should explicitly set keys to `false` or their default values (e.g., `"smartModelName": false`) rather than deleting them from `opencode.json`.
  - Alternatively, restarting the OpenCode service (`opencode service restart`) forces a clean load from disk.
