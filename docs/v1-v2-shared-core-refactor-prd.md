# V1/V2 Shared Core Refactor PRD

## Status

This document proposes a staged refactor for sharing host-independent model discovery behavior between the OpenCode v1 and v2 adapters.

Phase 1 (shared types, filtering, and naming), Phase 2 (the neutral enrichment contract with a legacy-enricher compatibility bridge), Phase 3 (the host-independent discovery pipeline), and Phase 4 cleanup and parity verification are implemented.

The goal is to reduce duplicated logic while preserving the separate host integrations, configuration shapes, lifecycle contracts, and compatibility guarantees of both adapters.

## Background

`opencode-models-discovery` currently ships one package with two adapters:

- OpenCode v1 uses the `server()` adapter and the `config` hook to mutate the active configuration.
- OpenCode v2 uses the `Plugin.define({ id, setup })` adapter, provider transforms, provider reloads, and an in-memory inventory.

The adapters must remain separate at the host boundary, but they already perform several related operations:

- parse and validate OpenAI-compatible model-list responses;
- apply provider-level model filters;
- classify models;
- apply metadata enrichment;
- generate smart display names;
- disambiguate duplicate display names;
- map the result into host-specific model representations.

The recent smart model name disambiguation work introduced a shared utility. This PRD defines how to extend that approach into a maintainable shared core without forcing the V1 and V2 adapters into one host-specific implementation.

## Goals

- Reduce duplicated host-independent discovery and model-processing logic.
- Keep V1 and V2 behavior consistent for filtering, naming, and enrichment where their contracts overlap.
- Preserve the existing V1 compatibility line and V2 beta behavior.
- Make the shared logic independently testable through pure functions.
- Keep host-specific configuration, credentials, caching, lifecycle, and output mapping in their respective adapters.
- Make future features implementable once in the shared core and consumed by both adapters.

## Confirmed Shared-Core Rules

The following rules are the agreed behavioral contract for the refactor. They are intentionally explicit so that implementation changes can be reviewed against a stable target rather than inferred from either adapter's current details.

1. A raw model is valid only when it is an object with a non-empty string `id`. Whitespace-only IDs are invalid; other raw fields are preserved as unknown values.
2. Discovery filters apply only to automatically discovered models. Explicitly configured models remain outside the shared discovery filter.
3. `includeBy` and `includeRegex` are OR conditions within their own category. `excludeBy` and `excludeRegex` are also OR conditions.
4. Any exclusion takes precedence over inclusion. In particular, `excludeRegex` is evaluated even when `includeRegex` is configured.
5. Filtering runs before classification and enrichment. Enricher skip decisions run after generic classification.
6. Embedding models are excluded by the generic classification stage by default. `filterNonChat: false` does not disable this baseline embedding exclusion.
7. With `smartModelName` disabled or unset, the display name is exactly the complete raw model ID. Metadata naming and owner suffixes are not applied.
8. With `smartModelName` enabled, naming precedence is: valid non-empty metadata name, generic ID formatting, then the raw ID.
9. Owner labels prefer `raw.owned_by`; when absent, the ID namespace is used. Provider-specific naming aliases are not introduced.
10. Duplicate display names are disambiguated only among models discovered for the same provider. Non-colliding names remain unchanged.
11. Owner suffixes are added only for collisions. If owner labels are missing or not unique, the complete model ID is used as the fallback suffix.
12. Raw `id`, V1 model keys, and V2 `modelID` values are never changed by naming or disambiguation.
13. Enrichment may provide metadata, capabilities, limits, costs, variants, compatibility, and skip decisions, but it must not change model identity fields.
14. Explicit models are not filtered by discovery rules and take precedence over discovered models with the same ID in V1.
15. Endpoint resolution, authentication, provider detection, persistence, cache schema, reloads, logging, lifecycle, and final host mapping remain adapter responsibilities.
16. The initial refactor does not change cache schema or cache-hit behavior. Cached V1 models receive the same naming/disambiguation rules, but cache redesign is out of scope.

