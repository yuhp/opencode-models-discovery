# OpenCode 2 Provider Spike

Verified with the pinned `@opencode/plugin@2.0.14` and `@opencode/cli@2.0.14`
packages. The `src-v2/` package remains separate from the V1 package and
contract.

## Dual-Version Entrypoint Finding

The official V2 migration documentation and the OpenCode plugin resolver support
a combined package entrypoint for recent V1 hosts. The default export may contain
both adapters:

```ts
import { Plugin } from "@opencode/plugin"

export default {
  ...Plugin.define({
    id: "opencode.models-discovery",
    async setup(ctx) {
      // V2 adapter
    },
  }),
  async server(input, options) {
    // V1 adapter
    return createV1Hooks(input, options)
  },
}
```

The resolver dispatches by host generation:

```text
OpenCode V1 >= 1.18.29 -> default.server()
OpenCode V2              -> default.id + default.setup()
```

This does not convert V1 hooks into V2 transforms. The adapters remain separate
and should share only SDK-independent discovery, filtering, and model-mapping
logic. V1 versions older than 1.18.29 are outside this combined-entrypoint
contract and require a separate entrypoint or package version.

This finding is confirmed by the published migration documentation and the
current OpenCode resolver source (`readV1Plugin` and `getServerPlugin`).

## Plugin Resolution Mechanism (OpenCode 2 Binary Analysis)

Disassembly and runtime tracing of the official OpenCode V2 binary (`$HOME/.opencode/bin/opencode`, version `2.0.15`)
revealed the exact internal resolver mechanics in `ConfigPluginSource.scan` and `yT(r)`:

1. **Directory Enforcement for Local Plugins**:
   Direct file references (e.g. `file:///path/to/dist/index.js`) are explicitly rejected by OpenCode 2:
   ```text
   configured plugin path must be a directory
   ```
   Local plugins must be configured as directory paths (e.g. `file:///path/to/plugin-dir` or relative path).

2. **Local Directory Resolution vs. npm Package Resolution**:
   The internal resolver `yT(r)` distinguishes whether a package name `r.name` is present:
   ```javascript
   function yT(r) {
     let n = (t) => {
       for (let o of t) {
         let i = r.name ? [r.name, o].filter(Boolean).join("/") : s.resolve(r.directory, o || "index");
         try {
           return xT(i, r.directory); // Bun.resolveSync
         } catch (e) { ... }
       }
     };
     return {
       server: n(["server", ""]),
       tui: n(["tui"]),
       rpc: n(["rpc"]),
     };
   }
   ```
   - **When configuring a local directory (`file:///...`)**: `r.name` is undefined. The resolver does **not**
     read `package.json` (`main` or `exports`). Instead, it directly probes the directory via `Bun.resolveSync`:
     - 1st attempt: `path.resolve(directory, "server")` (looks for `server.ts`, `server.js`, `server.mjs`, `server.cjs`).
     - 2nd attempt: `path.resolve(directory, "index")` (looks for `index.ts`, `index.js`, `index.mjs`, `index.cjs`).
     - This explains why `file://.../src-v2` loaded successfully (found `src-v2/index.ts`).
     - This explains why `file://.../dist` loaded successfully (found `dist/server.js` or `dist/index.js`).
     - And why pointing to the bare repository root failed when neither `server.js` nor `index.js` existed directly in the root.

   - **When installed as an npm package (e.g. `"opencode-models-discovery"`)**: `r.name` is the package name.
     `yT` attempts in order:
     - 1st attempt: `"opencode-models-discovery/server"` -> resolves via `package.json` `exports["./server"]`.
     - 2nd attempt: `"opencode-models-discovery"` -> resolves via `package.json` `exports["."]`.

3. **Community Best Practice (`opencode-planner`)**:
   Production dual-compatible plugins (such as `opencode-planner`) follow this exact model:
   - Provide `./dist/index.js` for `exports["."]` (V1 root fallback and standard Node import).
   - Provide `./dist/server.js` for `exports["./server"]` (V2 primary server entrypoint).
   - Package both V1 `server()` and V2 `setup()` in the combined export.
   - For local development, point to the output directory containing the entrypoint (`file://.../dist`).

