# AI-ROUTER Configuration Example

This example uses the OpenCode v1 configuration shape. OpenCode v2 support is currently in beta; use `plugins`, `providers`, `package`, and `settings` instead. See the [V2 configuration guide](../configuration.md#opencode-v2-configuration-beta-support).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by [AI-ROUTER](https://ai-router.dev/).

## Example

```json
{
  "provider": {
    "ai-router": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AI-ROUTER",
      "options": {
        "baseURL": "https://api.ai-router.dev/v1",
        "modelsDiscovery": {
          "enabled": true
        }
      },
      "models": {}
    }
  }
}
```

## Notes

- Configure credentials with OpenCode `/connect` when possible, or through local private configuration.
- This uses the plugin's standard `/v1/models` discovery path, which resolves to `https://api.ai-router.dev/v1/models`.
- The example intentionally does not declare a static model list, filters, pricing, or third-party metadata. Returned models depend on the account and current API response.
- Verify the current API base URL, model availability, pricing, terms of service, data handling, and regional availability before use.
