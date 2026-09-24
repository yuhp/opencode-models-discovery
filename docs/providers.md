# Provider Compatibility

This page primarily documents the OpenCode v1 provider shape. OpenCode v2 support is currently in beta and uses `plugins` plus `providers.<id>.settings`; see the [OpenCode v2 configuration](configuration.md#opencode-v2-configuration-beta-support) section before using these examples with OpenCode v2.

## Supported Providers

The plugin supports any OpenAI-compatible provider. Common examples:

| Provider | Default Port | Use Case | npm Package |
|----------|-------------|----------|-------------|
| Ollama | 11434 | Local model inference engine | `@ai-sdk/openai-compatible` |
| LM Studio | 1234 | Local LLM with UI | `@ai-sdk/openai-compatible` |
| LocalAI | 8080 | Self-hosted AI inference | `@ai-sdk/openai-compatible` |
| llama.cpp Server | 8080 | Standalone llama.cpp server | `@ai-sdk/openai-compatible` |
| Text Generation WebUI | 5000 | OpenAI-compatible extension | `@ai-sdk/openai-compatible` |
| FastChat (Vicuna) | 8001 | Multi-model serving | `@ai-sdk/openai-compatible` |
| vLLM | 8000 | High-performance inference | `@ai-sdk/openai-compatible` |
| DeepSeek | Cloud | OpenAI-compatible API with `/models` discovery endpoint | `@ai-sdk/openai-compatible` |
| CLIProxyAPI | 8317 | LLM proxy server | `@ai-sdk/anthropic` with `/v1` backend and `@ai-sdk/openai-compatible` |

## Anthropic API with Custom Backend (OpenCode v1)

Providers using `@ai-sdk/anthropic` but backed by OpenAI-compatible servers are also supported:

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/anthropic",
      "name": "Ollama (Anthropic Mode)",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1"
      }
    }
  }
}
```

## Cloud OpenAI-Compatible Services

Cloud services with OpenAI-compatible APIs are also supported, including:

- Cloudflare Workers AI
- Azure OpenAI Service with appropriate endpoint configuration
- Groq
- Together AI
- Perplexity AI
- Any custom OpenAI-compatible API

## Provider Detection

The plugin identifies OpenAI-compatible providers using these signals:

1. Strict detection: `npm === "@ai-sdk/openai-compatible"`
2. URL-based detection: `baseURL` contains a `/v1/` pattern
3. Endpoint override detection: `options.modelsDiscovery.endpoint` is configured

In addition, `options.modelsDiscovery.enabled === true` can force discovery even when the provider does not match the detection rules above.

A provider is considered discoverable if it matches any detection signal above, or if discovery is explicitly forced on.

## Supported Configuration Examples

The examples below use the OpenCode v1 keys `plugin`, `provider`, `npm`, and `options`. For OpenCode v2, translate them to `plugins`, `providers`, `package`, and `settings`, and put `modelsDiscovery` under `settings`.

### Standard OpenAI-Compatible Provider

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1"
      }
    }
  }
}
```

### Anthropic SDK with OpenAI-Compatible Backend

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "ollama-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "Ollama (Anthropic Mode)",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1"
      }
    }
  }
}
```

### Explicit Provider-Level Discovery

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1",
        "modelsDiscovery": {
          "enabled": true,
          "smartModelName": false
        }
      }
    }
  }
}
```

### Non-`/v1` Discovery Endpoint

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com",
        "modelsDiscovery": {
          "endpoint": "/models"
        }
      }
    }
  }
}
```

### Slow Provider Discovery

For a local server or gateway that needs longer to respond, set `modelsDiscovery.timeoutMs` on that provider:

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "slow-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Slow Gateway",
      "options": {
        "baseURL": "https://gateway.example.com/v1",
        "modelsDiscovery": {
          "timeoutMs": 15000
        }
      }
    }
  }
}
```

Each request to this provider's discovery or provider-specific metadata endpoint can take up to `15000` milliseconds. The plugin also raises its startup discovery wait budget from the default `5000` milliseconds to the largest configured provider timeout.

### models.dev Metadata Enrichment

Providers that expose only a minimal OpenAI-compatible `/v1/models` response can opt into metadata enrichment from models.dev:

```json
{
  "plugin": ["opencode-models-discovery"],
  "provider": {
    "openrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenRouter",
      "options": {
        "baseURL": "https://openrouter.ai/api/v1",
        "apiKey": "YOUR_OPENROUTER_API_KEY",
        "modelsDiscovery": {
          "enabled": true,
          "modelInfoFormat": "models.dev"
        }
      }
    }
  }
}
```

This setting is explicit because models.dev is an external metadata source. Without `modelInfoFormat: "models.dev"`, the plugin does not contact models.dev.

This project is not affiliated with, endorsed by, or sponsored by [models.dev](https://models.dev/).

When a safe model id segment match exists, models.dev metadata can add model limits and capabilities such as `tool_call`, `reasoning`, `attachment`, `structured_output`, `temperature`, and `modalities`.

This means providers using `@ai-sdk/anthropic` with OpenAI-compatible backends are supported when the `baseURL` contains `/v1/`, when a provider-specific discovery endpoint is configured, or when provider-level discovery is explicitly forced on. It also means providers like DeepSeek can be discovered from a non-`/v1` baseURL as long as the models endpoint is configured explicitly.
