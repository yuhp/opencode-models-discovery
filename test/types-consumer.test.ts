/**
 * Clean-consumer typecheck regression for the bundled distribution.
 *
 * The package's `types` entries must be self-contained: the runtime SDKs are
 * bundled into dist/*.js and no longer published as installable dependencies,
 * so a consumer that installs ONLY this package (plus ambient Node types,
 * which any Node-based TypeScript consumer has) must typecheck against the
 * shipped declarations. Historically the `types` entries pointed at
 * src/*.ts, which import '@opencode/plugin' - keeping that layout after the
 * dependency removal made clean-consumer `tsc` fail with TS2307.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function cleanNpmEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_config_')) delete env[key]
  }
  return env
}

const CONSUMER_SOURCE = `import combined, { ModelDiscoveryPlugin, setupV2 } from 'opencode-models-discovery'
import serverDefault from 'opencode-models-discovery/server'
import tuiDefault, { defineTuiPlugin, type TuiCleanup, type TuiPluginDefinition } from 'opencode-models-discovery/tui'

const pluginId: string = combined.id
const serverId: string = serverDefault.id
const tuiId: string = tuiDefault.id
const cleanup: TuiCleanup = () => undefined

const definition: TuiPluginDefinition = defineTuiPlugin({
  id: 'consumer-check',
  setup: async () => cleanup,
})

export const checked = [pluginId, serverId, tuiId, definition.id, ModelDiscoveryPlugin, setupV2] as const
`

describe('clean-consumer typecheck', () => {
  let workDir: string
  let stagedRoot: string

  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'omd-types-consumer-'))
    stagedRoot = path.join(workDir, 'consumer')
    const consumerNodeModules = path.join(stagedRoot, 'node_modules')
    mkdirSync(path.join(consumerNodeModules, '@types'), { recursive: true })

    execFileSync('npm', ['run', 'compile'], { cwd: repoRoot, stdio: 'pipe', env: cleanNpmEnv() })
    execFileSync('npm', ['pack', '--pack-destination', workDir, '--ignore-scripts'], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: cleanNpmEnv(),
    })
    const tarball = readdirSync(workDir).find((f) => f.endsWith('.tgz'))
    if (!tarball) throw new Error('npm pack produced no tarball')
    execFileSync('tar', ['-xzf', path.join(workDir, tarball), '-C', consumerNodeModules], { stdio: 'pipe' })
    const extracted = path.join(consumerNodeModules, 'package')
    const pkgDir = path.join(consumerNodeModules, 'opencode-models-discovery')
    rmSync(pkgDir, { recursive: true, force: true })
    renameSync(extracted, pkgDir)

    // Ambient Node types stand for what any Node-based consumer already has;
    // nothing else (no SDK, no effect) is provided.
    for (const [sourceName, destName] of [
      ['@types/node', '@types/node'],
      ['undici-types', 'undici-types'],
    ] as const) {
      const source = path.join(repoRoot, 'node_modules', sourceName)
      if (existsSync(source)) {
        cpSync(source, path.join(consumerNodeModules, destName), { recursive: true })
      }
    }

    writeFileSync(path.join(stagedRoot, 'consumer.ts'), CONSUMER_SOURCE)
  }, 300_000)

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  it('typechecks a consumer that installed only this package', () => {
    const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
    let status = 0
    let output = ''
    try {
      output = execFileSync(
        process.execPath,
        [
          tscBin,
          '--noEmit',
          '--strict',
          '--target', 'es2022',
          '--module', 'esnext',
          '--moduleResolution', 'bundler',
          'consumer.ts',
        ],
        { cwd: stagedRoot, stdio: 'pipe', encoding: 'utf-8', env: cleanNpmEnv() }
      )
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string }
      status = e.status ?? 1
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`
    }
    expect(
      { status, output: output.trim().slice(0, 2000) },
      'tsc against the published types must succeed with only this package installed'
    ).toEqual({ status: 0, output: '' })
  }, 240_000)
})
