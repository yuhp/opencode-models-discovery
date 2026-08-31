/**
 * Regression tests for OpenCode Desktop plugin loading.
 *
 * The OpenCode Desktop app runs the server (and therefore plugins) inside
 * Electron's plain Node runtime instead of Bun. Node refuses to type-strip
 * `.ts` files located under `node_modules/`, and plugins are always installed
 * under a `node_modules/` directory by the host. A published package whose
 * entry point is raw TypeScript therefore loads in the CLI (Bun transpiles
 * `.ts` everywhere) but fails silently in Desktop with
 * `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` (see issue #65).
 *
 * These tests stage the package exactly as npm would publish it, install it
 * into a simulated `node_modules/` tree, and import it with a plain `node`
 * process - the same `await import(entry)` step the Desktop plugin loader
 * performs.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function readPackageManifest(dir: string): {
  name: string
  main?: string
  exports?: Record<string, unknown> | string
} {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf-8'))
}

/** Resolve the runtime entry file (not types) the way Node/Bun would. */
function resolveEntryRelative(manifest: ReturnType<typeof readPackageManifest>): string {
  const exp = manifest.exports
  if (typeof exp === 'string') return exp
  if (exp && typeof exp === 'object') {
    const dot = (exp as Record<string, unknown>)['.']
    if (typeof dot === 'string') return dot
    if (dot && typeof dot === 'object') {
      const conds = dot as Record<string, string>
      // ignore the "types" condition: runtime resolution only
      return conds['default'] ?? conds['import'] ?? conds['require'] ?? manifest.main ?? ''
    }
  }
  return manifest.main ?? ''
}

function findNodeBinary(): string {
  try {
    execFileSync('node', ['--version'], { stdio: 'pipe' })
    return 'node'
  } catch {
    throw new Error('plain `node` is required on PATH for the Desktop-compat import check')
  }
}

/**
 * npm exports CLI flags as `npm_config_*` environment variables to lifecycle
 * children, so this test can run nested inside `npm publish` (prepublishOnly)
 * or `npm publish --dry-run`. Scrub inherited config so plain `npm pack` and
 * `npm run compile` behave exactly as if invoked from a clean shell.
 */
function cleanNpmEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key.startsWith('npm_config_')) delete env[key]
  }
  return env
}

describe('Node host compatibility (OpenCode Desktop)', () => {
  const pkg = readPackageManifest(repoRoot)
  let workDir: string
  let stagedRoot: string
  let stagedPkgDir: string

  beforeAll(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'omd-node-loadable-'))
    stagedRoot = path.join(workDir, 'consumer')
    stagedPkgDir = path.join(stagedRoot, 'node_modules', pkg.name)
    mkdirSync(stagedPkgDir, { recursive: true })

    // Build the distributable first when the package declares how to.
    const scripts = (readPackageManifest(repoRoot) as unknown as { scripts?: Record<string, string> }).scripts ?? {}
    if (scripts['compile']) {
      execFileSync('npm', ['run', 'compile'], { cwd: repoRoot, stdio: 'pipe', env: cleanNpmEnv() })
    }

    // Stage the package exactly as npm would publish it (respecting files/),
    // without triggering lifecycle scripts.
    execFileSync('npm', ['pack', '--pack-destination', workDir, '--ignore-scripts'], {
      cwd: repoRoot,
      stdio: 'pipe',
      env: cleanNpmEnv(),
    })
    const tarball = readdirSync(workDir).find((f) => f.endsWith('.tgz'))
    if (!tarball) throw new Error('npm pack produced no tarball')
    execFileSync('tar', ['-xzf', path.join(workDir, tarball), '-C', stagedRoot], { stdio: 'pipe' })
    rmSync(stagedPkgDir, { recursive: true, force: true })
    execFileSync('mv', [path.join(stagedRoot, 'package'), stagedPkgDir], { stdio: 'pipe' })

    // Provide the runtime dependency the host would install alongside the plugin.
    const depSource = path.join(repoRoot, 'node_modules', 'xdg-basedir')
    if (existsSync(depSource)) {
      execFileSync('cp', ['-r', depSource, path.join(stagedRoot, 'node_modules', 'xdg-basedir')], { stdio: 'pipe' })
    }
  }, 60_000)

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true })
  })

  it('declares a compiled JavaScript runtime entry point', () => {
    const stagedManifest = readPackageManifest(stagedPkgDir)
    const entry = resolveEntryRelative(stagedManifest)
    expect(entry, 'package must declare main/exports for runtime resolution').toBeTruthy()
    expect(
      entry.endsWith('.js'),
      `runtime entry must be compiled JavaScript, got ${entry} (raw .ts cannot load under Node inside node_modules)`
    ).toBe(true)
  })

  it('ships the declared entry inside the published tarball', () => {
    const entry = resolveEntryRelative(readPackageManifest(stagedPkgDir))
    expect(existsSync(path.join(stagedPkgDir, entry)), `packaged entry missing: ${entry}`).toBe(true)
  })

  it('imports cleanly from plain Node inside a node_modules tree (Desktop loader parity)', () => {
    const node = findNodeBinary()
    const entry = resolveEntryRelative(readPackageManifest(stagedPkgDir))
    const entryUrl = new URL(`file://${path.join(stagedPkgDir, entry)}`).href
    const probe =
      `const m = await import(${JSON.stringify(entryUrl)});` +
      `const fn = m.ModelDiscoveryPlugin ?? m.default?.ModelDiscoveryPlugin ?? m.default;` +
      `if (typeof fn !== 'function') { console.error('NO_PLUGIN_EXPORT'); process.exit(2); }`

    let stdout = ''
    let stderr = ''
    let exitCode = 0
    try {
      stdout = execFileSync(node, ['--input-type=module', '-e', probe], {
        cwd: stagedRoot,
        stdio: 'pipe',
        encoding: 'utf-8',
      })
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string }
      exitCode = e.status ?? 1
      stdout = e.stdout ?? ''
      stderr = e.stderr ?? ''
    }
    expect(
      { exitCode, stderr: stderr.slice(0, 800) },
      'plain Node (OpenCode Desktop runtime) must be able to import the published plugin entry'
    ).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toBe('')
  }, 30_000)
})
