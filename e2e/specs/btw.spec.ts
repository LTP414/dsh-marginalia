import { expect, test } from '../fixtures/dsh'
import { rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  askSide,
  bubbleAnswer,
  chatNodes,
  closeHistory,
  composer,
  openApp,
  openHistory,
  resumeApp,
  seedMain,
  waitForBubbleStatus,
} from '../support/ui'

test.beforeEach(async ({ page, host }) => {
  await openApp(page, host)
})

test('shows /btw in the slash menu, streams, and leaves the main transcript untouched', async ({ page, host }) => {
  await seedMain(page)
  const before = await chatNodes(page).count()

  const bubble = await askSide(page, '[slow] Explain the margin')
  await expect(bubble).toHaveAttribute('data-status', 'running')
  const answer = bubbleAnswer(bubble)
  await expect.poll(async () => (await answer.innerText()).length, { timeout: 10_000 }).toBeGreaterThan(5)
  // The fork seed is inherited history; the bubble must not surface the parent answer.
  await expect(answer).not.toContainText('Main answer accepted')
  const first = (await answer.innerText()).length
  // Web-first polling instead of a fixed sleep: the answer must grow.
  await expect.poll(async () => (await answer.innerText()).length, { timeout: 10_000 }).toBeGreaterThan(first + 5)

  await waitForBubbleStatus(bubble, 'complete')
  await expect(answer).toContainText('This is a slow side answer')
  await expect.poll(() => archivedChild(host.home, '[slow] Explain the margin'), { timeout: 10_000 }).toBe(true)
  expect(await chatNodes(page).count()).toBe(before)
  await expect(chatFlowText(page)).not.toContainText('[slow] Explain the margin')
})

test('Stop keeps the partial answer and the history row is Cancelled', async ({ page }) => {
  await seedMain(page)
  const bubble = await askSide(page, '[slow] Stop this answer')
  const answer = bubbleAnswer(bubble)
  await expect.poll(async () => (await answer.innerText()).length, { timeout: 10_000 }).toBeGreaterThan(5)
  // The fork seed is inherited history; the bubble must not surface the parent answer.
  await expect(answer).not.toContainText('Main answer accepted')
  const partial = await answer.innerText()

  await page.getByRole('button', { name: 'Stop answering' }).click()
  await waitForBubbleStatus(bubble, 'cancelled')
  const kept = await answer.innerText()
  expect(kept.length).toBeGreaterThan(0)
  expect(kept.startsWith(partial) || partial.startsWith(kept)).toBe(true)

  const panel = await openHistory(page)
  await expect(panel).toContainText('Cancelled')
  await expect(panel).toContainText(kept.slice(0, Math.min(18, kept.length)))
  await closeHistory(page)
})

test('a follow-up creates a second turn in the same topic', async ({ page }) => {
  await seedMain(page)
  const first = await askSide(page, 'Why B?')
  await waitForBubbleStatus(first, 'complete')

  await first.getByRole('button', { name: 'Follow up' }).click()
  const follow = first.getByRole('textbox')
  await follow.fill('And then?')
  await follow.press('Enter')

  const second = page.getByTestId('marginalia-bubble').last()
  await expect(second).not.toBe(first)
  await waitForBubbleStatus(second, 'complete')
  await expect(bubbleAnswer(second)).toContainText('Side answer: And then?')

  const panel = await openHistory(page)
  await expect(panel).toContainText('2 turns')
  await expect(panel).toContainText('And then?')
  await closeHistory(page)
})

test('reload restores history and does not resend a running question', async ({ page, host }) => {
  await seedMain(page)
  const bubble = await askSide(page, 'Persist this answer')
  await waitForBubbleStatus(bubble, 'complete')
  const answer = await bubbleAnswer(bubble).innerText()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await resumeApp(page)
  await expect(page.getByTestId('marginalia-bubble')).toHaveCount(0)
  await expect(page.getByText('Seed the main conversation.')).toBeVisible()

  const panel = await openHistory(page)
  await expect(panel).toContainText('Persist this answer')
  await expect(panel).toContainText(answer.slice(0, 24))
  await closeHistory(page)
})

test('read-only guard rejects a forced tool call and the file is untouched', async ({ page, host }) => {
  await seedMain(page)
  rmSync(host.toolPath, { force: true })
  const before = await chatNodes(page).count()

  const bubble = await askSide(page, '[tool] Please run the write')
  await waitForBubbleStatus(bubble, 'complete')
  await expect(bubbleAnswer(bubble)).toContainText('read-only guard blocked')
  expect(existsSync(host.toolPath)).toBe(false)
  expect(await chatNodes(page).count()).toBe(before)
})

test('inserts an answer into the composer without sending it', async ({ page }) => {
  await seedMain(page)
  const bubble = await askSide(page, 'Insert this')
  await waitForBubbleStatus(bubble, 'complete')
  const answer = await bubbleAnswer(bubble).innerText()
  const before = await chatNodes(page).count()
  await bubble.getByTestId('marginalia-insert').click()
  await expect(composer(page)).toContainText(answer)
  expect(await chatNodes(page).count()).toBe(before)
})

test('works on a plain-HTTP non-secure origin without crypto.randomUUID', async ({ page, host }) => {
  test.skip(!host.insecure, 'no non-loopback IPv4 interface available')
  expect(await page.evaluate(() => typeof globalThis.crypto?.randomUUID)).toBe('undefined')

  await seedMain(page)
  const bubble = await askSide(page, 'Why on HTTP?')
  await waitForBubbleStatus(bubble, 'complete')
  await expect(bubbleAnswer(bubble)).toContainText('Side answer: Why on HTTP?')
})

function chatFlowText(page: Parameters<typeof chatNodes>[0]) {
  return page.locator('[data-slot="conversation.chat.flow"]')
}

/** Read the real sidecar/workspace domains to prove the child was archived. */
function archivedChild(home: string, question: string): boolean {
  try {
    const topics = JSON.parse(readFileSync(join(home, 'storages', 'marginalia.json'), 'utf8'))
    const workspace = JSON.parse(readFileSync(join(home, 'storages', 'workspace.json'), 'utf8'))
    const topic = Object.values(topics.tables.topics as Record<string, any>)
      .find(row => row.turns?.some((turn: any) => turn.question === question))
    const child = topic?.turns?.find((turn: any) => turn.question === question)?.childSessionId
    return typeof child === 'string' && (workspace.global?.archivedSessionIds ?? []).includes(child)
  } catch {
    return false
  }
}
