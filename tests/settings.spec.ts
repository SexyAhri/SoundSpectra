import { test, expect } from '@playwright/test'

test('source effect renders actual pixels, source parameters persist, and silence clears the preview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await expect(page.getByRole('switch', { name: '显示到桌面' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '调整桌面位置' })).toBeDisabled()
  const alphaPixels = () => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const gl = canvas.getContext('webgl2')!
    return new Promise<number>((resolve) => requestAnimationFrame(() => {
      const pixels = new Uint8Array(canvas.width * canvas.height * 4)
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      let visible = 0
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 8) visible++
      resolve(visible)
    }))
  })
  await expect.poll(alphaPixels).toBeGreaterThan(100)
  await page.screenshot({ path: 'artifacts/settings-desktop.png', fullPage: true })
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  const opacity = page.getByRole('slider', { name: '不透明度', exact: true })
  await opacity.focus(); await opacity.press('ArrowRight')
  await expect(opacity).toHaveAttribute('aria-valuenow', '86')
  const speed = page.getByRole('slider', { name: '弹球速度', exact: true })
  await speed.focus(); await speed.press('ArrowLeft')
  await expect(speed).toHaveAttribute('aria-valuenow', '4.9')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toHaveAttribute('aria-valuenow', '86')
  await expect(page.getByRole('slider', { name: '弹球速度', exact: true })).toHaveAttribute('aria-valuenow', '4.9')
  await page.getByRole('switch', { name: '模拟预览' }).click()
  await expect(page.getByText('等待音乐播放', { exact: true })).toBeVisible()
  await expect.poll(alphaPixels, { timeout: 5000 }).toBe(0)
  expect(errors).toEqual([])
})

test('width changes preserve the center after full width, and defaults can be restored', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.getByRole('tab', { name: '位置', exact: true }).click()
  await page.getByRole('slider', { name: '宽度', exact: true }).focus()
  await page.keyboard.press('End')
  await expect(page.getByRole('slider', { name: '宽度', exact: true })).toHaveAttribute('aria-valuenow', '100')
  await expect(page.getByRole('slider', { name: '距左侧', exact: true })).toHaveAttribute('aria-valuenow', '0')
  const width = page.getByRole('slider', { name: '宽度', exact: true })
  await width.press('Home')
  await expect(width).toHaveAttribute('aria-valuenow', '20')
  await expect(page.getByRole('slider', { name: '距左侧', exact: true })).toHaveAttribute('aria-valuenow', '40')
  const centered = await page.locator('.preview-spectrum').evaluate(element => {
    const effect = element.getBoundingClientRect()
    const preview = element.parentElement!.getBoundingClientRect()
    return Math.abs(effect.left + effect.width / 2 - preview.left - preview.width / 2)
  })
  expect(centered).toBeLessThan(1)
  await expect(page.getByRole('slider', { name: '距顶部', exact: true })).toHaveAttribute('aria-valuenow', '70')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '位置', exact: true }).click()
  await expect(page.getByRole('slider', { name: '距左侧', exact: true })).toHaveAttribute('aria-valuenow', '40')
  await page.getByRole('button', { name: '恢复中下部位置' }).click()
  await expect(page.getByRole('slider', { name: '宽度', exact: true })).toHaveAttribute('aria-valuenow', '76')
  await expect(page.getByRole('slider', { name: '距左侧', exact: true })).toHaveAttribute('aria-valuenow', '12')
})

test('failed persistence stays visible and a retry preserves the edit', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Object.defineProperty(window, '__restoreStorage', { value: () => { Storage.prototype.setItem = original } })
    Storage.prototype.setItem = () => { throw new DOMException('磁盘空间不足', 'QuotaExceededError') }
  })
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('slider', { name: '不透明度', exact: true }).focus()
  await page.keyboard.press('Home')
  await expect(page.getByRole('alert')).toContainText('磁盘空间不足')
  await expect(page.getByText('保存失败', { exact: true })).toBeVisible()
  await page.evaluate(() => (window as unknown as { __restoreStorage: () => void }).__restoreStorage())
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.reload()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toHaveAttribute('aria-valuenow', '10')
})

test('narrow layout remains reachable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('button', { name: '恢复当前灯效参数' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '恢复当前灯效参数' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  expect(overflow).toBe(false)
  await page.screenshot({ path: 'artifacts/settings-mobile.png', fullPage: true })
})

test('desktop layout keeps scrolling inside panes', async ({ page }) => {
  await page.goto('/')
  const layout = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: innerHeight,
    width: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }))
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight)
  expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth)
})

test('corrupted settings can be backed up and recovered', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('soundspectra.settings.v1', '{broken'))
  await page.reload()
  await expect(page.getByText('设置读取失败', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '备份并恢复默认设置' }).click()
  await expect(page.getByText('已保存到此浏览器')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1.backup'))).toBe('{broken')
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(page.getByRole('slider', { name: '不透明度', exact: true })).toHaveAttribute('aria-valuenow', '85')
  await expect(page.getByRole('slider', { name: '弹球速度', exact: true })).toHaveAttribute('aria-valuenow', '5')
})
