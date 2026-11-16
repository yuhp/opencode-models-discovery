/**
 * Tests for the third-party notices generator that documents (and feeds the
 * type-inlining list to) whatever the esbuild bundles pull in.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  bundledPackageNames,
  collectBundledPackages,
  renderNoticesMd,
} from '../scripts/bundle-notices.ts'
import { findNoticeViolations } from '../scripts/check-bundle-deps.ts'

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function metafile(...inputPaths: string[]) {
  return {
    outputs: {
      'dist/runtime.js': {
        bytes: 1,
        inputs: Object.fromEntries(inputPaths.map((p) => [p, { bytes: 1 }])),
        imports: [],
      },
    },
  }
}

describe('bundledPackageNames', () => {
  it('lists unique node_modules packages and ignores src files', () => {
    const names = bundledPackageNames(
      metafile(
        'src/index.ts',
        'node_modules/effect/dist/x.js',
        'node_modules/@opencode/plugin/a.ts',
        'node_modules/@opencode/plugin/node_modules/@opencode/client/b.js',
        'node_modules/@opencode/ai/y.js'
      )
    )
    expect(names).toEqual([
      '@opencode/ai',
      '@opencode/client',
      '@opencode/plugin',
      'effect',
    ])
  })
})

describe('collectBundledPackages', () => {
  it('attributes each input to its innermost containing package', () => {
    const manifests: Record<string, { version: string; license?: string }> = {
      'node_modules/a': { version: '1.0.0', license: 'MIT' },
      'node_modules/a/node_modules/b': { version: '9.9.9', license: 'ISC' },
    }
    const collected = collectBundledPackages(
      metafile('node_modules/a/o.js', 'node_modules/a/node_modules/b/i.js'),
      (packageDir) => manifests[packageDir] ?? null
    )
    expect(collected).toEqual([
      { name: 'a', dir: 'node_modules/a', version: '1.0.0', license: 'MIT' },
      { name: 'b', dir: 'node_modules/a/node_modules/b', version: '9.9.9', license: 'ISC' },
    ])
  })

  it('defaults a missing license field to UNKNOWN', () => {
    const collected = collectBundledPackages(
      metafile('node_modules/m/x.js'),
      () => ({ version: '0.1.0' })
    )
    expect(collected).toEqual([{ name: 'm', dir: 'node_modules/m', version: '0.1.0', license: 'UNKNOWN' }])
  })

  it('deduplicates inputs pointing into the same package version', () => {
    const collected = collectBundledPackages(
      metafile('node_modules/m/x.js', 'node_modules/m/y.js', 'node_modules/m/z.js'),
      () => ({ version: '0.1.0', license: 'MIT' })
    )
    expect(collected).toHaveLength(1)
  })

  it('skips inputs whose package manifest cannot be read', () => {
    expect(collectBundledPackages(metafile('node_modules/g/x.js'), () => null)).toEqual([])
  })
})

describe('renderNoticesMd', () => {
  it('renders an inventory plus the license text of each package', () => {
    const md = renderNoticesMd(
      [{ name: 'effect', dir: 'node_modules/effect', version: '4.1.0', license: 'MIT' }],
      () => 'MIT License text'
    )
    expect(md).toContain('effect@4.1.0 (MIT)')
    expect(md).toContain('## effect@4.1.0')
    expect(md).toContain('MIT License text')
  })

  it('notes when no license text file ships with a package', () => {
    const md = renderNoticesMd(
      [{ name: 'mystery', dir: 'node_modules/mystery', version: '1.0.0', license: 'UNKNOWN' }],
      () => undefined
    )
    expect(md).toContain('No license text file was found')
  })
})

describe('findNoticeViolations', () => {
  const meta = metafile('node_modules/@opencode/plugin/a.js', 'node_modules/effect/x.js')
  const reader = (dir: string) =>
    dir.endsWith('@opencode/plugin') ? { version: '2.2.6', license: 'MIT' } : { version: '4.1.0', license: 'MIT' }
  const complete = '# notices\n\n- @opencode/plugin@2.2.6 (MIT)\n- effect@4.1.0 (MIT)\n'

  it('passes when the inventory matches the bundles', () => {
    expect(findNoticeViolations(complete, [meta], reader)).toEqual([])
  })

  it('flags bundled packages missing from the notices', () => {
    expect(findNoticeViolations('# notices\n\n- effect@4.1.0 (MIT)\n', [meta], reader)).toEqual([
      '@opencode/plugin@2.2.6 is bundled but missing from THIRD-PARTY-NOTICES.md',
    ])
  })

  it('flags listed packages that are not bundled', () => {
    const extra = `${complete}- ghost@1.0.0 (MIT)\n`
    expect(findNoticeViolations(extra, [meta], reader)).toEqual([
      'ghost@1.0.0 is listed in THIRD-PARTY-NOTICES.md but is not bundled',
    ])
  })

  it('flags bundled packages without a license classification', () => {
    const violations = findNoticeViolations(complete, [meta], (dir) =>
      dir.endsWith('@opencode/plugin') ? { version: '2.2.6' } : { version: '4.1.0', license: 'MIT' }
    )
    expect(violations).toEqual(['@opencode/plugin@2.2.6 has no license classification'])
  })
})

describe('generated notices for this build', () => {
  beforeAll(() => {
    if (!existsSync(path.join(repoRoot, 'meta/runtime.meta.json'))) {
      execFileSync('npm', ['run', 'compile'], { cwd: repoRoot, stdio: 'pipe' })
    }
  }, 120_000)

  it('lists every package bundled into dist/runtime.js', () => {
    const runtimeMeta = JSON.parse(readFileSync(path.join(repoRoot, 'meta/runtime.meta.json'), 'utf-8'))
    const fsReader = (packageDir: string) => {
      const manifestPath = path.join(repoRoot, packageDir, 'package.json')
      if (!existsSync(manifestPath)) return null
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      return { version: manifest.version as string, license: typeof manifest.license === 'string' ? manifest.license : undefined }
    }
    const packages = collectBundledPackages(runtimeMeta, fsReader)
    const byName = new Map(packages.map((p) => [p.name, p]))

    const sdk = byName.get('@opencode/plugin')
    expect(sdk, '@opencode/plugin must appear in the bundled inventory').toBeDefined()
    const pinnedVersion = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'))
      .devDependencies['@opencode/plugin']
    expect(sdk?.version, 'inventory records the exact bundled SDK version').toBe(pinnedVersion)
    expect(sdk?.license).not.toBe('UNKNOWN')

    // Every listed package must have a license classification
    for (const pkg of packages) expect(pkg.license, `${pkg.name} license`).toBeTruthy()
  })
})
