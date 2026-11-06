import { expect, test } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => { if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings)) }, { ...defaults, regionVisible: false })
})

test('inactive rails leave other editors clear and preview gaps pass pointer input', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: '灯效', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.rail-layer')).toHaveCount(0)
  await page.getByRole('button', { name: '拾光绳', exact: true }).click()
  await expect(page.locator('.rail-layer')).toBeVisible()
  await expect(page.locator('.rail-placement')).toHaveCSS('pointer-events', 'none')
  expect(await page.locator('.rail-placement').evaluate(node => {
    const rect = node.getBoundingClientRect()
    return document.elementFromPoint(rect.x + rect.width / 2, rect.bottom - 2)?.closest('.rail-placement') === null
  })).toBe(true)
  await page.getByRole('button', { name: '遮罩', exact: true }).click()
  await expect(page.locator('.rail-layer')).toHaveAttribute('inert', '')
  await page.locator('.rail-header-actions > button').first().evaluate(node => {
    const rect = node.getBoundingClientRect()
    if (document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.rail-layer')) throw new Error('Inert rail intercepted mask input')
  })
})

test('rail references persist, reorder and move independently of music settings', async ({ page }) => {
  await page.goto('/#rail')
  await expect(page.locator('.rail-controls').getByRole('switch', { name: '显示桌面拾光绳' })).toBeDisabled()
  const before = await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1'))
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByText('输入本地路径预览布局', { exact: true }).click()
  for (const path of ['C:\\Apps\\Editor.exe', 'C:\\Work\\Project\\', 'C:\\Pictures\\Afternoon.jpg']) {
    await page.getByRole('textbox', { name: '挂件目标路径' }).fill(path)
    await page.getByRole('button', { name: '挂上去', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '挂件目标路径' })).toHaveValue('')
  }
  await expect(page.getByRole('button', { name: 'Editor，软件', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '挂件列表', exact: true }).click()
  await page.locator('.rail-control-select').filter({ hasText: 'Afternoon' }).press('Alt+ArrowUp')
  const getRail = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!))
  await expect.poll(async () => (await getRail()).groups[0].items.map((i: { name: string }) => i.name)).toEqual(['Editor', 'Afternoon', 'Project'])
  await page.getByRole('button', { name: 'Afternoon，图片', exact: true }).click()
  await page.getByRole('button', { name: '新建拾光绳', exact: true }).click()
  await expect.poll(async () => (await getRail()).groups.length).toBe(2)
  const destination = (await getRail()).groups[1].id
  await expect(page.locator('.rail-group-tabs > button[aria-pressed=true]')).toHaveText('新拾光绳0')
  await page.getByRole('button', { name: 'Afternoon，图片', exact: true }).click()
  await page.getByLabel('所在拾光绳', { exact: true }).selectOption(destination)
  await expect.poll(async () => (await getRail()).groups[1].items[0]?.name).toBe('Afternoon')
  await expect(page.getByLabel('所在拾光绳', { exact: true })).toHaveValue(destination)
  await page.reload()
  await page.getByRole('button', { name: 'Afternoon，图片', exact: true }).click()
  await page.getByLabel('显示名称', { exact: true }).fill('午后照片')
  await page.getByLabel('显示名称', { exact: true }).press('Enter')
  await expect(page.getByRole('button', { name: '午后照片，图片', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消挂载', exact: true }).click()
  await expect(page.getByRole('button', { name: '午后照片，图片', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1'))).toBe(before)
})

test('rail settings have one add chooser and compact management controls', async ({ page }) => {
  await page.goto('/#rail')
  const settings = await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1'))
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await expect(page.locator('.rail-controls .rail-add-choices > button')).toHaveCount(5)
  await expect(page.locator('.rail-controls .rail-add-actions')).toHaveCount(0)
  await page.getByRole('tab', { name: '布局', exact: true }).click()
  await expect(page.getByRole('button', { name: '搭配午后音乐卡片' })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.settings.v1'))).toBe(settings)
})

test('native actions remain honest and populated rails stay within the responsive workspace', async ({ page }) => {
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByText('输入本地路径预览布局', { exact: true }).click()
  await page.getByRole('textbox', { name: '挂件目标路径' }).fill('C:\\Apps\\Editor.exe')
  await page.getByRole('button', { name: '挂上去', exact: true }).click()
  const item = page.getByRole('button', { name: 'Editor，软件', exact: true })
  await item.dblclick()
  await expect(page.getByRole('alert')).toContainText('打开本地项目需要桌面客户端')
  await page.getByRole('button', { name: '关闭提示' }).click()
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.screenshot({ path: 'artifacts/rail-workspace-desktop.png' })
  for (const size of [{ width: 1440, height: 940 }, { width: 1000, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.getByRole('button', { name: '拾光绳', exact: true }).evaluateAll(elements => elements.some(element => (element as HTMLElement).offsetWidth > 0))).toBe(true)
  }
  await page.screenshot({ path: 'artifacts/rail-workspace-mobile.png', fullPage: true })
})

test('files, photos, folders, programs and shortcuts activate the system opener', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('soundspectra.rail.v1', JSON.stringify({ version: 1, enabled: false, groups: [{ id: 'apps', name: '系统打开验证', x: .07, y: .12, width: .86, collapsed: false, items: [
    { id: 'file', name: '文档', kind: 'file', path: 'C:\\Work\\记录.txt', crop: 'cover' },
    { id: 'photo', name: '照片', kind: 'image', path: 'C:\\Pictures\\照片.jpg', crop: 'cover' },
    { id: 'folder', name: '文件夹', kind: 'folder', path: 'C:\\Work\\', crop: 'cover' },
    { id: 'program', name: '程序', kind: 'app', path: 'C:\\Apps\\Editor.exe', crop: 'cover' },
    { id: 'shortcut', name: '快捷方式', kind: 'app', path: 'C:\\Users\\Public\\Desktop\\Editor.lnk', crop: 'cover' },
  ] }] })))
  await page.goto('/#rail')
  for (const name of ['文档，文件', '照片，图片', '文件夹，文件夹', '程序，软件', '快捷方式，软件']) {
    const item = page.getByRole('button', { name, exact: true })
    await item.click()
    await expect(page.getByRole('alert')).toContainText('打开本地项目需要桌面客户端')
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await item.press('Enter')
    await expect(page.getByRole('alert')).toContainText('打开本地项目需要桌面客户端')
    await page.getByRole('button', { name: '关闭提示', exact: true }).click()
    await item.click({ button: 'right' })
    await expect(page.locator('.rail-popup-menu')).toHaveCount(0)
    await item.press('Shift+F10')
    await expect(page.locator('.rail-popup-menu')).toHaveCount(0)
    await item.locator('..').locator('.rail-item-menu').click()
    await page.locator('.rail-popup-menu').getByRole('button', { name: '打开', exact: true }).click()
    await expect(page.locator('.rail-popup-menu').getByRole('alert')).toContainText('打开本地项目需要桌面客户端')
    await page.getByRole('button', { name: '关闭挂件面板', exact: true }).click()
    await expect(page.locator('.rail-popup-photo, .rail-popup-folder')).toHaveCount(0)
  }
})

test('unreadable rail configuration is retained and reported without resetting it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('soundspectra.rail.v1', '{bad-config'))
  await page.goto('/#rail')
  await expect(page.getByRole('alert')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('soundspectra.rail.v1'))).toBe('{bad-config')
})

test('mounting and unmounting animate while removed references immediately stop interacting', async ({ page }) => {
  await page.addInitScript(() => {
    const target = window as unknown as { railMotion: { exit: boolean; inert: boolean; frames: unknown }[] }
    target.railMotion = []
    const original = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      if (this instanceof HTMLElement && this.classList.contains('rail-hanging')) target.railMotion.push({ exit: this.classList.contains('rail-exiting'), inert: this.inert, frames })
      return original.call(this, frames, options)
    }
  })
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByText('输入本地路径预览布局', { exact: true }).click()
  for (const path of ['C:\\Apps\\First.exe', 'C:\\Apps\\Second.exe']) {
    await page.getByRole('textbox', { name: '挂件目标路径' }).fill(path)
    await page.getByRole('button', { name: '挂上去', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '挂件目标路径' })).toHaveValue('')
  }
  const motion = () => page.evaluate(() => (window as unknown as { railMotion: { exit: boolean; inert: boolean }[] }).railMotion)
  expect((await motion()).filter(value => !value.exit).length).toBeGreaterThanOrEqual(2)
  await page.getByRole('button', { name: 'First的操作', exact: true }).click()
  await page.locator('.rail-popup-menu').getByRole('button', { name: '取消挂载', exact: true }).click()
  await expect.poll(async () => (await motion()).some(value => value.exit && value.inert)).toBe(true)
  await expect(page.getByRole('button', { name: 'First，软件', exact: true })).toHaveCount(0)
  await expect(page.locator('.rail-exiting')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!).groups[0].items.map((item: { name: string }) => item.name))).toEqual(['Second'])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const count = (await motion()).length
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByText('输入本地路径预览布局', { exact: true }).click()
  await page.getByRole('textbox', { name: '挂件目标路径' }).fill('C:\\Apps\\Third.exe')
  await page.getByRole('button', { name: '挂上去', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Third，软件', exact: true })).toBeVisible()
  expect((await motion()).length).toBe(count)
})

test('expanded rail settings stay compact and wheel scrolling keeps the header in place', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('soundspectra.rail.v1', JSON.stringify({ version: 1, enabled: false, groups: [{ id: 'apps', name: '滚动验证', x: .07, y: .12, width: .86, collapsed: false, items: Array.from({ length: 48 }, (_, i) => ({ id: `item-${i}`, name: `软件 ${i + 1}`, kind: 'app', path: `C:\\Apps\\${'很长的目录'.repeat(30)}\\${i}.exe`, crop: 'cover' })) }] })))
  await page.goto('/#rail')
  for (const size of [{ width: 1440, height: 940 }, { width: 1000, height: 720 }]) {
    await page.setViewportSize(size)
    const pane = page.locator('.rail-settings-tabs > [role=tabpanel]:visible')
    await pane.evaluate(el => { el.scrollTop = 0 })
    const tabs = page.getByRole('tab', { name: '挂件列表', exact: true })
    await expect(page.getByRole('button', { name: '从桌面添加', exact: true })).toHaveCount(0)
    await page.getByRole('tab', { name: '添加', exact: true }).click()
    await expect(page.locator('.rail-control-list')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '从桌面添加', exact: true })).toBeVisible()
    await tabs.click()
    const top = (await tabs.boundingBox())!.y
    await page.locator('.rail-control-select').first().click()
    if (!await page.locator('.rail-item-controls').count()) await page.locator('.rail-control-select').first().click()
    expect((await page.locator('.rail-item-controls').boundingBox())!.height).toBeLessThan(190)
    const input = page.getByLabel('显示名称', { exact: true })
    await input.hover()
    const before = await pane.evaluate(el => el.scrollTop)
    await page.mouse.wheel(0, 460)
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(before)
    await pane.hover()
    await page.mouse.wheel(0, -10000)
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0)
    expect((await tabs.boundingBox())!.y).toBe(top)
    await page.locator('.rail-control-select').last().click()
    const editor = page.locator('.rail-item-controls')
    await expect(editor).toBeInViewport({ ratio: 1 })
    await editor.locator('summary').first().click()
    await expect(page.getByRole('button', { name: '重新关联目标', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '新建拾光绳', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(size.height)
    await page.getByRole('button', { name: '收起挂件属性' }).click()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator('.rail-control-select').first().click()
  await expect(page.getByLabel('显示名称', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'artifacts/rail-scroll-mobile-after.png', fullPage: true })
})

test('rapid rail changes replace motion instead of stacking and tab switches do not replay mounting', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify({ version: 1, enabled: false, groups: [{ id: 'apps', name: '连续操作', x: .07, y: .12, width: .86, collapsed: false, items: ['one', 'two'].map(id => ({ id, name: id, kind: 'app', path: `C:\\Apps\\${id}.exe`, crop: 'cover' })) }] }))
    const target = window as unknown as { railStarts: { id: string; delay: number }[] }
    target.railStarts = []
    const original = Element.prototype.animate
    Element.prototype.animate = function (frames, options) {
      if (this instanceof HTMLElement && this.dataset.railItem) target.railStarts.push({ id: this.dataset.railItem, delay: typeof options === 'object' ? Number(options.delay ?? 0) : 0 })
      return original.call(this, frames, options)
    }
  })
  await page.setViewportSize({ width: 1440, height: 940 })
  await page.goto('/#rail')
  await expect(page.locator('.rail-items > [data-rail-item]')).toHaveCount(2)
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByRole('tab', { name: '挂件列表', exact: true }).click()
  expect(await page.evaluate(() => (window as unknown as { railStarts: unknown[] }).railStarts)).toEqual([])
  const update = (remove: string[], add: string[]) => page.evaluate(({ remove, add }) => {
    const settings = JSON.parse(localStorage.getItem('soundspectra.rail.v1')!)
    settings.groups[0].items = settings.groups[0].items.filter((item: { id: string }) => !remove.includes(item.id)).concat(add.map(id => ({ id, name: id, kind: 'app', path: `C:\\Apps\\${id}.exe`, crop: 'cover' })))
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify(settings))
    window.dispatchEvent(new Event('rail-browser-changed'))
  }, { remove, add })
  await update([], ['three', 'four', 'five'])
  await expect(page.locator('.rail-items > [data-rail-item]')).toHaveCount(5)
  expect(await page.evaluate(() => (window as unknown as { railStarts: { id: string; delay: number }[] }).railStarts.filter(value => ['three', 'four', 'five'].includes(value.id)).map(value => value.delay))).toEqual([0, 18, 36])
  await update(['one', 'three'], ['six'])
  await expect(page.locator('.rail-items > [data-rail-item]')).toHaveCount(4)
  expect(await page.locator('.rail-items > [data-rail-item]').evaluateAll(nodes => nodes.every(node => node.getAnimations().filter(animation => animation.playState === 'running' && !(animation instanceof CSSTransition)).length <= 1))).toBe(true)
  await expect(page.locator('.rail-exiting')).toHaveCount(0)
  await expect.poll(() => page.locator('.rail-items > [data-rail-item]').evaluateAll(nodes => nodes.flatMap(node => node.getAnimations()).length)).toBe(0)
  expect(errors).toEqual([])
})

