import { expect, test } from '@playwright/test'

test('all five closed module choosers avoid layout work; open drawers coalesce events and release their candidate', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/tests/fixtures/drawer-work.html')
  const results = []
  for (const [panel, label] of [['scene', '灯效'], ['card', '卡片样式'], ['lyrics', '歌词编排'], ['wallpaper', '壁纸来源'], ['rail', '拾光绳皮肤']]) {
    await page.getByRole('button', { name: panel, exact: true }).click()
    const trigger = page.getByRole('button', { name: `更换${label}`, exact: true })
    await expect(trigger).toBeVisible()
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
    const closed = await page.evaluate(async () => {
      const probe = (window as any).drawerWork; probe.reads = 0
      for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('scroll'))
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      return probe.reads
    })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: `选择${label}`, exact: true })
    await expect(dialog).toBeVisible()
    if (panel === 'scene') {
      const canvas = dialog.locator('canvas')
      await expect(canvas).toHaveCount(1)
      await expect(canvas).toHaveAttribute('data-context-id', /.+/)
      const context = await canvas.getAttribute('data-context-id')
      await dialog.locator('.module-style-option').last().focus()
      await expect(canvas).toHaveCount(1)
      await expect(canvas).toHaveAttribute('data-context-id', context!)
      await dialog.locator('.module-style-option').first().focus()
      await expect(canvas).toHaveCount(1)
      await expect(canvas).toHaveAttribute('data-context-id', context!)
    }
    else await expect(dialog.locator('canvas')).toHaveCount(0)
    await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
    const opened = await page.evaluate(async () => {
      const probe = (window as any).drawerWork; probe.reads = 0
      for (let i = 0; i < 8; i++) window.dispatchEvent(new Event('scroll'))
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame)
      return probe.reads
    })
    results.push({ panel, closed, opened })
    await page.getByRole('button', { name: `关闭${label}选择`, exact: true }).click()
    await expect(page.locator('.module-live-candidate')).toHaveCount(0)
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('canvas')).toHaveCount(0)
  }
  console.log('layout reads for eight scroll events:', results)
  for (const result of results) {
    expect(result.closed, `${result.panel} closed`).toBe(0)
    expect(result.opened, `${result.panel} open`).toBeLessThanOrEqual(2)
  }
})
