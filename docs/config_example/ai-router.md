# AI-ROUTER Configuration Example

This example uses the primary OpenCode v2 configuration shape. For legacy OpenCode v1, adapt using the [migration guide](../migrate-v1-to-v2.md).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by [AI-ROUTER](https://ai-router.dev/).

## Example

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@2.1.0"
  ],
  "providers": {
    "ai-router": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://api.ai-router.dev/v1",
        // Optional: omit if managing credentials interactively via OpenCode '/connect'
        "apiKey": "example_api_key",
        "modelsDiscovery": {
          "enabled": true
        }
      }
    }
  }
}
```

## Notes

- Configure credentials with OpenCode `/connect` when possible, or through local private configuration.
- This uses the plugin's standard `/v1/models` discovery path, which resolves to `https://api.ai-router.dev/v1/models`.
- The example intentionally does not declare a static model list, filters, pricing, or third-party metadata. Returned models depend on the account and current API response.
- Verify the current API base URL, model availability, pricing, terms of service, data handling, and regional availability before use.