test('clicking the cord adds a real persisted note and clicking the note edits its content', async ({ page }) => {
  await page.goto('/#rail')
  const point = await page.locator('.rail-cord-hit').evaluate((path: SVGPathElement) => {
    const p = path.getPointAtLength(path.getTotalLength() * .75)
    const result = new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()!)
    return { x: result.x, y: result.y }
  })
  await page.mouse.click(point.x, point.y)
  await page.getByRole('button', { name: '写便签', exact: false }).click()
  await page.getByRole('textbox', { name: '便签内容', exact: true }).fill('周末去山里\n记得带相机')
  await page.getByRole('button', { name: '挂上便签', exact: true }).click()
  await expect(page.locator('.rail-note-content')).toContainText('记得带相机')
  await page.reload()
  await page.getByRole('button', { name: '周末去山里，便签', exact: true }).dblclick()
  await page.getByRole('region', { name: '选中挂件属性' }).getByRole('textbox', { name: '便签内容', exact: true }).fill('周末去山里\n带相机和水')
  await page.getByRole('region', { name: '选中挂件属性' }).getByRole('button', { name: '保存便签', exact: true }).click()
  await expect(page.locator('.rail-note-content')).toContainText('带相机和水')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!).groups[0].items[0])
  expect(saved.path).toBe('')
  expect(saved.text).toContain('带相机和水')
})

