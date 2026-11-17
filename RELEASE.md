# Release Process

This project uses a two-step automated release system. The Release workflow prepares a release PR from `dev`, and the Publish workflow publishes after that PR is merged to `main`.

## Quick Start

1. Merge ready feature PRs into `dev`.
2. Run the GitHub Actions `Release` workflow.
3. Keep `source_branch` as `dev` unless intentionally releasing from another branch.
4. Choose `patch`, `minor`, or `major`.
5. Review and merge the generated `release/vX.Y.Z -> main` PR.
6. The `Publish` workflow runs automatically after the release PR changes `package.json` on `main`.
7. After publishing, sync `main` back into `dev` so the version bump is carried forward.

## Branch Flow

```text
feature branches -> dev -> release/vX.Y.Z -> main -> publish
```

Release branches are short-lived per-version branches. There is no long-lived `release` branch.

## Bundled Dependencies

`dist/runtime.js` and `dist/tui.js` bundle the OpenCode plugin SDKs (`@opencode/plugin`, and the type-only `@opencode-ai/plugin`) at build time, so the published package declares **no runtime or peer dependencies** and hosts install it without unpacking a dependency tree. Consequences for releases:

1. Bump the `@opencode/plugin` / `@opencode-ai/plugin` devDependencies when preparing a release if you want the published plugin to track a newer SDK; the bundled copy is otherwise frozen at the last bump.
2. Do not add entries to `dependencies`, `peerDependencies`, or `optionalDependencies`. Hosts materialize every installed dependency as individual files in their plugin cache (a previous external-SDK setup unpacked ~30k files per install). `npm run check:bundle` fails the build if a bundled output keeps an external import or the manifest declares installable dependencies again.
3. `npm run compile` regenerates `dist/THIRD-PARTY-NOTICES.md` from the esbuild metafiles: an inventory of every bundled package with its exact version and full license text, shipped inside the tarball. `npm run check:notices` (part of `validate:package`) fails if the file is stale or a bundled package has no license classification, and `scripts/release.ts` embeds the SDK versions it lists into the GitHub release notes.
4. Development builds (`npm run build`) retain source maps for debugging. Release publishing uses `npm run build:release`, which compiles without source maps and removes stale `.map` files before packaging. The `files` allowlist also excludes source maps as a final packaging safeguard.

## Release Validation

`npm run validate:package` (run by the publish path) checks the release contract introduced with the bundling change:

- `npm run check:bundle` — zero installable dependencies, SDKs bundled into the runtime.
- `npm run check:notices` — `dist/THIRD-PARTY-NOTICES.md` matches what the bundles actually contain.
- `test/types-consumer.test.ts` (via the test suites) — a clean consumer typechecks against the published package with nothing but ambient Node types installed.

## What the Workflows Do

### Release Workflow

The Release workflow (`.github/workflows/release.yml`) is manually triggered. It checks out `dev` by default and runs:

```bash
bun scripts/release.ts prepare <patch|minor|major>
```

It will:

1. Create `release/vX.Y.Z` from the selected source branch.
2. Bump `package.json` to `X.Y.Z`.
3. Run `npm run build`.
4. Commit the version bump.
5. Push the release branch.
6. Open a PR from `release/vX.Y.Z` to `main`.

### Publish Workflow

The Publish workflow (`.github/workflows/publish.yml`) runs on manual dispatch or when `package.json` changes on `main`. It runs:

```bash
bun scripts/release.ts publish
```

It will:

1. Run `npm run build`.
2. Create and push the `vX.Y.Z` git tag if it does not already exist.
3. Create a GitHub release with generated release notes.
4. Publish `opencode-models-discovery@X.Y.Z` to npm if that version does not already exist.

## Prerequisites

### Local Releases

Local release preparation can still use the same script, but prefer the GitHub Actions workflow for normal releases.

1. **GitHub CLI** (`gh`) authenticated:
   - `gh auth login`

2. From the intended source branch, run:

```bash
bun scripts/release.ts prepare patch
```

### CI/CD Releases (GitHub Actions)

1. Configure npm trusted publishing for this repository.
2. Ensure the Publish workflow has `id-token: write` permission.
3. Run the workflow:
   - Go to: Actions -> Release -> Run workflow
   - Select version type (patch/minor/major)
   - Keep source branch as `dev`
   - Click "Run workflow"

## Version Types

- **patch**: Bug fixes, small improvements (0.1.0 -> 0.1.1)
- **minor**: New features, backwards compatible (0.1.0 -> 0.2.0)
- **major**: Breaking changes (0.1.0 -> 1.0.0)

## Manual Steps (if needed)

If automation fails, complete the same two phases manually.

### Prepare Release PR

```bash
git switch dev
bun scripts/release.ts prepare patch
```

### Publish After Merge

```bash
git switch main
git pull origin main
bun scripts/release.ts publish
```

## Troubleshooting

### npm publish fails

Common causes:

- Trusted Publishing is not configured for this repository.
- The Publish workflow is missing `id-token: write`.
- The package version already exists on npm.
- The publish step was run outside GitHub Actions without npm credentials.

### GitHub release creation fails

Ensure `GH_TOKEN` is available in GitHub Actions, or authenticate GitHub CLI locally:

```bash
gh auth login
```

### Version already exists

The publish script detects existing npm versions and skips `npm publish`. Bump to a new version if you need another release.

### dev has an old version after publishing

Merge `main` back into `dev` after the release PR is merged and published.

## CI/CD Integration

The normal CI/CD release path is:

1. Go to Actions tab.
2. Select `Release` workflow.
3. Click `Run workflow`.
4. Choose version type.
5. Keep source branch as `dev`.
6. Merge the generated release PR into `main`.
7. Let the `Publish` workflow publish automatically.

Do not run release preparation from `main` during normal development releases.
