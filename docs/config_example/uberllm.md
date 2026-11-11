# UberLLM Configuration Example

This example uses the primary OpenCode v2 configuration shape. For legacy OpenCode v1, adapt using the [migration guide](../migrate-v1-to-v2.md).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by [UberLLM](https://uberllm.dev/).

## Example

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-models-discovery@2.1.0"
  ],
  "providers": {
    "uberllm": {
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": {
        "baseURL": "https://api.uberllm.dev/v1",
        // Optional: omit if managing credentials interactively via OpenCode '/connect'
        "apiKey": "example_api_key",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "openrouter"
        }
      }
    }
  }
}
```

## Notes

- Configure credentials with OpenCode `/connect` when possible, or through local private configuration.
- This uses the plugin's standard `/v1/models` discovery path, which resolves to `https://api.uberllm.dev/v1/models`. That endpoint lists chat models only; image, video and music models are not returned there.
- The `/v1/models` response carries OpenRouter-style inline fields (`context_length`, `top_provider.max_completion_tokens`, `architecture` modalities, `supported_parameters`, `pricing`), so `modelInfoFormat: "openrouter"` fills limits, modalities, tool-call support and cost from the same response without another request. Remove it if you do not want the plugin to set per-model costs.
- The example intentionally does not declare a static model list or filters. Returned models depend on the current API response.
- Verify the current API base URL, model availability, pricing, terms of service, data handling, and regional availability before use.
