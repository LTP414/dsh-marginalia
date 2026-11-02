import { expect, test } from '../fixtures/dsh'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { startE2EHost } from '../support/host'
import {
  askSide,
  bubbleAnswer,
  chatFlow,
  closeHistory,
  composer,
  latestBubble,
  openApp,
  openHistory,
  waitForBubbleStatus,
} from '../support/ui'

const OUT = join(process.cwd(), 'docs', 'assets', 'screenshots')

test.skip(process.env.E2E_SCREENSHOTS !== '1', 'set E2E_SCREENSHOTS=1 to regenerate README screenshots')

async function seedDemo(page: Parameters<typeof openApp>[0]): Promise<void> {
  const input = composer(page)
  await input.click()
  await input.fill('We need to notify a partner when an order ships. Queue or webhook?')
  await input.press('Enter')
  await expect(chatFlow(page)).toContainText('order event on a queue', { timeout: 20_000 })
  await expect(chatFlow(page)).toContainText('Usage', { timeout: 20_000 })
}

async function askDemo(page: Parameters<typeof openApp>[0], question: string): Promise<void> {
  const input = composer(page)
  await input.click()
  await input.fill('/btw')
  const option = page.getByRole('option').filter({ hasText: 'btw' })
  await expect(option).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(input).toContainText('/btw')
  await page.keyboard.type(question)
  await page.keyboard.press('Enter')
  await expect(latestBubble(page)).toBeVisible({ timeout: 15_000 })
}

test('capture README screenshots in light and dark themes', async ({ page, context, host }) => {
  mkdirSync(OUT, { recursive: true })
  await openApp(page, host)
  await seedDemo(page)

  // 1. Slash menu with the real /btw candidate.
  const input = composer(page)
  await input.click()
  await input.fill('/btw')
  await expect(page.getByRole('option').filter({ hasText: 'btw' })).toBeVisible()
  await page.screenshot({ path: join(OUT, 'btw-menu.png'), caret: 'hide', animations: 'disabled' })

  // 2. Pick the candidate, type the question, catch the answer mid-stream.
  await page.keyboard.press('Enter')
  await page.keyboard.type("What's the main trade-off?")
  await page.keyboard.press('Enter')
  const bubble = latestBubble(page)
  const answer = bubbleAnswer(bubble)
  await expect.poll(async () => (await answer.innerText()).length, { timeout: 10_000 }).toBeGreaterThan(40)
  await expect(bubble).toHaveAttribute('data-status', 'running')
  await page.screenshot({ path: join(OUT, 'btw-streaming.png'), caret: 'hide', animations: 'disabled' })

  await waitForBubbleStatus(bubble, 'complete')
  await bubble.getByRole('button', { name: 'Follow up' }).click()
  const follow = bubble.getByRole('textbox')
  await follow.fill('Which would you start with?')
  await follow.press('Enter')
  await waitForBubbleStatus(latestBubble(page), 'complete')

  // 3. Light-theme topic history with two turns.
  const panel = await openHistory(page)
  await panel.screenshot({ path: join(OUT, 'btw-history.png'), animations: 'disabled' })
  await closeHistory(page)

  // 4. Dark-theme history. The product uses the real ui-theme preference, not
  //    a colorScheme emulation, so the screenshot exercises the dark tokens.
  const darkHost = await startE2EHost({ theme: 'dark', demo: true })
  try {
    const darkPage = await context.newPage()
    await openApp(darkPage, darkHost)
    await seedDemo(darkPage)
    await askDemo(darkPage, "What's the main trade-off?")
    const darkBubble = latestBubble(darkPage)
    await waitForBubbleStatus(darkBubble, 'complete')
    await darkBubble.getByRole('button', { name: 'Follow up' }).click()
    const darkFollow = darkBubble.getByRole('textbox')
    await darkFollow.fill('Which would you start with?')
    await darkFollow.press('Enter')
    await waitForBubbleStatus(latestBubble(darkPage), 'complete')
    const darkPanel = await openHistory(darkPage)
    await expect(darkPage.locator('body')).toHaveAttribute('data-ds-dark-theme', '')
    await darkPanel.screenshot({ path: join(OUT, 'btw-history-dark.png'), animations: 'disabled' })
  } finally {
    await darkHost.stop()
  }
})