The first implementation decision that changes a current edge case is the explicit exclusion precedence rule: an `excludeRegex` match always removes a model, even when an `includeRegex` is also present.

## Non-Goals

- Do not merge the V1 and V2 plugin entrypoints into one lifecycle implementation.
- Do not replace the OpenCode v1 `config` hook with V2 provider transforms.
- Do not make V2 adopt the V1 persisted disk cache as part of this refactor.
- Do not change V1 or V2 configuration paths or rename public configuration fields.
- Do not change provider authentication, connection resolution, or slash-command behavior.
- Do not introduce provider-specific built-in naming aliases as part of the shared core.
- Do not change model IDs, provider IDs, request routing, or explicit model precedence.

## Architectural Boundary

The target architecture is:

```text
OpenCode V1 adapter ─┐
                     ├─ shared host-independent model core
OpenCode V2 adapter ─┘
```

The shared core may contain:

- raw model types and normalization;
- model validation;
- model field and regular-expression filtering;
- model classification;
- metadata enrichment input/output conventions;
- smart display name generation;
- duplicate display-name disambiguation;
- neutral discovered-model drafts.

The adapters retain:

- configuration loading and defaults;
- provider compatibility detection;
- endpoint and credential resolution;
- V1 disk cache and per-model overrides;
- V2 provider lifecycle and in-memory inventory;
- OpenCode-specific final model mapping;
- host-specific logging, tools, reloads, and cleanup.

## Target Shared Modules

The exact filenames may change during implementation, but the shared core should converge on modules equivalent to the following:

```text
src/core/model-types.ts
src/core/model-filter.ts
src/core/model-naming.ts
src/core/model-draft.ts
src/core/discovery-pipeline.ts
```

Existing utilities under `src/utils/model-info/` and the current `src/utils/disambiguate-model-names.ts` should be reused or moved only when doing so improves ownership and dependency direction.

### Shared Model Type

The shared raw model type must be permissive enough for OpenAI-compatible providers while requiring a valid model ID:

```ts
interface DiscoveredRawModel {
  readonly id: string
  readonly owned_by?: string
  readonly object?: string
  readonly created?: number
  readonly [key: string]: unknown
}
```

V1 may preserve stricter input validation at its public boundary. V2 may use the same normalized type after validating `id`.

### Shared Filtering

The shared filter module should implement the common semantics for:

- `includeBy`;
- `excludeBy`;
- `includeRegex`;
- `excludeRegex`;
- `excludeBy` taking precedence over inclusion;
- filtering only auto-discovered models.

It should expose pure functions and should not know about OpenCode configuration objects.

### Shared Naming

The shared naming module should own:

- raw ID fallback when `smartModelName` is disabled;
- metadata-provided display names when available;
- generic ID formatting;
- owner extraction;
- duplicate name detection within one provider;
- owner suffixes only for colliding names.

The naming layer must not hard-code individual providers or owners. It should derive owner labels from model data or the model ID and retain the complete model ID separately.

Expected behavior:

```text
github-copilot/gpt-5.6-sol → GPT 5.6 Sol (Github Copilot)
openai/gpt-5.6-sol         → GPT 5.6 Sol (Openai)
qwen/qwen3-30b             → Qwen3 30B
```

Names should only be disambiguated among models discovered for the same provider. Models from different providers do not participate in the same collision group.

### Neutral Model Draft

The shared pipeline should produce a neutral draft rather than an OpenCode V1 or V2 model object:

```ts
interface DiscoveredModelDraft {
  readonly id: string
  name: string
  organizationOwner?: string
  raw: DiscoveredRawModel
  capabilities?: Record<string, unknown>
  limit?: ModelLimitDraft
  cost?: unknown
  variants?: unknown
  compatibility?: Record<string, unknown>
}
```

V1 converts drafts into `provider.<id>.models[modelID]`. V2 converts drafts into `Model.Info` objects and its provider catalog.

## Discovery Pipeline

The shared pipeline should follow this order:

