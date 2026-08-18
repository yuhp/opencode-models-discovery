# DeepSeek Configuration Example

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by DeepSeek.

## Example

```json
{
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com/",
        "modelsDiscovery": {
          "endpoint": "/models",
          "modelInfoFormat": "models.dev"
        }
      },
      "models": {}
    }
  }
}
```

## Notes

- Configure credentials with OpenCode `/connect` when possible.
- The DeepSeek model list endpoint is the origin-relative path `/models` on `https://api.deepseek.com/`.
- Verify the provider's current API base URL, model endpoint, and terms before use.
