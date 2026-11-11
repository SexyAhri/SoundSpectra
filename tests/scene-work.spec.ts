import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/scene-work.html')
  await expect(page.locator('[data-color]')).toBeVisible()
})

test('ordinary editing commits once and enabling transitions keeps the current scene', async ({ page }) => {
  const commits = await page.evaluate(() => {
    const p = (window as any).sceneWork; p.commits = []
    for (let i = 1; i <= 6; i++) p.update({ color: `#00000${i}` }, false)
    return p.commits
  })
  console.log('six ordinary edits:', commits.length, 'commits')
  expect(commits).toHaveLength(6)
  await page.evaluate(() => (window as any).sceneWork.update({}, true))
  await expect(page.locator('[data-color]')).toHaveAttribute('data-color', '#000006')
  await expect(page.locator('[data-color]')).not.toHaveAttribute('data-scene-transition')
})

test('rapid transitions, cancellation, reentry and missing animation support retain the latest request', async ({ page }) => {
  await page.evaluate(() => (window as any).sceneWork.update({}, true))
  await page.evaluate(() => (window as any).sceneWork.update({ color: '#112233' }))
  await expect(page.locator('[data-color]')).toHaveAttribute('data-scene-transition', 'outgoing')
  await page.evaluate(() => (window as any).sceneWork.update({ color: '#334455' }))
  await expect(page.locator('[data-color]')).toHaveAttribute('data-color', '#334455')
  await expect(page.locator('[data-color]')).not.toHaveAttribute('data-scene-transition')
  await page.evaluate(() => {
    const p = (window as any).sceneWork
    p.update({ color: '#445566' }); p.update({ color: '#556677' }, false)
    p.update({ color: '#667788' }, false); p.update({}, true)
  })
  await page.waitForTimeout(450)
  await expect(page.locator('[data-color]')).toHaveAttribute('data-color', '#667788')
  await expect(page.locator('[data-color]')).toHaveCSS('opacity', '1')
  await page.evaluate(() => {
    Element.prototype.animate = undefined as any
    ;(window as any).sceneWork.update({ color: '#778899' })
  })
  await expect(page.locator('[data-color]')).toHaveAttribute('data-color', '#778899')
})

test('unchanged mask geometry does not regenerate pixels and real geometry changes do', async ({ page }) => {
  const masks = await page.evaluate(() => {
    const p = (window as any).sceneWork; p.masks = 0
    for (let i = 0; i < 6; i++) p.cloneGeometry()
    return p.masks
  })
  console.log('six equivalent layouts:', masks, 'mask generations')
  expect(masks).toBe(0)
  await page.evaluate(() => (window as any).sceneWork.ambient({ ambientColor: '#abcdef', ambientAmount: 70 }))
  expect(await page.evaluate(() => (window as any).sceneWork.masks)).toBe(0)
  await page.evaluate(() => (window as any).sceneWork.ambient({ ambientBounds: { x: .1, y: .1, width: .8, height: .8 } }))
  expect(await page.evaluate(() => (window as any).sceneWork.masks)).toBe(1)
  await page.evaluate(() => (window as any).sceneWork.update({ masks: [{ id: 'test', bounds: { x: .1, y: .2, width: .3, height: .4 }, feather: .02 }] }))
  expect(await page.evaluate(() => (window as any).sceneWork.masks)).toBe(2)
  await page.evaluate(() => (window as any).sceneWork.update({ masks: [] }))
  expect(await page.evaluate(() => (window as any).sceneWork.masks)).toBe(3)
})

test('lyric avoidance reuses equal rectangles and searches again after a real move', async ({ page }) => {
  const work = await page.evaluate(() => {
    const p = (window as any).sceneWork; p.searches = 0
    p.searchBaseline(); const before = p.searches; p.searches = 0
    for (let i = 0; i < 6; i++) p.cloneObstacles()
    const after = p.searches; p.moveObstacle()
    return { before, after, moved: p.searches }
  })
  console.log('lyric placement candidate distances:', work)
  expect(work.before).toBeGreaterThan(0)
  expect(work.after).toBe(0)
  expect(work.moved).toBeGreaterThan(0)
})

test('rail popup updates commit once while exit retention and interrupted closing remain intact', async ({ page }) => {
  const commits = await page.evaluate(async () => {
    const p = (window as any).sceneWork; p.presenceCommits = 0
    for (let i = 0; i < 6; i++) { p.presence(`popup-${i}`); await new Promise(requestAnimationFrame) }
    return p.presenceCommits
  })
  console.log('six popup content updates:', commits, 'commits')
  expect(commits).toBe(6)
  const output = page.locator('.presence-work')
  await page.evaluate(() => (window as any).sceneWork.presence(null))
  await expect(output).toHaveText('popup-5')
  await page.evaluate(() => (window as any).sceneWork.presence('reopened'))
  await page.waitForTimeout(220)
  await expect(output).toHaveText('reopened')
  await page.evaluate(() => (window as any).sceneWork.presence(null))
  await expect(output).toHaveText('reopened')
  await expect(output).toHaveText('closed')
})