```text
raw provider response
  ↓
validate and normalize model records
  ↓
apply field and regex filters
  ↓
classify models
  ↓
apply metadata enrichment
  ↓
resolve smart display names
  ↓
disambiguate duplicate display names
  ↓
return neutral model drafts
```

The pipeline must remain host-independent. Network access, credentials, cache reads/writes, logging, and host reloads must stay outside it.

## Adapter Responsibilities

### OpenCode V1

The V1 adapter continues to own:

- `provider.<id>.options.modelsDiscovery` parsing;
- V1 provider detection and forced discovery behavior;
- API key and auth-store resolution;
- persisted model cache and TTL handling;
- cached model overrides;
- explicit model merge precedence;
- V1 configuration mutation;
- legacy configuration warnings and helper commands.

The adapter should call the shared pipeline after it has fetched or loaded the provider model set. Cached models must also pass through the shared naming/disambiguation step so cached and freshly fetched results behave consistently.

### OpenCode V2

The V2 adapter continues to own:

- `providers.<id>.settings.modelsDiscovery` parsing;
- V2 provider package detection;
- managed credential resolution through integrations;
- provider transforms and replay-safe callbacks;
- in-memory inventory replacement;
- `ctx.provider.reload()`;
- V2 discovery tools and lifecycle cleanup.

The adapter should call the shared pipeline after fetching the provider model set and then map drafts into V2 model information.

## Compatibility Requirements

The refactor must preserve:

1. V1 provider-level `modelsDiscovery.enabled` forced discovery behavior.
2. V2 explicit `modelsDiscovery.enabled: true` participation behavior.
3. V1 and V2 endpoint defaults and origin-relative endpoint semantics.
4. V1 persisted cache, TTL, overrides, and explicit model precedence.
5. V2 dynamic provider reload and in-memory inventory refresh.
6. Existing OpenAI-compatible and Anthropic-compatible V2 provider recognition.
7. `smartModelName: false` preserving raw model IDs as display names.
8. Complete `id` and `modelID` values remaining unchanged after naming.
9. Explicitly configured models remaining available even when discovery filters exclude them.
10. Metadata enrichment behavior and `filterNonChat` semantics.
11. V1 and V2 package exports and host selection behavior.

## Phased Implementation Plan

### Phase 1: Shared Pure Utilities

- Define shared raw model and model draft types.
- Move or adapt filtering logic into a shared pure module.
- Move naming and owner-label logic into a shared naming module.
- Keep existing adapter outputs unchanged.
- Add unit tests for filters, naming, collisions, owner formatting, and disabled smart names.

### Phase 2: Shared Enrichment Contract

- Define a stable neutral enrichment shape for capabilities, limits, costs, modalities, variants, and compatibility fields.
- Reuse the existing model-info enrichers through that shape.
- Ensure V1 and V2 use the same name precedence and non-chat filtering behavior.
- Keep provider-specific metadata parsing isolated behind the existing enrichment interfaces.

### Phase 3: Shared Discovery Pipeline

- Extract validation, filtering, classification, enrichment, and naming into a host-independent pipeline.
- Make the pipeline return neutral model drafts.
- Replace duplicated V1/V2 processing loops with adapter calls into the pipeline.
- Keep network fetching and lifecycle operations in each adapter.

### Phase 4: Consolidation and Cleanup

- Remove obsolete duplicate helpers after behavior parity is verified.
- Update architecture and configuration documentation.
- Add cross-adapter parity tests for equivalent raw provider responses.
- Record the refactor in release notes.

## Known Gaps After Phase 4

The Phase 1–4 refactor is implemented, but the following gaps were identified during the post-refactor review. They do not invalidate the shared-core architecture, but they prevent the implementation from fully satisfying the cache-equivalence and end-to-end parity goals described below.

### 1. V1 cache hits can bypass the shared discovery pipeline (Resolved in Phase 5)

When a fresh persisted V1 inventory is available, the V1 adapter currently reuses the cached rendered models directly. In that path, the models do not go through the current shared normalization, filtering, classification, enrichment, naming, and disambiguation pipeline.