test('photo labels are hidden and the photo menu anchors to its card within the scene', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('soundspectra.rail.v1', JSON.stringify({ version: 1, enabled: false, groups: [{ id: 'apps', name: '我的拾光绳', x: .07, y: .18, width: .86, collapsed: false, items: Array.from({ length: 5 }, (_, i) => ({ id: `photo-${i}`, name: `很长的照片文件名-${i}`, path: `C:\\Pictures\\${i}.jpg`, kind: 'image', crop: 'cover' })) }] })))
  await page.goto('/#rail')
  const photo = page.locator('.rail-hanging.rail-image').last()
  await expect(photo.locator('.rail-item-name')).toHaveCount(0)
  await photo.locator('.rail-item-menu').click()
  const menu = page.locator('.rail-popup-menu')
  await expect(menu).toBeVisible()
  const scene = await page.locator('.desktop-preview').boundingBox(), card = await photo.boundingBox(), popup = await menu.boundingBox()
  expect(popup!.x).toBeGreaterThanOrEqual(scene!.x)
  expect(popup!.x + popup!.width).toBeLessThanOrEqual(scene!.x + scene!.width)
  expect(popup!.y).toBeGreaterThan(card!.y)
})

test('renaming can be cancelled and keyboard reorder preserves the focused item', async ({ page }) => {
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByText('输入本地路径预览布局', { exact: true }).click()
  for (const path of ['C:\\Work\\First.txt', 'C:\\Work\\Second.txt']) {
    await page.getByRole('textbox', { name: '挂件目标路径' }).fill(path)
    await page.getByRole('button', { name: '挂上去', exact: true }).click()
  }
  await page.getByRole('tab', { name: '挂件列表', exact: true }).click()
  const first = page.locator('.rail-control-select').filter({ hasText: 'First' })
  await first.click()
  const name = page.getByLabel('显示名称', { exact: true })
  await name.fill('不应该保存的名称')
  await name.press('Escape')
  await expect(name).toHaveValue('First')
  await expect(page.getByRole('button', { name: 'First，文件', exact: true })).toBeVisible()
  await first.focus()
  await first.press('Alt+ArrowDown')
  await expect(page.locator('.rail-control-select').last()).toContainText('First')
  await expect(first).toBeFocused()
  await page.getByRole('tab', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: 'First，文件', exact: true }).click()
  await expect(page.getByRole('tab', { name: '挂件列表', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('显示名称', { exact: true })).toHaveValue('First')
})

test('note drafts survive closing and reload, and Ctrl+Enter saves once', async ({ page }) => {
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  const add = page.getByRole('button', { name: '写便签', exact: true })
  await add.click()
  await page.getByRole('textbox', { name: '便签内容', exact: true }).fill('还没写完\n晚些继续')
  await page.getByRole('textbox', { name: '便签内容', exact: true }).press('Escape')
  await expect(add).toBeFocused()
  await page.reload()
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await add.click()
  await expect(page.getByRole('textbox', { name: '便签内容', exact: true })).toHaveValue('还没写完\n晚些继续')
  await page.getByRole('textbox', { name: '便签内容', exact: true }).press('Control+Enter')
  await expect(page.locator('.rail-note-content')).toContainText('晚些继续')
  await expect(page.locator('.rail-control-item.is-selected')).toContainText('还没写完')
  const text = page.getByRole('textbox', { name: '便签内容', exact: true })
  await text.fill('更新的便签草稿')
  await page.getByRole('tab', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: '还没写完，便签', exact: true }).click()
  await expect(text).toHaveValue('更新的便签草稿')
  await text.press('Control+Enter')
  await expect(page.locator('.rail-note-content')).toHaveText('更新的便签草稿')
  const items = await page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!).groups[0].items)
  expect(items).toHaveLength(1)
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByRole('button', { name: '写便签', exact: true }).click()
  await expect(page.getByRole('region', { name: '添加挂件', exact: true }).getByRole('textbox', { name: '便签内容', exact: true })).toHaveValue('')
})

