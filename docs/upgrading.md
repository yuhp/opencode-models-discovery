# Upgrading

## v1.0 Provider-Level Boundary

Version `1.0.0` completes the provider-level configuration migration started in `0.12.0`.

Plugin-level discovery config is no longer applied at runtime:

- `discovery.enabled`
- `providers.include`
- `providers.exclude`
- `models.includeRegex`
- `models.excludeRegex`
- `smartModelName`

When legacy config is detected, the plugin logs a warning, shows a migration toast, and injects `/models-discovery:migrate` into OpenCode's command list. The legacy fields are ignored for discovery behavior.

Move settings to `provider.<name>.options.modelsDiscovery`.

## Discovery Defaults

Discovery remains enabled by default for compatible providers.

Default precedence is:

1. `provider.<name>.options.modelsDiscovery.enabled` when explicitly set.
2. `OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED` when set to `true`, `1`, `yes`, `on`, `false`, `0`, `no`, or `off`.
3. Built-in default `true`.

Use `/models-discovery:config` to get assistant-guided provider-level configuration help. Use `/models-discovery:migrate` to migrate legacy plugin-level config when it is detected.

Legacy global `models.includeRegex` and `models.excludeRegex` can map to provider-level `modelsDiscovery.models.includeRegex` and `modelsDiscovery.models.excludeRegex`, but the recommended migration is provider-level `models.includeBy` and `models.excludeBy` using `field: "id"` and `match`. Provider-level `models.includeRegex` and `models.excludeRegex` remain available as id-only shortcuts. Provider-level `models.includeBy` and `models.excludeBy` support strict equality with `equals` and regex matching with `match` against top-level raw fields returned by a provider's `/v1/models` response.

## Refresh Plugin Cache After Every Upgrade

After every `opencode-models-discovery` upgrade, refresh the OpenCode plugin cache and restart OpenCode before testing the new version. OpenCode may continue using a cached plugin package after the npm package has been updated.

Refreshing the cache is especially important when:

- a newly released feature does not appear after upgrading
- behavior still matches an older plugin build
- issue fixes seem not to have taken effect locally

## Recommended Upgrade Checklist

1. Upgrade the npm package version you use.
2. Refresh the OpenCode plugin cache.
3. Restart OpenCode.
4. Start OpenCode again and verify the plugin version now matches the expected build.

The exact cache location is controlled by OpenCode. For the default npm package cache, remove the cached package directory:

```text
~/.cache/opencode/packages/opencode-models-discovery@<version>
```

If you use `@latest`, the directory may be:

```text
~/.cache/opencode/packages/opencode-models-discovery@latest
```

## OpenCode Desktop

OpenCode Desktop runs plugins in Electron's plain Node runtime, while the OpenCode CLI can load TypeScript source through Bun. The published package therefore uses compiled JavaScript (`dist/index.js`) as its runtime entry so the same npm package works in Desktop and CLI.

Desktop compatibility requires one of these loading modes:

- Use a published npm package. The release process generates and includes `dist/index.js` automatically.
- Use a local project directory with a `file://` package reference, after running `npm run compile` or `npm run build` in that project.

The local project directory mode resolves the package entry from `package.json`, which points to `dist/index.js`. If `dist/index.js` does not exist, Desktop cannot load the local package.

A direct `file://` reference to `src/index.ts` is suitable for CLI source development, because Bun can load the TypeScript source. It does not verify the published package and does not guarantee Desktop compatibility.

After upgrading a published package, refresh the OpenCode plugin cache as described above before diagnosing a Desktop loading problem.

## When This Matters Most

This is especially relevant after upgrades that change startup-time behavior, such as:

- model discovery behavior
- `/connect` credential discovery
- provider-specific discovery endpoints
- model filtering or metadata enrichment