This can make cached and freshly discovered results differ when any of the following changes:

- `smartModelName` is changed;
- model filters are changed;
- naming or owner-label logic is updated;
- enrichment configuration changes;
- a cached model no longer satisfies the current discovery rules.

New cache entries now preserve the filtered raw discovery models alongside the rendered V1 models. On a fresh cache hit, the adapter re-applies the shared normalization, filtering, classification, enrichment, naming, disambiguation, and V1 mapping pipeline using the cached raw models. Existing cache entries without `rawModels` remain readable through the legacy rendered-model compatibility path. Overrides continue to be applied after the pipeline projection.

### 2. V1 still has a legacy model-validity predicate (Resolved in Phase 5)

The legacy `isValidModel` helper has been deprecated and updated to delegate directly to `isDiscoveredRawModel` / `normalizeDiscoveredRawModel`. The shared validation contract is now the single source of truth across V1, V2, and internal stores, strictly rejecting null, non-objects, and whitespace-only IDs.

### 3. V2 mapping can overwrite explicit neutral limit values (Resolved in Phase 5)

Previously, some enrichers wrote sentinel `limit.output = 0` values for context-only models, whereas the V2 mapper coerced non-positive output limits to 32,000, creating semantic drift between V1 and V2 models.

This was resolved by establishing unified limit semantics via `createModelLimits`:
- Positive explicit output limits are preserved (and bounded by context window);
- When output is absent or non-positive, output safely falls back to `Math.min(context, DEFAULT_OUTPUT_TOKEN_LIMIT)` (where `DEFAULT_OUTPUT_TOKEN_LIMIT = 32_000`);
- The sentinel `output = 0` is eliminated across all shared enrichers, ensuring complete parity between V1 drafts, V1 injected configurations, and V2 model editor projections.

### 4. Owner resolution is duplicated across draft creation and naming (Resolved in Phase 5)

Owner resolution has been unified into `resolveModelOwner` in `src/core/model-naming.ts`. It consistently enforces Rule 9 precedence (`raw.owned_by` preferred over model ID namespace prefix) across draft metadata extraction, collision disambiguation, and host model projection.

### 5. V1 and V2 still duplicate model-info enricher resolution (Resolved in Phase 5)

Enricher resolution has been extracted into `resolveModelInfoEnricher` in `src/core/enricher-resolver.ts`. Both V1 and V2 adapters share the exact same resolution rules for static index formats (`models.dev`, `aiproxy`), inline/zero-request formats (`bifrost`, `vllm`, `llama-swap`, `omniroute`), and remote provider endpoints (`litellm`, `lmstudio`). Credentials and transport bindings remain host-owned while format handling is 100% unified.

### 6. Existing parity tests do not cover both complete adapter projections (Resolved in Phase 5)

End-to-end cross-adapter parity test suite has been established in `test/core/adapter-parity.test.ts`. Given the exact same raw provider responses and options, the tests verify that V1 (`mapToV1Model`) and V2 (`mapToDiscoveredV2Model`) produce identical model IDs, display names, context/output limits, modalities, reasoning flags, and tool-calling capabilities.

### 7. V1 projection logic is embedded in the configuration enhancer (Resolved in Phase 5)

Model projection logic for both V1 and V2 has been consolidated into `src/core/model-mapper.ts` (`mapToV1Model` and `mapToDiscoveredV2Model`). The V1 mapper is independently tested and guarantees consistent translation from neutral discovery drafts.

### 8. Heuristic model ID reasoning guessing removed (Resolved in Phase 5)

Previously, `mapToDiscoveredV2Model` contained a regex-based heuristic (`/(?:^|[-_/])(r1|reasoner|thinking|reasoning)(?:[-_/]|$)/i`) that guessed reasoning capabilities solely from the model ID. This heuristic introduced semantic divergence between V1 and V2 and risked false positives.

