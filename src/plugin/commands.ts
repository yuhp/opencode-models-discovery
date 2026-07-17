import type { PluginLogger } from './logger'

export const MIGRATION_COMMAND_NAME = 'models-discovery:migrate'
export const CONFIG_COMMAND_NAME = 'models-discovery:config'

export const MIGRATION_COMMAND_TEMPLATE = `Use the customize-opencode skill.

Migrate opencode-models-discovery legacy global configuration to provider-level configuration.

Inspect both:
- the project OpenCode config: opencode.json, opencode.jsonc, or .opencode/opencode.json under the current project/worktree
- the user global OpenCode config: ~/.config/opencode/opencode.json

If OPENCODE_CONFIG is set and points to a file, inspect that custom config file too.

Do not edit managed or organization-controlled config unless the user explicitly asks for it. Managed config locations are platform-specific, including /Library/Application Support/opencode/ on macOS, /etc/opencode/ on Linux, and %ProgramData%\\opencode on Windows.

Find the OpenCode config file that declares the opencode-models-discovery plugin and also contains legacy plugin-level options for that plugin.

Legacy opencode-models-discovery options are:
- discovery.enabled
- providers.include
- providers.exclude
- models.includeRegex
- models.excludeRegex
- smartModelName

Move these settings into provider.<id>.options.modelsDiscovery where possible.

Field mapping:
- discovery.enabled -> provider.<id>.options.modelsDiscovery.enabled only when needed to preserve behavior
- models.includeRegex -> preferably provider.<id>.options.modelsDiscovery.models.includeBy with { "field": "id", "match": "..." }
- models.excludeRegex -> preferably provider.<id>.options.modelsDiscovery.models.excludeBy with { "field": "id", "match": "..." }
- smartModelName -> provider.<id>.options.modelsDiscovery.smartModelName
- providers.exclude -> provider.<id>.options.modelsDiscovery.enabled=false for excluded editable providers

Provider-level models.includeRegex and models.excludeRegex remain supported as id-only shortcuts, but prefer includeBy and excludeBy for migrated config because they support both id filters and provider-specific raw fields.

Preserve unrelated config fields and formatting as much as possible.
Do not modify files that do not declare this plugin.
Do not guess provider IDs that are not present in editable config.
Do not overwrite existing provider.<id>.options.modelsDiscovery fields unless the user explicitly asks you to.
If migration cannot be done safely, explain what blocked it and show the exact manual changes needed.

Explain the mechanism to the user before or after editing:
- OpenCode's provider config defines the provider id, npm package, baseURL, API key source, and built-in provider enablement.
- This plugin only discovers and injects models for providers; it does not enable a provider that OpenCode itself has disabled.
- OpenCode built-in enabled_providers and disabled_providers control provider availability, while modelsDiscovery controls only model discovery for an available provider.
- API keys can remain in provider.<id>.options.apiKey or in OpenCode /connect credentials; do not duplicate secrets unless the user asks.
- After v1.0.0, provider-level modelsDiscovery is the configuration boundary for this plugin.

For v1.0.0 behavior:
- plugin-level global discovery config is no longer applied
- discovery remains enabled by default
- provider.<id>.options.modelsDiscovery.enabled=false disables discovery for that provider
- OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED=false can be used to make unspecified providers default to disabled

If providers.include is used, preserve the old opt-in behavior by either recommending OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED=false with explicit enabled providers, or disabling known non-included editable providers with modelsDiscovery.enabled=false. Prefer explaining the environment variable approach instead of writing many disable entries unless the user asks for a pure config-only migration.

After editing config, remind the user to quit and restart opencode.`

