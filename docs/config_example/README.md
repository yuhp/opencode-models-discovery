# Community Provider Configuration Examples

This directory contains community-maintained provider configuration examples for `opencode-models-discovery`.

Examples may include provider declarations, non-standard `modelsDiscovery.endpoint` values, provider-level `models.includeBy` and `models.excludeBy` raw-field filters using `equals` or `match`, metadata enrichment options, and notes about provider-specific behavior. Provider-level `models.includeRegex` and `models.excludeRegex` are supported as id-only shortcuts, but examples should prefer `includeBy` and `excludeBy`.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by the providers listed in these examples.

Examples are community-maintained and may become outdated. Users are responsible for verifying provider legality, terms of service, pricing, data handling, and regional availability.

Examples are not security, legal, compliance, or purchasing advice.

Do not paste secrets into public issues or pull requests. Configure provider credentials with OpenCode `/connect` when possible, or through local private config.

## Examples

- [A2Agent](a2agent.md)
- [AI-ROUTER](ai-router.md)
- [DeepSeek](deepseek.md)

## Community Example PR Scope

Community provider example PRs are welcome, but they must stay narrowly scoped. Submit these PRs against the `community/config-examples` branch unless maintainers request another target.

Acceptable changes for a provider example PR:

- Add a new Markdown file under `docs/config_example/`.
- Add one link to that new file in this README's examples list.

Do not include unrelated changes in provider example PRs. In particular, do not modify runtime source code, package metadata, release files, workflows, tests, or general documentation outside `docs/config_example/`.

Each example should:

- Use provider-level `provider.<id>.options.modelsDiscovery` config.
- Prefer `models.includeBy` and `models.excludeBy` over `includeRegex` and `excludeRegex`.
- Avoid secrets, tokens, API keys, account IDs, or private URLs.
- Include a provider-specific disclaimer that this project is not affiliated with, endorsed by, or sponsored by that provider.
- Ask users to verify current API endpoints, pricing, terms of service, data handling, and regional availability.

Maintainers may close or request changes on PRs that exceed this scope, add promotional language, include secrets, or present provider examples as official endorsements.