The heuristic has been removed. Reasoning capability is now strictly determined by authoritative sources:
- Explicit enricher resolution on the neutral draft (`draft.reasoning`);
- Explicit raw model flags (`raw.supports_reasoning === true` or `raw.capabilities.reasoning === true`).

When reasoning capability is explicitly present, the V2 mapper safely applies `compatibility.reasoningField = 'reasoning_content'` and default reasoning effort variants (`low`, `medium`, `high`) without guessing.

## Phase 5: Cache and Projection Parity (completed)

Phase 5 addressed the identified gaps without changing public configuration paths, provider IDs, model IDs, or host lifecycle contracts:

- The shared discovery pipeline is reapplied to cached V1 raw model data.
- Shared normalization and validation are the V1 model-validity contract.
- The neutral limit contract covers absent, zero, and positive values.
- The V2 mapper preserves explicit neutral draft values and applies shared defaults only during normalization.
- Owner extraction and display-label normalization are centralized in the shared core.
- V1 and V2 draft-to-model mapping is implemented in dedicated core mappers.
- Model-info enricher resolution is shared while credentials, logging, network policy, and lifecycle remain adapter-owned.
- V1/V2 projection parity and cache regression tests are in place.
- Model ID reasoning heuristics have been removed in favor of authoritative metadata.

Phase 5 preserves the existing V1 cache schema. V2 uses a separate host-managed cache; V1/V2 cache migration and V2 cache-associated model overrides remain outside this refactor.

## Testing Strategy

### Unit Tests

Shared unit tests must cover:

- valid and invalid raw models;
- include and exclude field filters;
- include and exclude regular expressions;
- filter precedence;
- smart names enabled and disabled;
- metadata name precedence;
- duplicate names with distinct owners;
- duplicate names with missing or identical owners;
- names without collisions;
- preservation of model IDs.

### V1 Tests

V1 tests must continue to cover:

- config hook output;
- cache hit and cache miss paths;
- cache-based name disambiguation;
- explicit model preservation;
- V1 provider detection and forced enablement.

### V2 Tests

V2 tests must continue to cover:

- provider inventory output;
- provider reload behavior;
- dynamic refresh;
- OpenAI-compatible and Anthropic-compatible packages;
- model ID and display name separation;
- replay-safe provider transforms.

### Integration and Regression Tests

The existing full validation commands remain required:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run compile
```

## Acceptance Criteria

- V1 and V2 use the shared filter and naming behavior for equivalent inputs.
- No public configuration field changes are required.
- No provider ID or model ID changes occur.
- Duplicate smart names are distinguishable within each provider.
- Non-colliding smart names remain unchanged.
- Cached V1 models and freshly discovered V1 models produce equivalent display names.
- V2 refreshes continue to update the provider catalog correctly.
- Existing V1 and V2 tests remain green, with added shared-core and parity coverage.
- The shared core has no dependency on OpenCode host APIs.
- The adapters retain clear ownership of credentials, caching, lifecycle, and final output mapping.

## Risks and Mitigations

### Behavioral Drift

V1 and V2 may currently differ in subtle defaults or enrichment behavior. Capture current behavior in characterization tests before moving logic.

### Cache Compatibility

Changing the shape of cached models can affect existing V1 installations. Preserve the current cache schema or add an explicit migration/version strategy before changing persisted fields.

### Host API Coupling

Accidentally importing OpenCode types into the shared core would make it difficult to test and reuse. Enforce a dependency rule that shared modules do not import V1/V2 host adapters.

### Over-Refactoring

The refactor should be delivered in independently reviewable phases. Do not combine cache redesign, provider lifecycle changes, or public configuration changes with the initial shared-core extraction.

## Open Questions

- Should the neutral draft include all current V1/V2 metadata fields, or should enrichment remain adapter-specific until Phase 2?
- Should owner labels preserve provider casing from the raw model ID, or use a shared display normalization rule?
- Should the shared pipeline support provider-specific model classification hooks, or retain the current generic classification behavior?
- Should V1 and V2 caches remain separate permanently, or should a future offline-startup requirement justify an explicit migration/import mechanism?
