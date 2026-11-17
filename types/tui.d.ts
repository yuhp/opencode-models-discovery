/**
 * Self-contained public types for the `opencode-models-discovery/tui` entry.
 * Described structurally (see types/index.d.ts for the rationale); keep in
 * sync with src/tui.ts. test/types-consumer.test.ts verifies consumers can
 * implement TuiPluginDefinition and call defineTuiPlugin against these types.
 */

/** Minimal structural view of the OpenCode V2 TUI plugin context. */
export interface TuiPluginContext {
  readonly [key: string]: unknown;
}

/** Cleanup callback a TUI plugin's setup may return. */
export type TuiCleanup = () => Promise<void> | void;

/** Definition shape accepted by defineTuiPlugin. */
export interface TuiPluginDefinition {
  readonly id: string;
  readonly setup: (context: TuiPluginContext) => Promise<TuiCleanup | void> | TuiCleanup | void;
}

/** Identity helper that registers a TUI plugin definition. */
export declare function defineTuiPlugin(plugin: TuiPluginDefinition): TuiPluginDefinition;

declare const tuiPlugin: TuiPluginDefinition;

export default tuiPlugin;
