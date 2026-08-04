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
          "timeoutMs": 5000,
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
- The DeepSeek model list endpoint is `/models` relative to `https://api.deepseek.com/`.
- Adjust `timeoutMs` if you experience timeout errors with slower connections.
- Verify the provider's current API base URL, model endpoint, and terms before use.
