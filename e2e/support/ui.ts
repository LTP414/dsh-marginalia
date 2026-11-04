import { expect, type Locator, type Page } from '@playwright/test'
import type { E2EHost } from './host'

const COMPOSER_NAME = /Describe what you want|Message or run a task|Type a message/i

export function composer(page: Page): Locator {
  return page.getByRole('textbox', { name: COMPOSER_NAME })
}

export function chatFlow(page: Page): Locator {
  return page.locator('[data-slot="conversation.chat.flow"]')
}

export function chatNodes(page: Page): Locator {
  return page.locator('[data-chat-node-key]')
}

/**
 * Durable user/assistant rows only. `turn-process` and `turn-tail` appear a
 * frame later on a loaded CI worker, so comparing all Chat nodes is flaky and
 * does not answer the product question: did the side question add a
 * user/assistant message to the main transcript?
 */
export function transcriptContentNodes(page: Page): Locator {
  return page.locator('[data-chat-node-key*=":input-message"], [data-chat-node-key*=":assistant"]')
}

export function latestBubble(page: Page): Locator {
  return page.getByTestId('marginalia-bubble').last()
}

export function bubbleAnswer(bubble: Locator): Locator {
  return bubble.getByTestId('marginalia-answer')
}

export function historyPanel(page: Page): Locator {
  return page.getByTestId('marginalia-history')
}

export async function resumeApp(page: Page): Promise<void> {
  await page.waitForSelector('#root')
  const preview = page.getByRole('button', { name: 'Continue' })
  try {
    await preview.waitFor({ state: 'visible', timeout: 2_000 })
    await preview.click()
  } catch {
    // A profile without the preview notice (or a persisted dismissal) has no
    // Continue button; fall through to the composer.
  }
  await expect(composer(page)).toBeVisible()
}

export async function openApp(page: Page, host: E2EHost): Promise<void> {
  await page.goto(host.tokenUrl, { waitUntil: 'domcontentloaded' })
  await resumeApp(page)
}

export async function seedMain(page: Page): Promise<void> {
  const input = composer(page)
  await input.click()
  await input.fill('Seed the main conversation.')
  await input.press('Enter')
  await expect(chatFlow(page)).toContainText('Main answer accepted', { timeout: 15_000 })
  // The tail/usage row arrives after the text; wait for the turn to settle so
  // node-count baselines are stable on slow CI workers.
  await expect(chatFlow(page)).toContainText('Usage', { timeout: 15_000 })
}

/**
 * Pick /btw from the real slash menu, then type the argument into the claimed
 * composer. This is deliberately keyboard-driven: it exercises the same claim
 * path a user does and avoids Lexical internals.
 */
export async function askSide(page: Page, question: string): Promise<Locator> {
  const input = composer(page)
  await input.click()
  await input.fill('/btw')
  const option = page.getByRole('option').filter({ hasText: 'btw' })
  await expect(option).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(input).toContainText('/btw')
  await page.keyboard.type(question)
  await page.keyboard.press('Enter')
  const bubble = latestBubble(page)
  await expect(bubble).toBeVisible({ timeout: 15_000 })
  return bubble
}

export async function openHistory(page: Page): Promise<Locator> {
  await page.getByTestId('marginalia-history-button').click()
  const panel = historyPanel(page)
  await expect(panel).toBeVisible()
  return panel
}

export async function closeHistory(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(historyPanel(page)).toBeHidden()
}

export async function waitForBubbleStatus(bubble: Locator, status: string): Promise<void> {
  await expect(bubble).toHaveAttribute('data-status', status, { timeout: 20_000 })
}
