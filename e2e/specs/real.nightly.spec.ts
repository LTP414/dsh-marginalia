/**
 * Nightly real-provider acceptance. It is skipped unless explicitly enabled:
 *
 *   DSH_E2E_REAL=1 DEEPSEEK_API_KEY=... npm run test:e2e:real
 *
 * The deterministic suite must stay fake-model only; this spec exists so a
 * release can exercise the same browser path against a real provider.
 */
import { expect, test } from '@playwright/test'
import { startE2EHost } from '../support/host'
import { askSide, bubbleAnswer, composer, resumeApp, waitForBubbleStatus } from '../support/ui'

test.skip(process.env.DSH_E2E_REAL !== '1', 'set DSH_E2E_REAL=1 to run the real-provider acceptance')
test.skip(!process.env.DEEPSEEK_API_KEY, 'DEEPSEEK_API_KEY is required for the real-provider acceptance')

test('real provider answers a /btw question in the browser', async ({ page }) => {
  test.slow()
  const host = await startE2EHost({ real: true })
  try {
    await page.goto(host.tokenUrl, { waitUntil: 'domcontentloaded' })
    await resumeApp(page)
    const input = composer(page)
    await input.click()
    await input.fill('Reply with exactly: main seeded.')
    await input.press('Enter')
    const bubble = await askSide(page, 'In one short sentence, what did the previous answer say?')
    await waitForBubbleStatus(bubble, 'complete')
    const answer = await bubbleAnswer(bubble).innerText()
    expect(answer.trim().length).toBeGreaterThan(0)
  } finally {
    await host.stop()
  }
})
