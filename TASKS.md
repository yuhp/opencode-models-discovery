# OpenCode Model Discovery Plugin - Tasks

## Vision

Transform this plugin into a **universal OpenAI-compatible model discovery system** that:
- Scans ALL providers with OpenAI-compatible endpoints (regardless of npm package)
- Automatically discovers available models via `/v1/models` endpoint
- Injects unconfigured models into provider configurations
- Works seamlessly with LM Studio, Ollama, LocalAI, and any OpenAI-compatible API
- Supports providers using `@ai-sdk/anthropic` with OpenAI-compatible backends (e.g., Ollama Anthropic mode)

**Note**: This plugin focuses exclusively on **automatic model discovery**. It does NOT perform validation (e.g., checking if a model is loaded/available before making requests). Validation is the responsibility of the AI SDK or the underlying provider.

---

## Epic 1: Core Multi-Provider Discovery

### Phase 1: Provider Detection & Classification

#### Task 1.1: OpenAI-Compatible Provider Detection
- **Goal**: Identify all OpenAI-compatible providers in config
- **Detection Logic**:
  1. Strict: `npm === "@ai-sdk/openai-compatible"`
  2. URL-based: `baseURL` contains `/v1/` pattern (supports `@ai-sdk/anthropic` with OpenAI-compatible backends)
  3. Combined: `canDiscoverModels()` returns true if either condition matches
- **Changes**:
  - Add `hasOpenAICompatibleURL()` function
  - Add `canDiscoverModels()` function combining both checks
  - Support multiple providers simultaneously
  - Handle mixed provider configurations (OpenAI, Anthropic, + OpenAI-compatible)
- **Acceptance Criteria**:
  - TypeScript compilation passes
  - Correctly identifies all OpenAI-compatible providers
  - Skips non-compatible providers gracefully
  - Supports `@ai-sdk/anthropic` with OpenAI-compatible URLs

#### Task 1.2: Provider Health Monitoring
- **Goal**: Verify provider accessibility before model discovery
- **Changes**:
  - Add health check for each provider's `/v1/models` endpoint
  - Implement connection timeout handling
  - Provide clear offline/online status reporting
- **Acceptance Criteria**:
  - Handles offline providers without blocking
  - Reports provider status clearly in logs

---

## Epic 2: Dynamic Model Discovery & Injection

### Phase 2: Model Discovery Engine

#### Task 2.1: Multi-Provider Model Fetching
- **Goal**: Query models from all accessible providers
- **Changes**:
  - Iterate through all OpenAI-compatible providers
  - Fetch models via `/v1/models` endpoint for each
  - Handle partial failures (some providers offline)
  - Aggregate discovery results
- **Acceptance Criteria**:
  - Discovers models from multiple providers
  - Continues if one provider fails
  - Reports discovery summary

#### Task 2.2: Smart Model Injection
- **Goal**: Add discovered models to provider configs without overwriting explicit config
- **Changes**:
  - Preserve explicitly configured models
  - Merge only new/unconfigured models
  - Apply smart model formatting (name, modalities, owner)
  - Handle model key normalization
- **Acceptance Criteria**:
  - Doesn't overwrite user-defined model configs
  - Correctly formats model metadata
  - Handles special characters in model IDs

#### Task 2.3: Model Categorization
- **Goal**: Classify discovered models by type
- **Changes**:
  - Detect chat vs embedding models by ID patterns
  - Set appropriate modalities
  - Extract organization owner from model ID
- **Acceptance Criteria**:
  - Correctly categorizes chat/embedding models
  - Sets modalities appropriately

---

## Epic 3: Enhanced Error Handling & UX

### Phase 3: Error Recovery & User Guidance

#### Task 3.1: Comprehensive Error Categorization
- **Goal**: Provide actionable error messages for common issues
- **Changes**:
  - Categorize errors: offline, timeout, not_found, permission, network
  - Generate step-by-step fix suggestions
  - Provide provider-specific guidance
- **Acceptance Criteria**:
  - Errors are categorized correctly
  - Users receive actionable fix suggestions

#### Task 3.2: Retry Logic & Resilience
- **Goal**: Handle transient failures gracefully
- **Changes**:
  - Implement exponential backoff retry
  - Add max retry limits
  - Provide fallback behavior
- **Acceptance Criteria**:
  - Retries transient failures
  - Doesn't block startup on failures

#### Task 3.3: Toast Notifications
- **Goal**: Provide non-intrusive status updates
- **Changes**:
  - Success/failure toasts for model discovery
  - Progress indicators during discovery
  - Error notifications with suggestions
