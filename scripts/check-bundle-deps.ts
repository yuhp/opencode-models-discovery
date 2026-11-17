#!/usr/bin/env bun
/**
 * Fails the build when a plugin install would materialize a dependency tree.
 *
 * Checks three invariants that keep the host's plugin cache small:
 *   1. Bundled outputs (esbuild metafiles passed as CLI args) contain no
 *      external imports - every dependency must be bundled and tree-shaken.
 *   2. package.json declares no dependencies, peerDependencies, or
 *      optionalDependencies: hosts like OpenCode install plugins into a
 *      versioned cache directory and materialize every one of them as real
 *      files, which is how this package once shipped ~30k files per install.
 *   3. With --notices, dist/THIRD-PARTY-NOTICES.md (written by
 *      scripts/bundle-notices.ts during `npm run compile`) must list exactly
 *      the packages the bundles contain, each with a license classification.
 *
 * Usage: bun scripts/check-bundle-deps.ts [--notices] dist/runtime.meta.json dist/tui.meta.json
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { collectBundledPackages, type EsbuildMetafile as InputsMetafile } from './bundle-notices.ts'

export interface EsbuildMetafile {
  outputs: Record<
    string,
    {
      imports?: { path: string; kind: string; external?: boolean }[]
    }
  >
}

export interface DependencyManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

const INSTALLED_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

const BUILTIN_MODULES = new Set(builtinModules)

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith('node:') || BUILTIN_MODULES.has(specifier)
}

/** Violations for outputs that still resolve packages outside the bundle. */
export function findExternalImports(metafile: EsbuildMetafile): string[] {
  const violations: string[] = []
  for (const [output, info] of Object.entries(metafile.outputs)) {
    for (const entry of info.imports ?? []) {
      if (entry.external && !isNodeBuiltin(entry.path)) {
        violations.push(`${output}: external import "${entry.path}" (${entry.kind})`)
      }
    }
  }
  return violations
}

/** Violations for dependency fields a package manager would install for hosts. */
export function findPackagedRuntimeDependencies(manifest: DependencyManifest): string[] {
  const violations: string[] = []
  for (const field of INSTALLED_FIELDS) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      violations.push(`${field}: ${name}`)
    }
  }
  return violations.sort()
}

function main(argv: string[]): void {
  const violations: string[] = []
  for (const metafilePath of argv) {
    const metafile = JSON.parse(readFileSync(metafilePath, 'utf-8')) as EsbuildMetafile
    violations.push(...findExternalImports(metafile))
  }
  const manifestPath = path.resolve(import.meta.dirname ?? '.', '..', 'package.json')
  violations.push(...findPackagedRuntimeDependencies(JSON.parse(readFileSync(manifestPath, 'utf-8'))))

  if (violations.length > 0) {
    console.error('check-bundle-deps: plugin install would materialize dependencies:')
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log(`check-bundle-deps: OK (${argv.length} metafile(s), no external imports, no packaged dependencies)`)
}

const ROOT = path.resolve(import.meta.dirname ?? '.', '..')

/** Violations for a THIRD-PARTY-NOTICES.md that diverged from the bundles. */
export function findNoticeViolations(
  noticesMarkdown: string,
  metafiles: InputsMetafile[],
  readPackage: (packageDir: string) => { version: string; license?: string } | null
): string[] {
  const byKey = new Map<string, { name: string; version: string; license: string }>()
  for (const metafile of metafiles) {
    for (const pkg of collectBundledPackages(metafile, readPackage)) {
      const key = `${pkg.name}@${pkg.version}`
      if (!byKey.has(key)) byKey.set(key, { name: pkg.name, version: pkg.version, license: pkg.license })
    }
  }

  // Greedy match splits at the last "@", so scoped names stay intact.
  const listed = new Set(
    [...noticesMarkdown.matchAll(/^- (\S+)@(\S+) \(([^)]+)\)$/gm)].map((m) => `${m[1]}@${m[2]}`)
  )
  const violations: string[] = []
  for (const pkg of byKey.values()) {
    const key = `${pkg.name}@${pkg.version}`
    if (!listed.has(key)) violations.push(`${key} is bundled but missing from THIRD-PARTY-NOTICES.md`)
    if (pkg.license === 'UNKNOWN') violations.push(`${key} has no license classification`)
  }
  for (const entry of listed) {
    if (![...byKey.keys()].includes(entry)) {
      violations.push(`${entry} is listed in THIRD-PARTY-NOTICES.md but is not bundled`)
    }
  }
  return violations
}

function checkNotices(metafiles: string[]): void {
  const noticesPath = path.join(ROOT, 'dist', 'THIRD-PARTY-NOTICES.md')
  if (!existsSync(noticesPath)) {
    console.error('check-bundle-deps: dist/THIRD-PARTY-NOTICES.md is missing; run `npm run compile` first')
    process.exit(1)
  }
  const readPackage = (packageDir: string) => {
    const manifestPath = path.join(ROOT, packageDir, 'package.json')
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
  const parsed = metafiles.map(
    (metaPath) => JSON.parse(readFileSync(path.resolve(ROOT, metaPath), 'utf-8')) as InputsMetafile
  )
  const violations = findNoticeViolations(readFileSync(noticesPath, 'utf-8'), parsed, readPackage)
  if (violations.length > 0) {
    console.error('check-bundle-deps: third-party notices are out of sync:')
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log(`check-bundle-deps: OK (THIRD-PARTY-NOTICES.md matches the bundled packages)`)
}

if (import.meta.main || import.meta.filename === path.resolve(process.argv[1] ?? '')) {
  const argv = process.argv.slice(2)
  const noticesMode = argv[0] === '--notices'
  const metafiles = noticesMode ? argv.slice(1) : argv
  const target = noticesMode ? checkNotices : main
  if (metafiles.length > 0) {
    target(metafiles)
  } else {
    const discovered = readdirSync(path.join(ROOT, 'meta'))
      .filter((file) => file.endsWith('.meta.json'))
      .map((file) => `meta/${file}`)
    target(discovered)
  }
}
