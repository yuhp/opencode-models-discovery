# Debugging opencode-models-discovery-wz in OpenCode TUI

## How to Debug

When you run OpenCode in TUI mode, check the console output for these log messages:

### Expected Log Sequence

1. `[opencode-models-discovery-wz] Model discovery plugin initialized` - Plugin loaded
2. A config hook log indicating discovery/config processing started - Config hook invoked
3. Provider creation or provider check logs - Provider instantiated successfully
4. Discovery logs for `/v1/models` requests - Model discovery started
5. Model discovery summary logs - Models found
6. Model merge/injection logs - Models added to config
7. Final config hook completion logs - Hook completed

### What to Check

1. **Is the plugin loaded?**
   - Look for: `[opencode-models-discovery-wz] Model discovery plugin initialized`
   - If missing: Plugin not installed or not in config

2. **Is the config hook being called?**
   - Look for config-related logs after plugin initialization
   - If missing: OpenCode might not be calling the hook

3. **Are models being discovered?**
   - Look for discovery logs or a discovered model count for your provider
   - If count is 0: The provider might not be running, reachable, or exposing any models

4. **Are models being added to config?**
   - Look for model merge/injection logs
   - Check: `modelCount` in the final log message

5. **Is the config frozen?**
   - Look for: `configFrozen: true` in the debug log
   - If true: OpenCode might be passing a frozen config object

### Common Issues

#### Issue: Models not showing in OpenCode

**Possible causes:**
1. Config hook not being awaited by OpenCode
2. Config object is frozen/read-only
3. OpenCode reads config before hook completes
4. Config object is cloned before hook runs

**Debug steps:**
1. Check console logs for the sequence above
2. Look for warnings about frozen config
3. Check if `modelCount` is 0 in final log
4. Verify your provider is running: `curl http://127.0.0.1:1234/v1/models`

#### Issue: Plugin not loading

**Check:**
1. Plugin is in `opencode.json`: `"plugin": ["opencode-models-discovery-wz"]`
2. Plugin is installed: `npm list opencode-models-discovery-wz`
3. No errors in OpenCode startup logs

#### Issue: Provider not detected

**Check:**
1. Your provider service is running
2. Its OpenAI-compatible API endpoint is active
3. The configured port is correct
4. Try: `curl http://127.0.0.1:1234/v1/models`

### Manual Test

Run this to test the plugin directly:

```bash
bun debug-opencode-simulation.ts
```

This simulates how OpenCode calls the plugin and shows if models are loaded correctly.
