/**
 * Guard against re-introducing the multi-thousand-file install tree.
 *
 * OpenCode installs plugins into a versioned cache directory and materializes
 * every runtime/peer dependency as real files. Historically this package kept
 * `@opencode/plugin` external, so installing the plugin unpacked ~30k files
 * (the whole OpenCode SDK tree plus AWS/Redis/OpenTelemetry transitives).
 * The SDK is now bundled into `dist/runtime.js` and `dist/tui.js`, so these
 * tests pin the two properties that keep installs tiny:
 *   1. bundled outputs must not keep any external imports, and
 *   2. the published manifest must not declare installed dependencies.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  findExternalImports,
  findPackagedRuntimeDependencies,
} from '../scripts/check-bundle-deps.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function metafile(outputs: Record<string, { path: string; kind: string; external?: boolean }[]>) {
  return {
    outputs: Object.fromEntries(
      Object.entries(outputs).map(([output, imports]) => [
        output,
        { bytes: 1, inputs: { 'src/entry.ts': { bytes: 1 } }, imports },
      ])
    ),
  }
}

describe('findExternalImports', () => {
  it('flags an output that keeps an external import', () => {
    const violations = findExternalImports(
      metafile({ 'dist/runtime.js': [{ path: '@opencode/plugin', kind: 'import-statement', external: true }] })
    )
    expect(violations).toEqual(['dist/runtime.js: external import "@opencode/plugin" (import-statement)'])
  })

  it('flags external requires, not just import statements', () => {
    const violations = findExternalImports(
      metafile({ 'dist/tui.js': [{ path: 'some-package', kind: 'require-call', external: true }] })
    )
    expect(violations).toEqual(['dist/tui.js: external import "some-package" (require-call)'])
  })

  it('accepts bundled outputs whose imports are internal', () => {
    const violations = findExternalImports(
      metafile({
        'dist/runtime.js': [
          { path: 'src/plugin/index.ts', kind: 'import-statement' },
          { path: './runtime.js', kind: 'import-statement' },
        ],
      })
    )
    expect(violations).toEqual([])
  })

  it('exempts node builtins, with or without the node: prefix', () => {
    const violations = findExternalImports(
      metafile({
        'dist/runtime.js': [
          { path: 'node:http', kind: 'import-statement', external: true },
          { path: 'os', kind: 'import-statement', external: true },
        ],
      })
    )
    expect(violations).toEqual([])
  })
})

describe('findPackagedRuntimeDependencies', () => {
  it('flags runtime dependencies with their manifest field', () => {
    const violations = findPackagedRuntimeDependencies({
      dependencies: { 'xdg-basedir': '^5.1.0', '@opencode/plugin': '2.2.6' },
    })
    expect(violations).toEqual([
      'dependencies: @opencode/plugin',
      'dependencies: xdg-basedir',
    ])
  })

  it('flags peer and optional dependencies because package managers auto-install them', () => {
    const violations = findPackagedRuntimeDependencies({
      peerDependencies: { '@opencode-ai/plugin': '>=1.18.29' },
      optionalDependencies: { fsevents: '2.3.3' },
    })
    expect(violations).toEqual([
      'optionalDependencies: fsevents',
      'peerDependencies: @opencode-ai/plugin',
    ])
  })

  it('accepts a manifest with nothing to install', () => {
    expect(
      findPackagedRuntimeDependencies({
        devDependencies: { vitest: '^5.0.0' },
      })
    ).toEqual([])
  })
})

describe('published manifest regression', () => {
  it('ships no dependencies a plugin host would have to install', () => {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'))
    expect(findPackagedRuntimeDependencies(manifest)).toEqual([])
  })
})
