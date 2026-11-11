import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 })
  await page.goto('/tools/rail-keepsakes.html')
  await expect(page.locator('.rail-hanging')).toHaveCount(5)
})

test('five keepsake forms stay connected and readable across skins, backgrounds and small sizes', async ({ page }) => {
  test.setTimeout(90_000)
  const samples = page.getByRole('region', { name: '拾光绳材质示例' })
  for (const name of ['花间小径', '原木拾光', '紫藤轻垂', '秋枝来信']) {
    await page.getByRole('button', { name, exact: true }).click()
    for (const light of [false, true]) {
      await page.getByLabel('浅色背景', { exact: true }).setChecked(light)
      for (const small of [false, true]) {
        await page.getByLabel('小尺寸', { exact: true }).setChecked(small)
        const layout = await samples.evaluate(node => [...node.querySelectorAll<HTMLElement>('.rail-hanging:not([inert])')].map(hanging => {
          const card = hanging.querySelector<HTMLElement>('.rail-item')!
          const art = card.querySelector('.rail-paper-botanical')!
          const hole = card.querySelector('.rail-paper-hole')!.getBoundingClientRect()
          const tether = hanging.querySelector('.rail-tether')!.getBoundingClientRect()
          const label = card.querySelector<HTMLElement>('.rail-item-name, .rail-note-content')!
          const box = label.getBoundingClientRect(), paper = card.getBoundingClientRect()
          return { connected: hanging.classList.contains('rail-image') || Math.abs((hole.x + hole.width / 2) - (tether.x + tether.width / 2)) < 2,
            bounded: box.x >= paper.x - 2 && box.right <= paper.right + 2 && box.bottom <= paper.bottom + 2,
            font: parseFloat(getComputedStyle(label).fontSize), decorative: art.getAttribute('aria-hidden') ?? art.parentElement!.getAttribute('aria-hidden') }
        }))
        expect(layout.length).toBeGreaterThan(1)
        for (const item of layout) {
          expect(item.connected).toBe(true)
          expect(item.bounded).toBe(true)
          expect(item.font).toBeGreaterThanOrEqual(9)
          expect(item.decorative).toBe('true')
        }
        await page.mouse.move(0, 0)
        await samples.screenshot({ path: `artifacts/rail-keepsakes/${name}-${light ? 'light' : 'dark'}${small ? '-small' : ''}.png` })
      }
    }
  }
})

test('lifting shows its vacancy and insertion thread; cancel restores it without changing prints or order', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const group = page.locator('[data-rail-group="study-tools"]')
  const order = () => group.locator('.rail-hanging').evaluateAll(nodes => nodes.map(node => ({ id: (node as HTMLElement).dataset.railItem, print: node.querySelector<HTMLElement>('.rail-sway')!.dataset.paperPrint, length: (node.querySelector('.rail-sway') as HTMLElement).style.getPropertyValue('--rail-string-length') })))
  const before = await order()
  const source = group.locator('[data-rail-item="study-editor"] .rail-item')
  const target = group.locator('[data-rail-item="study-project"]')
  // Reduced-motion emulation no longer disables the product's entrance/sway.
  // Wait for entrance geometry, then approach the card before measuring it.
  await group.evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
  await source.hover()
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * .8, b.y + b.height / 2, { steps: 8 })
  await expect(group.locator('[data-dragging=true] .rail-slot-ghost')).toBeVisible()
  await expect(target).toHaveAttribute('data-reorder-side', 'after')
  await page.screenshot({ path: 'artifacts/rail-keepsakes/dragging.png' })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await order()).toEqual(before)
  await expect(group.locator('[data-dragging=true]')).toHaveCount(0)
  await expect(group.locator('.rail-popup, .rail-inline-notice')).toHaveCount(0)
})

test('collapsed groups retain the theme, count and keyboard expansion', async ({ page }) => {
  await page.getByRole('button', { name: '收起桌边常用', exact: true }).click()
  const group = page.locator('[data-rail-group="study-tools"]')
  await expect(group.locator('.rail-body')).toHaveCount(0)
  await expect(group.locator('.rail-folded-cord')).toBeVisible()
  await expect(group.locator('.rail-drag')).toContainText('03')
  await expect(group.locator('.rail-cord .rail-floral-cord')).toHaveCount(1)
  await group.screenshot({ path: 'artifacts/rail-keepsakes/collapsed.png' })
  await page.getByRole('button', { name: '展开桌边常用', exact: true }).press('Enter')
  await expect(group.locator('.rail-hanging')).toHaveCount(3)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(group).toHaveAttribute('data-breeze-active', 'true')
  await expect(group.locator('.rail-sway').first()).not.toHaveCSS('transform', 'none')
})
