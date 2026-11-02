import { defineConfig, devices } from '@playwright/test'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function browserCaches(): string[] {
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH
  return [...new Set([
    configured,
    join(homedir(), '.cache', 'ms-playwright'),
    join(process.cwd(), '.playwright-browsers'),
  ].filter((value): value is string => Boolean(value)))]
}

function newest(cache: string, prefix: string): string | undefined {
  if (!existsSync(cache)) return undefined
  return readdirSync(cache).sort().reverse().find(name => name.startsWith(prefix))
}

/**
 * Prefer an explicit executable, then the Playwright cache. When neither is
 * found, return undefined and let Playwright resolve its own managed browser.
 */
function chromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  for (const cache of browserCaches()) {
    const shell = newest(cache, 'chromium_headless_shell-')
    if (shell) {
      for (const candidate of [
        join(cache, shell, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
        join(cache, shell, 'chrome-linux64', 'chrome-headless-shell'),
      ]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
      }
    }
    const full = newest(cache, 'chromium-')
    if (full) {
      const candidate = join(cache, full, 'chrome-linux64', 'chrome')
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return undefined
}

function firefoxExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE) return process.env.PLAYWRIGHT_FIREFOX_EXECUTABLE
  for (const cache of browserCaches()) {
    const directory = newest(cache, 'firefox-')
    if (!directory) continue
    for (const candidate of [
      join(cache, directory, 'firefox', 'firefox'),
      join(cache, directory, 'firefox', 'firefox-bin'),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  return undefined
}

function chromiumUse() {
  return {
    ...devices['Desktop Chrome'],
    launchOptions: {
      ...(chromiumExecutable() ? { executablePath: chromiumExecutable() } : {}),
      args: ['--no-sandbox'],
    },
  }
}

function firefoxUse() {
  return {
    ...devices['Desktop Firefox'],
    launchOptions: {
      ...(firefoxExecutable() ? { executablePath: firefoxExecutable() } : {}),
    },
  }
}

function screenshotProjects() {
  const projects = [
    {
      name: 'chromium',
      testIgnore: /(history-theme|screens)\.spec\.ts/,
      use: chromiumUse(),
    },
    {
      name: 'firefox',
      testIgnore: /(history-theme|screens)\.spec\.ts/,
      use: firefoxUse(),
    },
    {
      // The same history panel in DSH's dark theme; this is the regression
      // matrix for the white-on-white send label and the overlapping follow-up.
      name: 'chromium-dark',
      testMatch: /history-theme\.spec\.ts/,
      use: chromiumUse(),
    },
    {
      name: 'firefox-dark',
      testMatch: /history-theme\.spec\.ts/,
      use: firefoxUse(),
    },
  ]
  // Screenshot generation is explicit: it writes docs/assets and is not part
  // of the normal test matrix.
  if (process.env.E2E_SCREENSHOTS === '1') {
    projects.push({
      name: 'screens',
      testMatch: /screens\.spec\.ts/,
      use: chromiumUse(),
    })
  }
  return projects
}

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // The worker fixture owns an isolated Host; each worker pays profile setup,
  // so keep one worker by default for CI stability.
  workers: Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: '.e2e-runs/artifacts',
  use: {
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video needs the matching Playwright ffmpeg build; traces and screenshots
    // are the default failure artifacts so the suite runs with the cached browser.
    video: 'off',
  },
  projects: screenshotProjects(),
})
