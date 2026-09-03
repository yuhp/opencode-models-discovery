# A2Agent Configuration Example

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by
[A2Agent](https://a2agent.me/).

## Example

```json
{
  "provider": {
    "a2agent": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "A2Agent",
      "options": {
        "baseURL": "https://api.a2agent.me/v1",
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

- Configure credentials with OpenCode `/connect` when possible, or through
  local private configuration.
- This uses the plugin's standard `/v1/models` discovery path, which resolves
  to `https://api.a2agent.me/v1/models`.
- The example intentionally does not declare a static model list, filters,
  pricing, or third-party metadata. Returned models depend on the account and
  current API response.
- Verify the current API base URL, model availability, pricing, terms of
  service, data handling, and regional availability before use.
