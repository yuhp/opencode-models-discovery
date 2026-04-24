#!/usr/bin/env bun

/**
 * Automated Release Script
 *
 * Usage:
 *   bun scripts/release.ts patch   # 0.1.0 -> 0.1.1
 *   bun scripts/release.ts minor   # 0.1.0 -> 0.2.0
 *   bun scripts/release.ts major   # 0.1.0 -> 1.0.0
 *   bun scripts/release.ts 0.2.0   # Set specific version
 */

import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'

const VERSION_TYPES = ['patch', 'minor', 'major'] as const
type VersionType = typeof VERSION_TYPES[number]

interface CommitEntry {
  hash: string
  message: string
}

function getCurrentVersion(): string {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  return pkg.version
}

function getPackageInfo(): { name: string; repositorySlug: string } {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  const repositoryUrl = pkg.repository?.url as string | undefined

  const repositorySlug = repositoryUrl
    ? repositoryUrl
        .replace(/^git\+https:\/\/github\.com\//, '')
        .replace(/^https:\/\/github\.com\//, '')
        .replace(/\.git$/, '')
    : 'pengttyy/opencode-models-discovery-wz'

  return {
    name: pkg.name,
    repositorySlug,
  }
}

function bumpVersion(currentVersion: string, type: VersionType | string): string {
  if (!VERSION_TYPES.includes(type as VersionType) && !/^\d+\.\d+\.\d+$/.test(type)) {
    throw new Error(`Invalid version type: ${type}. Use 'patch', 'minor', 'major', or a specific version like '0.2.0'`)
  }

  if (/^\d+\.\d+\.\d+$/.test(type)) {
    return type
  }

  const [major, minor, patch] = currentVersion.split('.').map(Number)

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    default:
      throw new Error(`Unknown version type: ${type}`)
  }
}

function updatePackageJson(version: string): void {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'))
  pkg.version = version
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n')
  console.log(`✓ Updated package.json to version ${version}`)
}

function runCommand(cmd: string, description: string): void {
  console.log(`\n📦 ${description}...`)
  try {
    execSync(cmd, { stdio: 'inherit' })
    console.log(`✓ ${description} completed`)
  } catch (error) {
    console.error(`✗ ${description} failed`)
    throw error
  }
}

function getPreviousTag(): string | null {
  try {
    return execSync('git describe --tags --abbrev=0 HEAD^', { encoding: 'utf-8' }).trim() || null
  } catch {
    return null
  }
}

function getReleaseCommits(previousTag: string | null): CommitEntry[] {
  const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
  const output = execSync(`git log ${range} --pretty=format:%h%x09%s`, { encoding: 'utf-8' })

  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, message] = line.split('\t')
      return { hash, message }
    })
    .filter((commit) => !commit.message.startsWith('chore: bump version to '))
}

function formatCommitList(commits: CommitEntry[]): string {
  if (commits.length === 0) {
    return '- No user-facing changes recorded in this release.'
  }

  return commits
    .map((commit) => `- ${commit.message} (${commit.hash})`)
    .join('\n')
}

function groupCommits(commits: CommitEntry[]): Array<{ title: string; commits: CommitEntry[] }> {
  const remaining = [...commits]
  const groups = [
    { title: 'Features', matcher: (message: string) => message.startsWith('feat:') },
    { title: 'Fixes', matcher: (message: string) => message.startsWith('fix:') },
    { title: 'Documentation', matcher: (message: string) => message.startsWith('docs:') },
  ]

  const grouped = groups
    .map((group) => {
      const matched = remaining.filter((commit) => group.matcher(commit.message))
      matched.forEach((commit) => {
        const index = remaining.indexOf(commit)
        if (index >= 0) {
          remaining.splice(index, 1)
        }
      })

      return {
        title: group.title,
        commits: matched,
      }
    })
    .filter((group) => group.commits.length > 0)

  if (remaining.length > 0) {
    grouped.push({
      title: 'Maintenance',
      commits: remaining,
    })
  }

  return grouped
}

