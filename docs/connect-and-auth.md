# `/connect` and Auth-Backed Discovery

For custom OpenAI-compatible providers, you define the provider in `opencode.json` so OpenCode and this plugin know the provider identity, package, and `baseURL`.

However, you do not need to hardcode `apiKey` in `opencode.json` when the provider credential is managed through OpenCode's native `/connect` command.

The plugin provides auth-backed model discovery and runtime execution across both **OpenCode v2** and **OpenCode v1**, utilizing the native credential architecture appropriate for each host generation.

---

## OpenCode v2 Integration Credentials

OpenCode v2 features a first-class Integration subsystem (`ctx.integration`) and an event-driven lifecycle. The V2 adapter seamlessly links provider model discovery and runtime LLM execution with OpenCode v2's `/connect` workflows.

### Example V2 Configuration

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@latest"
  ],
  "providers": {
    "deepseek": {
      "name": "DeepSeek",
      "package": "@opencode-ai/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://api.deepseek.com",
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/models"
        }
      }
    }
  }
}
```

Notice that `settings.apiKey` is completely omitted.

### Usage Workflow

1. Run `/connect` in the OpenCode v2 TUI.
2. Select your provider (`DeepSeek` / `deepseek`).
3. Enter your API key.
4. Model discovery triggers immediately, populating available models in your session without requiring a restart.
5. Selecting a discovered model and sending a prompt authenticates successfully.

### How OpenCode v2 Credential Integration Works

1. **Native Integration Registration & Deduplication**:
   - The plugin registers an API-key authentication method for every configured provider via `ctx.integration.transform`.
   - The integration ID strictly aligns with the provider ID (`provider.id`), preventing duplicate entries from appearing in the `/connect` menu.
   - An optional `settings.integrationID` can override the integration target if you want to share credentials across multiple provider definitions.

2. **Real-time Event Reactivity**:
   - The plugin subscribes to host lifecycle events: `credential.updated`, `credential.switched`, `integration.updated`, and `config.updated`.
   - When you connect, update, or disconnect credentials in `/connect`, the plugin immediately triggers an inventory refresh and re-evaluates provider authorization without requiring a process restart.

3. **Dual-Layer Provider Authentication Binding**:
   - When OpenCode v2's host runner executes a chat completion for a discovered model, it requires upstream credentials.
   - The plugin's provider controller (`src/v2/catalog.ts`) binds `draft.integrationID` on the editor and injects memory-only `Authorization: Bearer <key>` headers into `draft.headers`.
   - This ensures downstream provider packages (such as `@opencode-ai/ai/providers/openai-compatible`) always transmit the required authorization headers.

4. **Credential Revocation & Cleanup**:
   - When credentials are deleted or disconnected in `/connect`, the event stream fires and the resolver observes the missing credential.
   - The controller explicitly cleans up and deletes `draft.headers.authorization` in runtime memory, preventing revoked credentials from remaining active.

5. **Credential Resolution Precedence (V2)**:
   1. Explicit `providers.<id>.settings.apiKey` (highest priority).
   2. Active Integration credential resolved via `ctx.integration.connection.active` and `resolve` matching `settings.integrationID` (if set) or `provider.id`.
   3. Unauthenticated (for local engines such as LM Studio, Ollama, or vLLM).

---

## OpenCode v1 Auth-Store Integration

OpenCode v1 does not have the V2 plugin integration API. Instead, the V1 adapter integrates with OpenCode's host-managed auth store and XDG files.

### Example V1 Configuration

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-models-discovery@latest"
  ],
  "provider": {
    "test_provider": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Test Provider",
      "options": {
        "baseURL": "http://127.0.0.1:4000/v1",
        "modelsDiscovery": {
          "enabled": true
        }
      }
    }
  }
}
```

Then run `/connect`, select the provider ID, and save the API key there.

### Credential Resolution Precedence (V1)

1. `provider.<name>.options.apiKey` (explicit setting).
2. OpenCode resolved provider key, when available during plugin startup.
3. Host auth store (`auth.json`) for same-id `type: "api"` credentials.

### Notes for V1 Fallback

- OpenCode's provider resolution API can time out inside the V1 `config` hook, so the plugin includes a fallback for `/connect` API-key credentials.
- The fallback first respects `OPENCODE_AUTH_CONTENT`, then reads a host-specific auth store location derived from `xdg-basedir`.
- When `OPENCODE=1` is present, the plugin reads `~/.local/share/opencode/auth.json`.
- When `MIMOCODE=1` is present, the plugin reads `~/.local/share/mimocode/auth.json`.
- When neither host marker is present, the plugin defaults to `~/.local/share/opencode/auth.json`.

---

## Security & Privacy Guarantees

Regardless of host generation (V1 or V2):

- **No Config Tampering**: The plugin never writes recovered API keys or secrets back into `opencode.json`.
- **No Cache Leakage**: Resolved secrets are never saved to V1 XDG cache files or V2 `ctx.storage` cache records. Cache stores strictly retain metadata, raw model IDs, and enrichments.
- **No Diagnostic Leakage**: Raw credentials and Authorization headers are masked and redacted from agent tools (`models_discovery_status`), RPC outputs, and logging.
