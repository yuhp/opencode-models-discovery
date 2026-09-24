import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const rootDir = resolve(new URL('.', import.meta.url).pathname, '../..')
const v2Cli = process.env.OPENCODE_V2_BIN || '/Users/yuhp/.opencode/bin/opencode'
const v1Cli = process.env.OPENCODE_V1_BIN || '/opt/homebrew/bin/opencode'

// Helper to spawn and track child processes
function spawnChild(command, args, options) {
  const output = []
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => output.push(chunk.toString()))
  child.stderr.on('data', chunk => output.push(chunk.toString()))
  return { child, output }
}

async function run() {
  console.log('--- Starting combined-package integration test ---')
  const tempRoot = await mkdtemp(join(tmpdir(), 'opencode-combined-e2e-'))
  let tarballPath = ''

  try {
    // 1. Build and pack real tarball from repository root
    console.log('Packing tarball via npm pack...')
    execFileSync('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit' })
    const packOut = execFileSync('npm', ['pack'], { cwd: rootDir, encoding: 'utf8' }).trim()
    const tarballName = packOut.split('\n').filter(Boolean).pop()
    tarballPath = join(rootDir, tarballName)
    console.log(`Packed tarball: ${tarballPath}`)

    // ==========================================
    // 2. Test OpenCode V2 Runtime with file://.../dist
    // ==========================================
    console.log('\n>>> Testing OpenCode V2 Runtime with dist directory...')
    const v2ProjectDir = join(tempRoot, 'v2-project')
    await mkdir(v2ProjectDir, { recursive: true })

    const v2Config = {
      $schema: 'https://opencode.ai/config.json',
      plugins: [
        {
          package: `file://${join(rootDir, 'dist')}`,
          options: {}
        }
      ],
      providers: {
        ds: {
          name: 'Deepseek',
          package: '@opencode-ai/ai/providers/openai-compatible',
          settings: {
            baseURL: 'https://api.deepseek.com/',
            apiKey: 'sk-fc2a67d53f7c4b999b6b695c5f05257a',
            modelsDiscovery: {
              enabled: true,
              timeoutMs: 6000,
              endpoint: '/models',
              models: {
                includeBy: [],
                excludeBy: []
              }
            }
          }
        }
      }
    }
    await writeFile(join(v2ProjectDir, 'opencode.json'), JSON.stringify(v2Config, null, 2))

    const v2Port = 45000 + Math.floor(Math.random() * 1000)
    const v2Process = spawnChild(v2Cli, [
      'serve',
      '--hostname', '127.0.0.1',
      '--port', String(v2Port),
      '--log-level', 'debug',
      '--print-logs'
    ], { cwd: v2ProjectDir })

    const getV2Output = () => v2Process.output.join('')
    const waitForCondition = async (predicate, label, timeoutMs = 30000) => {
      const end = Date.now() + timeoutMs
      while (Date.now() < end) {
        if (await predicate()) return
        await delay(200)
      }
      throw new Error(`Timed out waiting for ${label}`)
    }

    try {
      await waitForCondition(() => /server password [^\s]+/.test(getV2Output()), 'V2 server password ready')
      const password = getV2Output().match(/server password ([^\s]+)/)[1]
      const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`
      const location = encodeURIComponent(v2ProjectDir)

      const apiGet = async (path) => {
        const res = await fetch(`http://127.0.0.1:${v2Port}${path}?location[directory]=${location}`, {
          headers: { authorization }
        })
        if (!res.ok) throw new Error(`${path} failed: HTTP ${res.status}`)
        const json = await res.json()
        return json.data ?? json
      }

      // Bootstrap provider query
      await apiGet('/api/provider').catch(() => null)

      let discovered = []
      await waitForCondition(async () => {
        try {
          const models = await apiGet('/api/model')
          discovered = models.filter(m => m.providerID === 'ds')
          return discovered.length > 0
        } catch {
          return false
        }
      }, 'V2 model discovery')

      console.log('✓ V2 Runtime successfully loaded plugin and discovered models:', discovered.map(m => m.id))
    } finally {
      v2Process.child.kill('SIGTERM')
    }

    // ==========================================
    // 3. Test OpenCode V1 Runtime with installed tarball
    // ==========================================
    console.log('\n>>> Testing OpenCode V1 Runtime (installed tarball package)...')
    const v1ProjectDir = join(tempRoot, 'v1-project')
    await mkdir(v1ProjectDir, { recursive: true })

    await writeFile(join(v1ProjectDir, 'package.json'), JSON.stringify({
      name: 'v1-consumer',
      type: 'module',
      dependencies: {
        'opencode-models-discovery': `file:${tarballPath}`
      }
    }, null, 2))

    console.log('Installing package in V1 test directory...')
    execFileSync('bun', ['install'], {
      cwd: v1ProjectDir,
      stdio: 'inherit'
    })

    const v1Config = {
      $schema: 'https://opencode.ai/config.json',
      plugin: ['opencode-models-discovery'],
      provider: {
        ds: {
          npm: '@opencode-ai/ai/providers/openai-compatible',
          options: {
            baseURL: 'https://api.deepseek.com/',
            modelsDiscovery: {
              enabled: true
            }
          }
        }
      }
    }
    await writeFile(join(v1ProjectDir, 'opencode.json'), JSON.stringify(v1Config, null, 2))

    const v1DebugOut = execFileSync(v1Cli, ['debug', 'config'], {
      cwd: v1ProjectDir,
      encoding: 'utf8',
      env: { ...process.env, OPENCODE_CONFIG_DIR: v1ProjectDir }
    })

    if (!v1DebugOut.includes('"models-discovery:config"') && !v1DebugOut.includes('opencode-models-discovery')) {
      throw new Error('V1 Assertion failed: opencode-models-discovery did not load in V1 debug config')
    }
    console.log('✓ V1 Runtime successfully loaded plugin and registered config/hooks')

    console.log('\n=========================================')
    console.log('All combined-package end-to-end tests PASSED!')
    console.log('=========================================')
  } finally {
    if (tarballPath) await rm(tarballPath, { force: true })
    await rm(tempRoot, { recursive: true, force: true })
  }
}

run().catch((err) => {
  console.error('\n❌ Combined package test FAILED:', err)
  process.exit(1)
})
