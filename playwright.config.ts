import { defineConfig, devices } from '@playwright/test'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Prefer an explicitly configured browser, then the headless shell already in
 * the Playwright cache. `npx playwright install chromium` works too; the
 * fallback simply returns undefined and lets Playwright resolve its default.
 */
function chromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  const cache = join(homedir(), '.cache', 'ms-playwright')
  if (!existsSync(cache)) return undefined
  const directories = readdirSync(cache).sort().reverse()
  for (const directory of directories) {
    if (!directory.startsWith('chromium_headless_shell-')) continue
    const root = join(cache, directory)
    for (const candidate of [
      join(root, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
      join(root, 'chrome-linux64', 'chrome-headless-shell'),
    ]) {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }
  for (const directory of directories) {
    if (!directory.startsWith('chromium-')) continue
    const candidate = join(cache, directory, 'chrome-linux64', 'chrome')
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return undefined
}

export default defineConfig({
  testDir: './e2e/specs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // The worker fixture owns an isolated Host; two workers are safe but one is
  // the default for CI stability because each worker pays the profile setup.
  workers: Number(process.env.E2E_WORKERS ?? 1),
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: '.e2e-runs/artifacts',
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Video needs the matching Playwright ffmpeg build; traces and screenshots
    // are the default failure artifacts so the suite runs with the cached browser.
    video: 'off',
    launchOptions: {
      ...(chromiumExecutable() ? { executablePath: chromiumExecutable() } : {}),
      args: ['--no-sandbox'],
    },
  },
  projects: [{ name: 'chromium' }],
})
