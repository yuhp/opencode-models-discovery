# opencode-models-discovery

[![npm version](https://img.shields.io/npm/v/opencode-models-discovery.svg?color=blue)](https://www.npmjs.com/package/opencode-models-discovery)
[![npm downloads](https://img.shields.io/npm/dt/opencode-models-discovery.svg)](https://www.npmjs.com/package/opencode-models-discovery)
[![release](https://github.com/yuhp/opencode-models-discovery/actions/workflows/release.yml/badge.svg)](https://github.com/yuhp/opencode-models-discovery/actions/workflows/release.yml)
[![license](https://img.shields.io/github/license/yuhp/opencode-models-discovery)](https://github.com/yuhp/opencode-models-discovery/blob/main/LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D1.4.0-blueviolet)](https://opencode.ai)

> A universal OpenCode plugin for dynamic model discovery across **any OpenAI-compatible provider**.

Originally inspired by [opencode-lmstudio](https://github.com/nicktasios/opencode-lmstudio), this project has been fully refactored into a general-purpose model discovery plugin with richer configuration controls for providers, models, naming, caching, and discovery behavior.

## Features

- **Universal Provider Support**: Works with any OpenAI-compatible provider (LM Studio, Ollama, LocalAI, gateways, and more)
- **Dynamic Model Discovery**: Queries each provider's `/v1/models` endpoint to discover available models
- **Auto-Injection**: Automatically adds unconfigured models into OpenCode provider config
- **Provider Filtering**: Include or exclude specific providers from discovery
- **Model Filtering**: Use regex rules to precisely control which discovered models are injected
- **Configurable Discovery**: Control discovery behavior with enable/disable switches and TTL-based caching
- **Smart Model Formatting**: Optional human-friendly display names for discovered models
- **Organization Owner Extraction**: Extracts and sets `organizationOwner` from model IDs when available
- **Health Check Monitoring**: Verifies providers are accessible before attempting discovery
- **Model Merging**: Intelligently merges discovered models with existing configuration
- **Error Handling**: Smart error categorization with actionable suggestions

## Installation

```bash
npm install opencode-models-discovery
# or
bun add opencode-models-discovery
```

## Usage

Add the plugin to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-models-discovery@latest"
  ],
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama (local)",
      "options": {
        "baseURL": "http://127.0.0.1:11434/v1"
      }
    },
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://127.0.0.1:1234/v1"
      }
    }
  }
}
```

### Configuration

The plugin configuration is placed in the `plugin` array using tuple format `["plugin-name", { config }]`:

```json
{
  "plugin": [
    ["opencode-models-discovery", {
      "providers": {
        "include": [],
        "exclude": []
      },
      "models": {
        "includeRegex": [],
        "excludeRegex": []
      },
      "discovery": {
        "enabled": true
      },
      "smartModelName": false
    }]
  ]
}
```

Set `smartModelName` to `true` if you want discovered models to use human-friendly display names instead of the raw `model_id`. (e.g., "Qwen3 30B A3B" instead of "qwen/qwen3-30b-a3b")

#### Provider Filtering

Control which providers are discovered:

| Option | Type | Description |
|--------|------|-------------|
| `providers.include` | `string[]` | If non-empty, **only** these providers will be discovered |
| `providers.exclude` | `string[]` | These providers will be skipped (only used when `include` is empty) |

```json
{
  "plugin": [
    ["opencode-models-discovery", {
      "providers": {
        "include": ["ollama"],
        "exclude": ["lmstudio"]
      }
    }]
  ]
}
```

#### Model Filtering

Control which discovered models are auto-injected with regular expressions:

| Option | Type | Description |
|--------|------|-------------|
| `models.includeRegex` | `string[]` | If non-empty, only discovered model IDs matching at least one regex will be added |
| `models.excludeRegex` | `string[]` | Discovered model IDs matching any regex will be skipped (only used when `includeRegex` is empty) |

Regex filtering only applies to auto-discovered models. Models already explicitly configured by the user are preserved.

```json
{
  "plugin": [
    ["opencode-models-discovery", {
      "models": {
        "includeRegex": ["^qwen/", "gpt-4"],
        "excludeRegex": ["embedding", "test"]
      }
    }]
  ]
}
```

### How It Works

1. On OpenCode startup, the plugin's `config` hook is called
2. The plugin iterates through all configured providers
3. For each provider, it checks if the baseURL contains `/v1/` (supports any npm package)
4. For each accessible provider, it queries the `/v1/models` endpoint
5. Discovered models are automatically merged into the provider's configuration
6. The enhanced configuration is used for the current session

### Supported Providers

The plugin supports any OpenAI-compatible provider. Here are the most common ones:

| Provider | Default Port | Use Case | npm Package |
|----------|-------------|----------|-------------|
| **Ollama** | 11434 | Local model inference engine | `@ai-sdk/openai-compatible` |
| **LM Studio** | 1234 | Local LLM with UI | `@ai-sdk/openai-compatible` |
| **LocalAI** | 8080 | Self-hosted AI inference | `@ai-sdk/openai-compatible` |
| **llama.cpp Server** | 8080 | Standalone llama.cpp server | `@ai-sdk/openai-compatible` |
| **Text Generation WebUI** | 5000 | OpenAI-compatible extension | `@ai-sdk/openai-compatible` |
| **FastChat (Vicuna)** | 8001 | Multi-model serving | `@ai-sdk/openai-compatible` |
| **vLLM** | 8000 | High-performance inference | `@ai-sdk/openai-compatible` |
| **CLIProxyAPI** | 8317 | A LLM proxy server  | `@ai-sdk/anthropic` (with `/v1` backend) & `@ai-sdk/openai-compatible` |

#### Anthropic API with Custom Backend

Providers using `@ai-sdk/anthropic` but backed by OpenAI-compatible servers (like Ollama's Anthropic compatibility mode) are also supported:

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/anthropic",
      "name": "Ollama (Anthropic Mode)",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" }
    }
  }
}
```

#### Cloud OpenAI-Compatible Services

Cloud services with OpenAI-compatible APIs are also supported:

- **Cloudflare Workers AI**
- **Azure OpenAI Service** (with appropriate endpoint configuration)
- **Groq** (ultra-fast inference)
- **Together AI**
- **Perplexity AI**
- **Any custom OpenAI-compatible API**

### Provider Detection

The plugin identifies OpenAI-compatible providers using **two detection methods**:

1. **Strict Detection**: `npm === "@ai-sdk/openai-compatible"`
2. **URL-based Detection**: `baseURL` contains `/v1/` pattern

A provider is considered discoverable if **either** condition matches.

#### Examples of Supported Configurations

```json
{
  "provider": {
    "ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Ollama",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" }
    }
  }
}
```

```json
{
  "provider": {
    "ollama-anthropic": {
      "npm": "@ai-sdk/anthropic",
      "name": "Ollama (Anthropic Mode)",
      "options": { "baseURL": "http://127.0.0.1:11434/v1" }
    }
  }
}
```

```json
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": { "baseURL": "http://127.0.0.1:1234/v1" }
    }
  }
}
```

This means providers using `@ai-sdk/anthropic` with OpenAI-compatible backends (like Ollama's Anthropic compatibility mode) are also supported, as long as the `baseURL` contains `/v1/`.

## Requirements

- OpenCode with plugin support
- At least one OpenAI-compatible provider running locally or remotely
- Provider server API accessible (e.g., `http://127.0.0.1:11434/v1`)

## Logging

When available, the plugin writes logs through OpenCode's structured server log API via `client.app.log(...)` using the service name `opencode-models-discovery`.

If structured logging is unavailable in the runtime, the plugin falls back to prefixed `console.*` output. Key log categories are emitted through metadata such as `plugin`, `config`, `discovery`, `event`, and `filtering` to make local debugging easier with `opencode --print-logs`.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with OpenCode in any way.
