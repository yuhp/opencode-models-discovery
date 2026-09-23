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
current OpenCode resolver source (`readV1Plugin` and `getServerPlugin`). The
repository has not yet added a two-host runtime probe for a packed combined
package, so the V1 minimum-version boundary and clean-install dependency
behavior remain release verification requirements.

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

The standalone probe records the provider-transform behavior when the production
plugin owns the provider declaration. An earlier diagnostic observed that the
native provider was absent during setup but present after setup when
`ctx.options.providers` was available. That result does not establish whether
the native config transform is non-bootstrapping or whether setup ordering is
responsible, so this document does not claim either behavior as a core rule.
The production V2 plugin therefore uses its canonical plugin-option provider
declaration and creates zero-model sources through its own public provider
transform.

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

The production probe uses the canonical V2 plugin-option schema directly:

```json
{
  "plugin": [["./models-discovery", {
    "providers": {
      "probe": {
        "package": "@opencode/ai/providers/openai-compatible",
        "settings": { "baseURL": "http://127.0.0.1:<ephemeral>/v1" }
      }
    }
  }]]
}
```

The standalone probe confirms that the public provider transform can add a
provider with `models: []`, fetch `/v1/models`, and expose the resulting model.
It does not by itself prove how the native config transform handles an empty
`models` map during setup.

## Existing V2 Scope

The probe does not alter V1 `src/` or existing `src-v2/` code. Run the existing
V2 checks separately:

```sh
npm --prefix src-v2 run typecheck
npm --prefix src-v2 run test:run
```
