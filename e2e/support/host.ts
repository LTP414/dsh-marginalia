/**
 * One isolated DSH Web Host per Playwright worker.
 *
 * It never touches the user's profile: DSH_HOME, XDG directories, the pnpm
 * cache, the workspace, and storage all live under `.e2e-runs/`. Authentication
 * uses the same launch-token exchange the real browser uses; no auth is
 * disabled and no owner peer is fabricated.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const RUNS = join(ROOT, '.e2e-runs')

export type E2ETheme = 'light' | 'dark'

export interface E2EHost {
  readonly theme: E2ETheme
  readonly tokenUrl: string
  readonly baseUrl: string
  readonly home: string
  readonly profile: string
  readonly workspace: string
  readonly toolPath: string
  readonly bindHost: string
  readonly insecure: boolean
  readonly port: number
  readonly logPath: string
  stop(): Promise<void>
}

function dshBin(): string {
  return process.env.DSH_BIN ?? 'dsh'
}

function baseEnv(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DSH_HOME: home,
    XDG_DATA_HOME: join(home, 'xdg-data'),
    XDG_CACHE_HOME: join(home, 'xdg-cache'),
    XDG_CONFIG_HOME: join(home, 'xdg-config'),
    npm_config_cache: join(home, 'npm-cache'),
    NO_COLOR: '1',
  }
}

function externalIPv4(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('127.')) return entry.address
    }
  }
  return undefined
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '0.0.0.0', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => port ? resolvePort(port) : reject(new Error('no free port')))
    })
  })
}

function runDsh(args: string[], env: NodeJS.ProcessEnv, cwd: string): void {
  execFileSync(dshBin(), args, { cwd, env, stdio: 'pipe', timeout: 120_000 })
}

function seedWorkspace(home: string, workspace: string): void {
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  mkdirSync(join(home, 'storages'), { recursive: true })
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      workspaceIds: [workspaceId],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: {
      workspaces: {
        [workspaceId]: {
          path: workspace,
          title: basename(workspace),
          sessionIds: [],
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  }, null, 2))
}

async function waitForUrl(proc: ChildProcess, logPath: string): Promise<string> {
  return new Promise((resolveUrl, reject) => {
    let buffer = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`DSH did not print a startup URL within 60s; see ${logPath}`))
    }, 60_000)
    const finish = (error: Error | undefined, url?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolveUrl(url!)
    }
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      buffer += text
      if (!settled) {
        const match = /dsh web: (https?:\/\/\S+)/.exec(buffer)
        if (match?.[1]) finish(undefined, match[1])
      }
      try { writeFileSync(logPath, text, { flag: 'a' }) } catch { /* best effort */ }
    }
    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.once('exit', code => finish(new Error(`DSH exited before readiness (code ${code}); see ${logPath}`)))
    proc.once('error', error => finish(error))
  })
}

export async function startE2EHost(options: { readonly real?: boolean; readonly theme?: E2ETheme } = {}): Promise<E2EHost> {
  mkdirSync(RUNS, { recursive: true })
  const home = mkdtempSync(join(RUNS, 'host-'))
  const workspace = join(home, 'workspace')
  mkdirSync(workspace, { recursive: true })
  const profile = join(home, 'profiles', 'e2e')
  const env = baseEnv(home)
  const logPath = join(home, 'host.log')

  // Initialize a custom profile from the shipped web template, then link the
  // plugin under test and the deterministic LLM fixture through the real
  // plugin manager (local links only; no registry dependency).
  runDsh(['--profile', 'e2e', '--from-default-profile', 'web', '--dump-config'], env, ROOT)
  runDsh(['plugin', '--profile', 'e2e', 'add', ROOT], env, ROOT)
  if (!options.real) {
    runDsh(['plugin', '--profile', 'e2e', 'add', join(ROOT, 'e2e', 'fixtures', 'fake-llm')], env, ROOT)
  }

  const provider = options.real ? (process.env.DSH_E2E_REAL_PROVIDER ?? 'deepseek-official') : 'fake'
  const model = options.real ? (process.env.DSH_E2E_REAL_MODEL ?? 'deepseek-flash') : 'fake-1'
  const theme = options.theme ?? 'light'
  writeFileSync(join(profile, 'cordis.patch.yml'), `# Generated by e2e/support/host.ts
- id: agent-default-model
  config:
    provider: ${provider}
    model: ${model}
- id: ui-theme
  config:
    preference: ${theme}
`)

  seedWorkspace(home, workspace)

  const port = await freePort()
  const bindHost = process.env.DSH_E2E_BIND_HOST || externalIPv4() || '127.0.0.1'
  const toolPath = join(workspace, 'tool-guard-target.txt')
  const launchEnv: NodeJS.ProcessEnv = {
    ...env,
    DSH_E2E_TOOL_PATH: toolPath,
    DSH_E2E_SLOW_DELAY_MS: process.env.DSH_E2E_SLOW_DELAY_MS ?? '110',
  }
  const proc = spawn(dshBin(), [
    '--profile', 'e2e',
    '--no-open',
    '--port', String(port),
    '--host', bindHost,
  ], {
    cwd: ROOT,
    env: launchEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const tokenUrl = await waitForUrl(proc, logPath)
  const baseUrl = `http://${bindHost.includes(':') ? `[${bindHost}]` : bindHost}:${port}`
  const insecure = bindHost !== '127.0.0.1' && bindHost !== '::1' && bindHost !== 'localhost'

  return {
    tokenUrl,
    baseUrl,
    theme,
    home,
    profile,
    workspace,
    toolPath,
    bindHost,
    insecure,
    port,
    logPath,
    async stop() {
      if (proc.exitCode !== null) return
      proc.kill('SIGTERM')
      await new Promise<void>((resolveExit) => {
        const timer = setTimeout(() => {
          try { proc.kill('SIGKILL') } catch { /* ignore */ }
          resolveExit()
        }, 8_000)
        proc.once('exit', () => { clearTimeout(timer); resolveExit() })
      })
    },
  }
}