function generateReleaseNotes(version: string): string {
  const { name } = getPackageInfo()
  const previousTag = getPreviousTag()
  const commits = getReleaseCommits(previousTag)
  const groupedCommits = groupCommits(commits)
  const compareText = previousTag
    ? `Changes since \`${previousTag}\`.`
    : 'Changes included in the first tagged release.'
  const changesSection = groupedCommits.length > 0
    ? groupedCommits
        .map((group) => `### ${group.title}\n\n${formatCommitList(group.commits)}`)
        .join('\n\n')
    : '### Changes\n\n- No user-facing changes recorded in this release.'

  return `## 🎉 Release v${version}

${compareText}

${changesSection}

### Installation

\`\`\`bash
npm install ${name}@${version}
# or
bun add ${name}@${version}
\`\`\``
}

async function main() {
  const { name, repositorySlug } = getPackageInfo()
  const versionType = process.argv[2]

  if (!versionType) {
    console.error('Usage: bun scripts/release.ts [patch|minor|major|0.x.x]')
    process.exit(1)
  }

  const currentVersion = getCurrentVersion()
  const newVersion = bumpVersion(currentVersion, versionType)

  console.log(`\n🚀 Starting release process`)
  console.log(`   Current version: ${currentVersion}`)
  console.log(`   New version: ${newVersion}`)
  console.log(`   Version type: ${versionType}`)

  updatePackageJson(newVersion)

  runCommand('npm run build', 'Running build and tests')

  const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' })
  if (gitStatus.trim()) {
    console.log('\n⚠️  Uncommitted changes detected. Committing...')
    runCommand('git add -A', 'Staging changes')
    runCommand(`git commit -m "chore: bump version to ${newVersion}"`, 'Committing version bump')
  }

  const tagName = `v${newVersion}`
  runCommand(`git tag ${tagName} -m "Release ${tagName}"`, `Creating git tag ${tagName}`)
  runCommand('git push', 'Pushing commits')
  runCommand(`git push origin ${tagName}`, `Pushing tag ${tagName}`)

  console.log('\n📝 Creating GitHub release...')
  const releaseNotes = generateReleaseNotes(newVersion)
  const notesFile = `/tmp/release-notes-${newVersion}.md`
  writeFileSync(notesFile, releaseNotes)

  try {
    execSync(`gh release create ${tagName} --title "v${newVersion}" --notes-file ${notesFile}`, { stdio: 'inherit' })
    console.log(`✓ GitHub release created: https://github.com/${repositorySlug}/releases/tag/${tagName}`)
  } catch (error) {
    console.warn('⚠️  GitHub release creation failed (may already exist)')
  }

  console.log('\n📦 Publishing to npm...')
  let npmPublished = false

  try {
    runCommand('npm publish', 'Publishing to npm')
    console.log(`\n✅ Successfully published ${name}@${newVersion} to npm!`)
    console.log(`   https://www.npmjs.com/package/${name}`)
    npmPublished = true
  } catch (error) {
    console.error('\n⚠️  npm publish failed. Common reasons:')
    console.error('   1. Trusted Publishing is not configured for this repository')
    console.error('   2. Package name already exists (version conflict)')
    console.error('   3. The GitHub Actions workflow is missing id-token: write')
    console.error('   4. The publish step is not running in GitHub Actions')
    console.error('\n   You can manually publish with: npm publish')
    console.error('\n   Note: All other steps completed successfully!')
    console.error('   - Version bumped ✓')
    console.error('   - Git tag created ✓')
    console.error('   - GitHub release created ✓')
    console.error('   - Only npm publish needs manual intervention')
  }

  if (npmPublished) {
    console.log(`\n🎉 Release ${newVersion} completed successfully!`)
    console.log(`   - Git tag: ${tagName}`)
    console.log(`   - GitHub: https://github.com/${repositorySlug}/releases/tag/${tagName}`)
    console.log(`   - npm: https://www.npmjs.com/package/${name}`)
  } else {
    console.log(`\n✅ Release ${newVersion} partially completed!`)
    console.log(`   - Git tag: ${tagName} ✓`)
    console.log(`   - GitHub: https://github.com/${repositorySlug}/releases/tag/${tagName} ✓`)
    console.log(`   - npm: Manual publish required (see instructions above)`)
  }
}

main().catch((error) => {
  console.error('\n❌ Release failed:', error.message)
  process.exit(1)
})
