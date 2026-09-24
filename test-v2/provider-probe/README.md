# Provider Transform Probe

This fixture is a reproducible no-seed provider discovery check for the pinned
`@opencode/plugin@2.0.14` and `@opencode/cli@2.0.14` runtime.

The runner creates temporary project, HOME, and XDG directories. It starts the
mock first, passes the provider declaration through plugin tuple options, and
starts the local CLI from `node_modules`. It copies and loads the production
`src-v2` entrypoint, which uses only the public provider API, requests
`/v1/models`, transforms the inventory, and reloads it.

Run the complete check from the repository root:

```sh
npm --prefix test-v2/provider-probe test
```

The runner has a bounded timeout and always terminates both child processes,
falling back from SIGTERM to SIGKILL. It queries `/api/plugin`, `/api/provider`,
and `/api/model` with the temporary project directory as the API location. It
derives the provider ID and package from the fixture options, asserts that the
provider has no `models` input, and observes the mock request count for 1.2
seconds after discovery. A changing count fails the check as a likely refresh
loop. No `--config` flag is used; OpenCode discovers the temporary project's
`opencode.json` through its normal config search.
