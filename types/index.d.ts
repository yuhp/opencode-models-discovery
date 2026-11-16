/**
 * Self-contained public types for opencode-models-discovery.
 *
 * The runtime SDKs (@opencode/plugin, @opencode-ai/plugin) are bundled into
 * dist/*.js at build time and the published package declares no installable
 * dependencies, so these declarations describe the plugin contract
 * structurally instead of importing SDK types: consumers typecheck against
 * this package alone (proven by test/types-consumer.test.ts). Keep the shapes
 * below in sync with src/index.ts / src/runtime.ts; test/node-loadable.test.ts
 * verifies the runtime side of the same contract against a plain Node host.
 */

/**
 * Minimal structural view of the OpenCode v2 plugin context. Hosts pass a
 * rich context object (providers, tui, storage, ...); only `id`/`setup`
 * consumption is contract-relevant, so unknown host members are preserved.
 */
export interface PluginContext {
  readonly [key: string]: unknown;
}

/** Cleanup callback returned by plugin setup hooks. */
export type Cleanup = () => Promise<void> | void;

/** OpenCode V1 server plugin factory (a function per @opencode-ai/plugin). */
export type ServerPluginFactory = (context: unknown) => unknown;

/** The combined adapter consumed by both OpenCode V1 and V2 hosts. */
export interface CombinedPlugin {
  readonly id: string;
  readonly setup: (context: PluginContext) => Promise<Cleanup> | Cleanup | void;
  readonly server: ServerPluginFactory;
}

/** V1 server plugin factory exported for hosts that load this package directly. */
export declare const ModelDiscoveryPlugin: ServerPluginFactory;

/** V2 setup entry point exported for hosts that wire it into their own plugin. */
export declare function setupV2(context: PluginContext): Promise<Cleanup>;

declare const combinedPlugin: CombinedPlugin;

export default combinedPlugin;