## Confirmed Contract

- A V2 module default-exported with `Plugin.define({ id, setup })` loads.
- `ctx.provider.transform()` registers a provider transform and
  `ctx.provider.reload()` rebuilds the provider registry.
- `ProviderEditor.list()` exposes `ProviderRecord` entries with a `models` map,
  including an empty map.
- `editor.add({ info, models: [] })` creates a provider without a seed model.
- A model returned by a real `/v1/models` request can be added with
  `editor.models.set()` and appears in `GET /api/model`.
- The public `ctx.provider.list()` method returns `Provider.Info[]`, not
  `ProviderRecord[]`.

## No-Seed Provider Design

Run the isolated harness from the repository root:

```sh
npm --prefix test-v2/provider-probe test
```

The runner creates temporary project, HOME, XDG config/data/cache/state
directories, removes inherited `OPENCODE*` environment variables without
printing their values, starts a mock server and the local CLI, authenticates
location-scoped API requests, enforces a bounded timeout, and cleans up both
child processes. It does not use a `--config` flag or `OPENCODE_DB=:memory:`.

The production V2 plugin reads top-level providers from `ctx.provider.list()`.
Each provider's `settings.modelsDiscovery` controls discovery, while the
provider's package, base URL, credentials, and explicit models remain in the
same top-level provider declaration. The plugin does not read
`ctx.options.providers` or create a second provider declaration from plugin
options.

The probe's passing result records:

```json
{
  "versions": { "cli": "2.0.14", "plugin": "2.0.14" },
  "proof": {
    "setup": true,
    "zeroSeed": true,
    "fetched": true,
    "requestCount": 1,
    "provider": { "id": "probe", "package": "@opencode/ai/providers/openai-compatible" },
    "model": { "providerID": "probe", "modelID": "discovery-probe-chat" }
  }
}
```

This proves the 2.0.14 plugin loader, provider transform lifecycle, actual
`/v1/models` HTTP discovery, and runtime model visibility through `/api/model`
after the provider source is registered by the plugin.

## Config Boundary

The production probe uses the canonical V2 top-level provider schema:

```json
{
  "plugins": [{
    "package": "./models-discovery",
    "options": {}
  }],
  "providers": {
    "probe": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "http://127.0.0.1:<ephemeral>/v1",
        "modelsDiscovery": { "enabled": true }
      }
    }
  }
}
```

The standalone probe confirms that the public provider transform can add a
provider with `models: []`, fetch `/v1/models`, and expose the resulting model.
The V2 adapter does not maintain a duplicate provider definition in plugin
options.

## Existing V2 Scope

The probe does not alter V1 `src/` or existing `src-v2/` code. Run the existing
V2 checks separately:

```sh
npm --prefix src-v2 run typecheck
npm --prefix src-v2 run test:run
```

## Dual-Host Runtime Verification

A real packed tarball (`opencode-models-discovery-1.5.5.tgz`) containing `dist/index.js` and `dist/server.js` was verified against clean, isolated test projects on both OpenCode generations:

1. **OpenCode V2 (`2.0.15`)**:
   - Configuration: `"plugins": [{ "package": "opencode-models-discovery", "options": {} }]`
   - Verified: Plugin ID `opencode.models-discovery` active; `DeepSeek` OpenAI-compatible `/models` discovery executed; `deepseek-flash` and `deepseek-v4-pro` dynamically injected and visible via `/api/model`.
   - Local directory testing: `file:///path/to/dist` successfully resolves `dist/server.js` or `dist/index.js`.

2. **OpenCode V1 (`1.18.32`)**:
   - Configuration: `"plugin": ["opencode-models-discovery"]`
   - Verified: `opencode debug config` successfully invokes `server(input, options)`; V1 hooks executed; `models-discovery:config` custom command registered.
