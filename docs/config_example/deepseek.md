# DeepSeek Configuration Example

This example uses the primary OpenCode v2 configuration shape. For legacy OpenCode v1, adapt using the [migration guide](../migrate-v1-to-v2.md).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by DeepSeek.

## Example

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@2.0.1"
  ],
  "providers": {
    "deepseek": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://api.deepseek.com/",
        // Optional: omit if managing credentials interactively via OpenCode '/connect'
        "apiKey": "example_api_key",
        "modelsDiscovery": {
          "endpoint": "/models", // DeepSeek uses /models instead of /v1/models
          "modelInfoFormat": "models.dev"
        }
      }
    }
  }
}
```

## Notes

- Configure credentials with OpenCode `/connect` when possible.
- The DeepSeek model list endpoint is the origin-relative path `/models` on `https://api.deepseek.com/`.
- Verify the provider's current API base URL, model endpoint, and terms before use.
