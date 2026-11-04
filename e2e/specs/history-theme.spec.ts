import { expect, test } from '../fixtures/dsh'
import { askSide, bubbleAnswer, openApp, openHistory, seedMain, transcriptContentNodes, waitForBubbleStatus } from '../support/ui'

/**
 * Regression for the DSH dark-theme history panel:
 * - send buttons were white on white in Firefox dark theme
 * - the follow-up form was laid out over later turns once the detail scrolled
 *
 * Run only in the *-dark projects.
 */
test.beforeEach(async ({ page, host }) => {
  test.skip(host.theme !== 'dark', 'dark project only')
  await openApp(page, host)
})

test('dark history keeps send labels visible and the follow-up pinned below scrolling turns', async ({ page }) => {
  await expect(page.locator('body')).toHaveAttribute('data-ds-dark-theme', '')
  await seedMain(page)
  const first = await askSide(page, 'Why B?')
  await waitForBubbleStatus(first, 'complete')

  for (let index = 0; index < 5; index += 1) {
    const active = page.getByTestId('marginalia-bubble').last()
    await active.getByRole('button', { name: 'Follow up' }).click()
    const follow = active.getByRole('textbox')
    await follow.fill(`Follow-up ${index + 1}?`)
    await follow.press('Enter')
    await waitForBubbleStatus(page.getByTestId('marginalia-bubble').last(), 'complete')
  }
  const before = await transcriptContentNodes(page).count()

  const panel = await openHistory(page)
  const panelBackground = await panel.evaluate(el => getComputedStyle(el).backgroundColor)
  expect(panelBackground).not.toMatch(/rgba\([^)]*,\s*0\s*\)/)

  const ask = panel.getByRole('button', { name: 'Ask' })
  const follow = panel.getByRole('button', { name: 'Follow up' })
  await expect(ask).toBeVisible()
  await expect(follow).toBeVisible()
  await expect(ask).toContainText('Ask')
  await expect(follow).toContainText('Follow up')

  for (const button of [ask, follow]) {
    const style = await button.evaluate(el => {
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return { color: cs.color, background: cs.backgroundColor, opacity: cs.opacity, width: rect.width }
    })
    expect(style.opacity).toBe('1')
    expect(style.color).not.toBe(style.background)
    expect(style.width).toBeGreaterThan(40)
  }

  const turns = panel.getByTestId('marginalia-turns')
  const followForm = panel.locator('.mgl-history-follow')
  const overflow = await turns.evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }))
  expect(overflow.scrollHeight).toBeGreaterThan(overflow.clientHeight)

  const turnsBox = await turns.boundingBox()
  const followBox = await followForm.boundingBox()
  expect(turnsBox).not.toBeNull()
  expect(followBox).not.toBeNull()
  expect(followBox!.y).toBeGreaterThanOrEqual(turnsBox!.y + turnsBox!.height - 1)

  // Scrolling the transcript must not move or cover the pinned follow-up form.
  await turns.evaluate(el => { el.scrollTop = el.scrollHeight })
  await expect.poll(async () => {
    const box = await followForm.boundingBox()
    return Math.round(box?.y ?? -1)
  }).toBe(Math.round(followBox!.y))
  await expect(follow).toBeVisible()
  expect(await transcriptContentNodes(page).count()).toBe(before)
})