test('note drafts remain recoverable after an external update or failed save', async ({ page }) => {
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByRole('button', { name: '写便签', exact: true }).click()
  await page.getByRole('textbox', { name: '便签内容', exact: true }).fill('已保存内容')
  await page.getByRole('button', { name: '挂上便签', exact: true }).click()
  const editor = page.getByRole('region', { name: '选中挂件属性' })
  const text = editor.getByRole('textbox', { name: '便签内容', exact: true })
  await text.fill('我正在编辑的草稿')
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('soundspectra.rail.v1')!)
    settings.groups[0].items[0].text = '另一个窗口保存的内容'
    localStorage.setItem('soundspectra.rail.v1', JSON.stringify(settings))
    window.dispatchEvent(new Event('rail-browser-changed'))
  })
  await expect(editor.locator('.rail-note-conflict')).toBeVisible()
  await expect(text).toHaveValue('我正在编辑的草稿')
  await expect(editor.getByRole('button', { name: '保存便签', exact: true })).toBeDisabled()
  await editor.getByRole('button', { name: '继续编辑草稿', exact: true }).click()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    ;(window as unknown as { restoreRailStorage: () => void }).restoreRailStorage = () => { Storage.prototype.setItem = original }
    Storage.prototype.setItem = function (key, value) { if (key === 'soundspectra.rail.v1') throw Error('测试保存失败'); return original.call(this, key, value) }
  })
  await editor.getByRole('button', { name: '保存便签', exact: true }).click()
  await expect(editor.getByRole('alert')).toContainText('测试保存失败')
  await expect(text).toHaveValue('我正在编辑的草稿')
  await page.evaluate(() => (window as unknown as { restoreRailStorage: () => void }).restoreRailStorage())
  await editor.getByRole('button', { name: '保存便签', exact: true }).click()
  await expect(page.locator('.rail-note-content')).toHaveText('我正在编辑的草稿')
})
