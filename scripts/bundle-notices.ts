#!/usr/bin/env bun
/**
 * Generates dist/THIRD-PARTY-NOTICES.md covering every package whose code
 * (or types) are bundled into the published distribution.
 *
 * Bundling the SDKs removes the installed node_modules tree but keeps the
 * bundled packages under their own licenses (MIT etc.), which still require
 * attribution when redistributed. The esbuild metafiles (written by
 * compile:runtime/compile:tui) list exactly which packages ended up in the
 * bundles, so the inventory stays accurate without manual bookkeeping. It
 * also doubles as the source of truth for scripts/gen-types.ts, which must
 * inline the same package set into the shipped .d.ts files.
 *
 * Usage: bun scripts/bundle-notices.ts [meta/runtime.meta.json meta/tui.meta.json]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface EsbuildMetafile {
  outputs: Record<string, { inputs?: Record<string, unknown> }>
}

export interface PackageManifestLite {
  version: string
  license?: string
}

export interface BundlePackage {
  name: string
  dir: string
  version: string
  license: string
}

const NODE_MODULES_SEGMENT = 'node_modules/'

function packageDirsFor(inputPath: string): { dir: string; name: string }[] {
  const dirs: { dir: string; name: string }[] = []
  let searchFrom = 0
  for (;;) {
    const index = inputPath.indexOf(NODE_MODULES_SEGMENT, searchFrom)
    if (index === -1) return dirs
    const after = index + NODE_MODULES_SEGMENT.length
    const first = inputPath.indexOf('/', after)
    if (first === -1) return dirs
    const firstSegment = inputPath.slice(after, first)
    const nameEnd = firstSegment.startsWith('@') ? inputPath.indexOf('/', first + 1) : first
    if (nameEnd === -1) return dirs
    const name = inputPath.slice(after, nameEnd)
    dirs.push({ dir: inputPath.slice(0, nameEnd), name })
    searchFrom = nameEnd + 1
  }
}

/** Innermost package directory containing an input file (nested installs win). */
function innermostPackage(inputPath: string): { dir: string; name: string } | null {
  const dirs = packageDirsFor(inputPath)
  return dirs.length > 0 ? dirs[dirs.length - 1] : null
}

function allInputs(metafile: EsbuildMetafile): string[] {
  return Object.values(metafile.outputs).flatMap((output) => Object.keys(output.inputs ?? {}))
}

/** Sorted unique package names whose files were bundled. */
export function bundledPackageNames(metafile: EsbuildMetafile): string[] {
  const names = new Set<string>()
  for (const input of allInputs(metafile)) {
    const innermost = innermostPackage(input)
    if (innermost) names.add(innermost.name)
  }
  return [...names].sort()
}

/** Resolves a package directory (e.g. 'node_modules/effect') to its manifest. */
export type PackageManifestReader = (packageDir: string) => PackageManifestLite | null

/** One entry per distinct bundled package, sorted by name then version. */
export function collectBundledPackages(
  metafile: EsbuildMetafile,
  readPackage: PackageManifestReader
): BundlePackage[] {
  const byKey = new Map<string, BundlePackage>()
  for (const input of allInputs(metafile)) {
    const innermost = innermostPackage(input)
    if (!innermost) continue
    const manifest = readPackage(innermost.dir)
    if (!manifest) continue
    const license = manifest.license ?? 'UNKNOWN'
    const key = `${innermost.dir}@${manifest.version}`
    if (!byKey.has(key)) {
      byKey.set(key, { name: innermost.name, dir: innermost.dir, version: manifest.version, license })
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version) || a.dir.localeCompare(b.dir)
  )
}

/** Renderer for license texts, given a collected package entry. */
export type LicenseTextReader = (pkg: BundlePackage) => string | undefined

export function renderNoticesMd(
  packages: BundlePackage[],
  readLicenseText: LicenseTextReader
): string {
  const lines: string[] = [
    '# Third-party notices',
    '',
    'This distribution statically bundles the following packages (plus their',
    'transitive code and type declarations) into `dist/runtime.js`, `dist/tui.js`,',
    'and the generated `.d.ts` files. They are listed with the exact versions that',
    'were bundled; the full license text of each is reproduced below.',
    '',
    '## Bundled packages',
    '',
  ]
  for (const pkg of packages) {
    lines.push(`- ${pkg.name}@${pkg.version} (${pkg.license})`)
  }
  lines.push('')
  for (const pkg of packages) {
    lines.push(`## ${pkg.name}@${pkg.version}`, '', `License: ${pkg.license}`, '')
    const text = readLicenseText(pkg)
    if (text) {
      lines.push(text.trim(), '')
    } else {
      lines.push('_No license text file was found in the published package; see the license field above and the upstream repository._', '')
    }
  }
  return lines.join('\n')
}

const LICENSE_FILENAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'COPYING']

function main(metaPaths: string[]): void {
  const root = path.resolve(import.meta.dirname ?? '.', '..')
  const readPackage: PackageManifestReader = (packageDir) => {
    const manifestPath = path.join(root, packageDir, 'package.json')
    if (!existsSync(manifestPath)) return null
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      version?: string
      license?: string | { type?: string }
    }
    const license =
      typeof manifest.license === 'string'
        ? manifest.license
        : typeof manifest.license?.type === 'string'
          ? manifest.license.type
          : undefined
    return { version: manifest.version ?? '0.0.0-unknown', license }
  }
  const readLicenseText: LicenseTextReader = (pkg) => {
    for (const name of LICENSE_FILENAMES) {
      const candidate = path.join(root, pkg.dir, name)
      if (existsSync(candidate)) return readFileSync(candidate, 'utf-8')
    }
    return undefined
  }

  const byKey = new Map<string, BundlePackage>()
  for (const metaPath of metaPaths) {
    for (const pkg of collectBundledPackages(JSON.parse(readFileSync(path.resolve(root, metaPath), 'utf-8')), readPackage)) {
      const key = `${pkg.name}@${pkg.version}`
      if (!byKey.has(key)) byKey.set(key, pkg)
    }
  }
  const packages = [...byKey.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
  )

  const outFile = path.join(root, 'dist', 'THIRD-PARTY-NOTICES.md')
  writeFileSync(outFile, renderNoticesMd(packages, readLicenseText))
  const tracked = packages.filter((pkg) =>
    ['@opencode/plugin', '@opencode-ai/plugin', 'effect'].includes(pkg.name)
  )
  console.log(
    `bundle-notices: ${packages.length} packages -> ${path.relative(root, outFile)} ` +
      `(bundled ${tracked.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')})`
  )
}

const invokedDirectly =
  import.meta.main ||
  (process.argv[1] !== undefined && import.meta.filename === path.resolve(process.argv[1]))
if (invokedDirectly) {
  const args = process.argv.slice(2)
  main(args.length > 0 ? args : ['meta/runtime.meta.json', 'meta/tui.meta.json'])
}