- **Acceptance Criteria**:
  - Shows appropriate toasts
  - Handles missing toast API gracefully

---

## Epic 4: Caching & Performance

### Phase 4: Intelligent Caching

#### Task 4.1: Model Status Cache
- **Goal**: Reduce API calls with intelligent caching
- **Changes**:
  - Implement TTL-based cache (15s default)
  - Cache invalidation on errors
  - Cache warming on startup
  - Prevent memory leaks (max 50 entries)
- **Acceptance Criteria**:
  - Reduces API calls significantly
  - Cache expires appropriately
  - Handles stale data gracefully

#### Task 4.2: Cache Statistics & Debugging
- **Goal**: Provide visibility into cache behavior
- **Changes**:
  - Expose cache stats (size, entries, age)
  - Add cache invalidation methods
  - Log cache operations
- **Acceptance Criteria**:
  - Can inspect cache state
  - Provides hit/miss visibility

---

## Epic 5: Event Monitoring (Future)

### Phase 6: Session & Provider Events

#### Task 6.1: Event Hook Enhancement
- **Goal**: Monitor session events for provider status
- **Changes**:
  - Track session.created/updated events
  - Log provider health during session
  - Provide proactive alerts
- **Acceptance Criteria**:
  - Monitors session health
  - Doesn't block event processing

---

## Epic 7: Configuration & Extensibility

### Phase 7: Plugin Configuration

#### Task 7.1: Plugin Config Schema
- **Goal**: Define configuration schema for plugin
- **Changes**:
  - Define `PluginConfig` interface with providers and discovery sections
  - Support tuple format: `["plugin-name", { config }]`
  - Document configuration options
- **Acceptance Criteria**:
  - Config schema is well-defined
  - Supports OpenCode's tuple format

#### Task 7.2: Provider Filtering
- **Goal**: Allow filtering which providers to discover models for
- **Changes**:
  - Implement `providers.include` (whitelist)
  - Implement `providers.exclude` (blacklist)
  - Priority logic: `include` non-empty → ignore `exclude`
  - Update `enhanceConfig()` to respect filters
- **Acceptance Criteria**:
  - Only discovers models for included providers (when include non-empty)
  - Excludes work only when include is empty
  - Logs which providers were filtered

#### Task 7.3: Discovery Configuration
- **Goal**: Allow configuring discovery behavior
- **Changes**:
  - `discovery.enabled` - toggle discovery on/off
  - `discovery.ttl` - configure cache TTL (default 15000ms)
- **Acceptance Criteria**:
  - Discovery can be disabled entirely
  - Cache TTL is configurable

#### Task 7.4: Plugin Configuration via OpenCode Options
- **Goal**: Receive plugin config from OpenCode
- **Status**: CONFIRMED WORKING
- **Finding**: OpenCode passes plugin configuration via the `options` parameter (second argument to Plugin function)
- **Plugin Signature**: `Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>`
- **Changes**:
  - Updated plugin to use `options` parameter directly
  - Simplified config parsing since OpenCode passes config correctly
- **Acceptance Criteria**:
  - Plugin correctly receives configuration from OpenCode options
  - Tuple format `["plugin-name", { config }]` works correctly

---

## Implementation Notes

### Provider Detection Logic
```typescript
// Provider is OpenAI-compatible if:
provider.npm === "@ai-sdk/openai-compatible"
```

### Supported Providers
- LM Studio (ports: 1234, 8080, 11434)
- Ollama (port: 11434)
- LocalAI (port: 8080)
- Any provider using `@ai-sdk/openai-compatible`
- Any provider with OpenAI-compatible URL (baseURL contains `/v1/`)
  - Including `@ai-sdk/anthropic` with OpenAI-compatible backends (e.g., Ollama Anthropic mode)

### Model Discovery Flow
1. Iterate all providers in config
2. Filter using `canDiscoverModels()` (strict npm OR URL-based)
3. Check health via `/v1/models`
4. Fetch available models
5. Merge into config (preserve existing)
6. Warm cache

### Testing Strategy
- Unit tests for provider detection
- Integration tests for discovery flow
- Mock tests for error scenarios
- Multi-provider scenarios

---

## Out of Scope (for this iteration)

The following items are **not planned** for this plugin:

- **Validation**: This plugin focuses on automatic model discovery only. Validation (checking if a model is loaded/available) is handled by the AI SDK or provider.
- LM Studio-specific management tools (load/unload/switch models)
- Server start/stop controls
- Model search tools
- Performance analytics
- System message transformation hooks
- Session compaction hooks
- Text completion hooks
- Multi-instance support
- Team collaboration features
- Telemetry collection

These could be revisited in future iterations if there's demand.