export const CONFIG_COMMAND_TEMPLATE = `Use the customize-opencode skill.

Help configure opencode-models-discovery using the recommended provider-level configuration style.

Inspect both:
- the project OpenCode config: opencode.json, opencode.jsonc, or .opencode/opencode.json under the current project/worktree
- the user global OpenCode config: ~/.config/opencode/opencode.json

If OPENCODE_CONFIG is set and points to a file, inspect that custom config file too.

Do not edit managed or organization-controlled config unless the user explicitly asks for it. Managed config locations are platform-specific, including /Library/Application Support/opencode/ on macOS, /etc/opencode/ on Linux, and %ProgramData%\\opencode on Windows.

Find the OpenCode config file that declares the opencode-models-discovery plugin, or ask the user whether the plugin should be added to project or user global config if it is not configured yet.

Use provider-level configuration under provider.<id>.options.modelsDiscovery. Prefer this shape:

{
  "provider": {
    "<provider-id>": {
      "options": {
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/v1/models",
          "models": {
            "includeBy": [{ "field": "id", "match": "^chat-" }],
            "excludeBy": [{ "field": "available", "equals": false }]
          },
          "smartModelName": true,
          "modelInfoEndpoint": "/v1/model/info",
          "modelInfoFormat": "litellm",
          "filterNonChat": true
        }
      }
    }
  }
}

Only include fields the user needs. Do not add placeholder regex values.

Explain the mechanism to the user:
- OpenCode's provider config defines the provider id, npm package, baseURL, API key source, and built-in provider enablement.
- This plugin runs during OpenCode startup, queries a provider's models endpoint, and merges discovered models into the active config for the current session.
- OpenCode built-in enabled_providers and disabled_providers control whether providers are available at all.
- provider.<id>.options.modelsDiscovery controls only discovery behavior for that provider.
- API keys can be configured as provider.<id>.options.apiKey, but OpenCode /connect credentials can also be used for the same provider id. Do not duplicate secrets unless the user asks.
- Config changes require restarting OpenCode because config is loaded at startup.

Supported plugin options under provider.<id>.options.modelsDiscovery:
- enabled: force enable or disable discovery for this provider
- endpoint: provider-specific models endpoint path; defaults to /v1/models
- models.includeRegex: shortcut for model id regex allow-list; prefer models.includeBy with field="id" and match for new config
- models.excludeRegex: shortcut for model id regex deny-list; prefer models.excludeBy with field="id" and match for new config
- models.includeBy: allow-list for top-level raw fields returned in the provider's /v1/models response; each rule uses exactly one of equals or match
- models.excludeBy: deny-list for top-level raw fields returned in the provider's /v1/models response; each rule uses exactly one of equals or match
- smartModelName: use friendlier display names for discovered models
- modelInfoFormat="models.dev": enrich from the public models.dev index without modelInfoEndpoint
- modelInfoEndpoint plus modelInfoFormat="litellm": enrich from a LiteLLM-compatible model info endpoint
- modelInfoFormat="vllm": enrich from vLLM-compatible providers by reading max_model_len from the raw model listing response
- filterNonChat: when LiteLLM model info is available, skip non-chat models by default

Recommended defaults:
- omit modelsDiscovery.enabled when the user is fine with discovery defaulting on
- set modelsDiscovery.enabled=false to disable discovery for a specific provider
- omit endpoint when the provider uses the standard /v1/models endpoint
- prefer models.includeBy and models.excludeBy for model filtering
- use models.includeBy or models.excludeBy with field="id" and match for id/name regex filtering
- use models.includeBy or models.excludeBy with equals for strict equality on provider-specific top-level raw model fields
- use models.includeBy or models.excludeBy with match for regex matching on string top-level raw model fields
- treat models.includeRegex and models.excludeRegex as id-only shortcuts for includeBy/excludeBy; do not recommend them for new config unless the user asks for the shorter id-only syntax
- missing fields do not match includeBy or excludeBy rules
- includeBy and excludeBy are cumulative: a model must pass includeBy first, then excludeBy
- excludeBy wins over includeBy when both match the same model
- includeRegex and excludeRegex preserve legacy shortcut behavior: includeRegex takes precedence, so excludeRegex is only applied when includeRegex is not configured
- avoid configuring both includeBy field="id" match rules and includeRegex unless the user wants an intersection with legacy id-only shortcut behavior
- use smartModelName=true only when the user wants friendlier display names
- use modelInfoFormat="models.dev" for models.dev metadata enrichment
- use modelInfoEndpoint and modelInfoFormat="litellm" for LiteLLM-compatible model info endpoints
- use modelInfoFormat="vllm" for vLLM-compatible providers; no modelInfoEndpoint needed

Provider compatibility guidance:
- Discovery works for @ai-sdk/openai-compatible providers by default.
- Providers with a /v1 baseURL can often be discovered even when using another npm package.
- Providers with non-standard models paths should set modelsDiscovery.endpoint.
- modelsDiscovery.enabled=true can force discovery for a provider that does not match automatic compatibility detection.

Configuration compatibility boundary:
- v1.0.0 ignores plugin-level global discovery config at runtime.
- Recommended new config should use provider.<id>.options.modelsDiscovery.
- Discovery remains enabled by default unless a provider sets modelsDiscovery.enabled=false or OPENCODE_MODELS_DISCOVERY_DEFAULT_ENABLED=false is set for unspecified providers.

Preserve unrelated config fields and formatting as much as possible.
Do not overwrite existing provider.<id>.options.modelsDiscovery fields unless the user explicitly asks you to.
After editing config, remind the user to quit and restart opencode.`

function ensureCommandConfig(config: any): Record<string, any> | undefined {
  if (!config || typeof config !== 'object') {
    return undefined
  }

  if (!config.command || typeof config.command !== 'object' || Array.isArray(config.command)) {
    config.command = {}
  }

  return config.command
}

function injectCommand(
  config: any,
  logger: PluginLogger,
  commandName: string,
  command: { description: string; agent: string; template: string },
  existingMessage: string
): void {
  const commands = ensureCommandConfig(config)
  if (!commands) {
    return
  }

  if (commands[commandName]) {
    logger.warn(existingMessage, {
      command: commandName,
    })
    return
  }

  commands[commandName] = command
}

export function injectMigrationCommand(config: any, logger: PluginLogger): void {
  injectCommand(
    config,
    logger,
    MIGRATION_COMMAND_NAME,
    {
      description: 'Migrate opencode-models-discovery config',
      agent: 'build',
      template: MIGRATION_COMMAND_TEMPLATE,
    },
    'Migration command already exists; leaving user-defined command unchanged'
  )
}

export function injectConfigCommand(config: any, logger: PluginLogger): void {
  injectCommand(
    config,
    logger,
    CONFIG_COMMAND_NAME,
    {
      description: 'Configure opencode-models-discovery',
      agent: 'build',
      template: CONFIG_COMMAND_TEMPLATE,
    },
    'Config command already exists; leaving user-defined command unchanged'
  )
}
