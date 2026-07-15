# Atlas Cloud Configuration Example

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Atlas Cloud.

## Example

```json
{
  "provider": {
    "atlascloud": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Atlas Cloud",
      "options": {
        "baseURL": "https://api.atlascloud.ai/v1",
        "modelsDiscovery": {
          "enabled": true,
          "endpoint": "/models"
        }
      },
      "models": {}
    }
  }
}
```

## Notes

- Configure credentials with OpenCode `/connect` when possible.
- Use `ATLASCLOUD_API_KEY` only in local private configuration; do not commit API keys.
- Atlas Cloud exposes an OpenAI-compatible model list endpoint at `/v1/models` relative to `https://api.atlascloud.ai/v1`.
- The public Atlas Cloud model catalog was checked while preparing this example and included `qwen/qwen3.5-flash` and `deepseek-ai/deepseek-v4-pro`.
- Verify the provider's current API base URL, model endpoint, pricing, data handling, regional availability, and terms before use.
