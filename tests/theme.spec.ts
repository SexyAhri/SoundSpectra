import { expect, test, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { railDefaults } from '../src/features/rail/model'

async function setup(page: Page, theme?: string) {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
  await page.addInitScript(({ settings, rail, theme }) => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
    if (!localStorage.getItem('soundspectra.rail.v1')) localStorage.setItem('soundspectra.rail.v1', JSON.stringify(rail))
    if (theme && !localStorage.getItem('soundspectra.theme')) localStorage.setItem('soundspectra.theme', theme)
  }, { settings: { ...defaults, regionVisible: false }, rail: { ...railDefaults, enabled: true, groups: [{ ...railDefaults.groups[0], items: [
    { id: 'note', kind: 'note', name: '午后记事', path: '', crop: 'cover', text: '慢一点，听一首歌。' },
    { id: 'app', kind: 'app', name: '记事本', path: 'C:/Windows/notepad.exe', crop: 'cover' },
  ] }] }, theme })
  await page.goto('/')
}
const openSettings = (page: Page) => page.getByRole('button', { name: '应用设置与更新', exact: true }).click()

test('theme persists independently of scenes and mounted items and supports keyboard selection', async ({ page }) => {
  await setup(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  const before = await page.evaluate(() => [localStorage.getItem('soundspectra.settings.v1'), localStorage.getItem('soundspectra.rail.v1')])
  await openSettings(page)
  const light = page.getByRole('radio', { name: '浅色', exact: true })
  await light.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(light).toHaveAttribute('aria-checked', 'true')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await openSettings(page)
  await light.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: '深色', exact: true })).toBeFocused()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.keyboard.press('End')
  await expect(page.getByRole('radio', { name: '跟随系统' })).toBeFocused()
  await expect(page.getByRole('radio', { name: '跟随系统' })).toHaveAttribute('aria-checked', 'true')
  expect(await page.evaluate(() => [localStorage.getItem('soundspectra.settings.v1'), localStorage.getItem('soundspectra.rail.v1')])).toEqual(before)
})

test('only system mode responds to operating system appearance changes', async ({ page }) => {
  await setup(page, 'system')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await openSettings(page)
  await page.getByRole('radio', { name: '深色', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('theme synchronizes across webviews while desktop windows stay transparent', async ({ page, context }) => {
  await setup(page)
  const overlay = await context.newPage()
  const rail = await context.newPage()
  await overlay.goto('/?window=overlay')
  await rail.goto('/?window=rail')
  await openSettings(page)
  await page.getByRole('radio', { name: '浅色', exact: true }).click()
  for (const view of [overlay, rail]) {
    await expect(view.locator('html')).toHaveAttribute('data-theme', 'light')
    for (const selector of ['html', 'body', '#root']) await expect(view.locator(selector)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  }
  await overlay.evaluate(() => localStorage.removeItem('soundspectra.theme'))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('radio', { name: '深色', exact: true })).toHaveAttribute('aria-checked', 'true')
})

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} semantic text pairs meet contrast and portals inherit the theme`, async ({ page }) => {
    await setup(page, theme)
    await expect(page.locator('.app-shell')).not.toHaveClass(/\bdark\b/)
    const pairs = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement)
      const luminance = (token: string) => {
        const hex = css.getPropertyValue(`--${token}`).trim().slice(1)
        const [r, g, b] = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        return r * .2126 + g * .7152 + b * .0722
      }
      return [
        ['foreground', 'background'], ['foreground', 'card'], ['muted-foreground', 'background'], ['muted-foreground', 'secondary'],
        ['muted-foreground', 'popover'], ['muted-foreground', 'accent'], ['primary', 'accent'], ['primary-foreground', 'primary'],
        ['destructive', 'danger-surface'], ['destructive-foreground', 'destructive'],
      ].map(([fg, bg]) => { const a = luminance(fg), b = luminance(bg); return { pair: `${fg}/${bg}`, contrast: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) } })
    })
    for (const { pair, contrast } of pairs) expect(contrast, pair).toBeGreaterThanOrEqual(4.5)
    await expect(page.getByRole('tab', { name: '外观', exact: true })).toHaveCSS('color', theme === 'light' ? 'rgb(92, 102, 110)' : 'rgb(168, 181, 191)')
    await page.getByRole('combobox', { name: '当前装饰区域' }).click()
    await expect(page.getByRole('listbox')).toHaveCSS('background-color', theme === 'light' ? 'rgb(253, 251, 247)' : 'rgb(41, 51, 60)')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '场景收藏', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCSS('background-color', theme === 'light' ? 'rgb(243, 241, 236)' : 'rgb(24, 30, 36)')
    await page.screenshot({ path: `artifacts/theme-${theme}-library.png` })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '场景收藏', exact: true })).toBeFocused()
  })

  test(`${theme} theme covers all workspace panels and compact settings`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await setup(page, theme)
    await page.screenshot({ path: `artifacts/theme-${theme}-workspace.png` })
    for (const name of ['歌词', '音乐卡片', '壁纸', '拾光绳']) {
      await page.getByRole('button', { name, exact: true }).click()
      if (name === '歌词') await page.getByRole('switch', { name: '显示桌面歌词' }).check()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: `artifacts/theme-${theme}-${name}.png` })
    }
    await page.getByRole('tab', { name: '添加', exact: true }).click()
    await page.getByRole('button', { name: '写便签', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '便签内容' })).toHaveCSS('color', theme === 'light' ? 'rgb(52, 60, 66)' : 'rgb(228, 232, 235)')
    await page.screenshot({ path: `artifacts/theme-${theme}-note-editor.png` })
    await openSettings(page)
    await page.screenshot({ path: `artifacts/theme-${theme}-settings.png` })
    await page.setViewportSize({ width: 390, height: 620 })
    await page.screenshot({ path: `artifacts/theme-${theme}-mobile.png` })
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '收起应用设置', exact: true })).toBeInViewport()
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await dialog.getByRole('button', { name: '收起应用设置', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  })
}
