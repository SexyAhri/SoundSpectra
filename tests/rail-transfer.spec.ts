import { expect, test, type Page } from '@playwright/test'
import { clickCord } from './rail-helpers'

// Real rail UI with mocked OS boundaries; never touches the system clipboard,
// starts a native drag, or writes to the user's mounted files/configuration.
async function fixture(page: Page) {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }))
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import { RailControls } from '/src/features/rail/rail-controls.tsx';
    import { useRailPaste } from '/src/features/rail/use-rail-paste.ts';
    import { useRailDrop } from '/src/features/rail/use-rail-drop.ts';
    import { pasteRailImage } from '/src/features/rail/client.ts';
    import { changeRail } from '/src/features/rail/model.ts';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.commands = []; window.changes = []; window.drops = []; window.detaches = []; window.eventListeners = {}; window.callbacks = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'plugin:event|listen') { window.eventListeners[args.event] = window.callbacks.get(args.handler); return args.handler; }
      if (command === 'plugin:event|unlisten') { delete window.eventListeners[args.event]; return; }
      window.commands.push({ command, args });
      if (command === 'rail_media') return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a90sAAAAASUVORK5CYII=';
      if (command === 'rail_paste_image') {
        return new Promise((resolve, reject) => { window.finishPaste = fail => {
          if (fail) { reject('剪贴板里没有图片，请先截图或复制图片'); return; }
          const settings = structuredClone(window.currentSettings);
          settings.groups[0].items.push({ id: 'pasted', name: '剪贴板图片', kind: 'image', path: 'C:/owned/pasted.png', crop: 'contain' });
          resolve({ settings, supported: true, missing: [], desktopError: null });
        }; });
      }
      if (command === 'rail_drag_out') return new Promise(resolve => { window.finishDrag = () => resolve(false); });
      return null;
    }, metadata: { currentWindow: { label: 'settings' }, currentWebview: { label: 'settings' } },
    transformCallback: callback => { const id = window.callbacks.size + 1; window.callbacks.set(id, callback); return id; } };
    function Fixture() {
      const [settings, setSettings] = React.useState({ version: 1, enabled: true, groups: [{ id: 'apps', name: '拾光绳', x: .07, y: .12, width: .86, collapsed: false, items: [
        { id: 'one', name: '文件', kind: window.fixtureKind || 'file', path: 'C:/one.txt', text: '保留便签内容', crop: 'cover' },
        { id: 'two', name: '照片', kind: 'image', path: 'C:/two.png', crop: 'cover' },
        { id: 'note', name: '便签', kind: 'note', path: '', text: '笔记', crop: 'cover' },
      ] }] });
      const [pending, setPending] = React.useState(0);
      const [error, setError] = React.useState(null);
      const [selection, select] = React.useState(null);
      const [dropActive, setDropActive] = React.useState(true);
      window.setDropActive = setDropActive;
      const controller = { settings, loaded: true, pending, error, desktopError: null, supported: true, missing: [],
        change: async change => { window.changes.push(change); const next = changeRail(settings, change); setSettings(next); return { settings: next }; },
        detach: async id => {
          window.detaches.push(id);
          if (window.detachFailure) throw Error('无法保存到桌面，挂件已保留');
          const next = changeRail(settings, { type: 'remove', id }); setSettings(next); return { settings: next };
        },
        pasteImage: async group => { setPending(1); setError(null); try {
          const next = await pasteRailImage(group); setSettings(next.settings); return next;
        } catch (error) { setError(String(error)); throw error; } finally { setPending(0); } },
        add: async (group, paths) => {
          window.drops.push({ group, paths });
          const next = structuredClone(settings);
          const target = next.groups.find(value => value.id === group);
          for (const path of paths) if (!target.items.some(item => item.path === path)) target.items.push({ id: 'dropped-' + target.items.length, name: path.split('/').at(-1), path, kind: 'app', crop: 'cover', desktopManaged: true });
          setSettings(next); return { settings: next };
        }, refresh: async () => {}, pick: async () => {},
      };
      window.currentSettings = settings;
      useRailPaste(controller, 'apps', true);
      useRailDrop(controller, 'apps', dropActive);
      return React.createElement('div', { style: { margin: 24 } },
        React.createElement('input', { 'aria-label': '其他输入' }),
        React.createElement('div', { style: { width: 860 } }, React.createElement(RailSurface, { group: settings.groups[0], controller, selected: selection, onSelect: (_, id) => select(id) })),
        React.createElement('div', { style: { width: 390 } }, React.createElement(RailControls, { controller, selectedGroup: 'apps', selectedItem: selection, onSelect: (_, id) => select(id), onApplyAfternoon: () => {} })));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  ` }))
  await page.goto('/?rail-transfer-fixture')
  await expect(page.locator('.rail-surface')).toBeVisible()
}

test('native and webview drops mount the same paths and respect inactive rails', async ({ page }) => {
  await fixture(page)
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).eventListeners))).toContain('tauri://drag-drop')
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).eventListeners))).toContain('rail-native-drop')
  const paths = ['C:/桌面/工作 文件夹', 'C:/桌面/工具.lnk']
  const deliver = (event: string) => page.evaluate(({ event, paths }) => {
    (window as any).eventListeners[event]({ event, payload: { paths, position: { x: -100, y: -100 } } })
  }, { event, paths })
  await deliver('rail-native-drop')
  await deliver('tauri://drag-drop')
  expect(await page.evaluate(() => (window as any).drops)).toEqual([
    { group: 'apps', paths }, { group: 'apps', paths },
  ])
  await page.evaluate(() => (window as any).setDropActive(false))
  await expect.poll(() => page.evaluate(() => document.querySelector('.rail-surface') !== null)).toBe(true)
  await deliver('rail-native-drop')
  expect(await page.evaluate(() => (window as any).drops)).toHaveLength(2)
})

test('dropping a desktop icon into the list mounts it while the list stays open', async ({ page }) => {
  await fixture(page)
  await clickCord(page, true)
  const list = page.getByRole('region', { name: '更多挂件', exact: true })
  await expect(list).toBeVisible()
  await list.getByRole('searchbox', { name: '搜索挂件' }).fill('文件')
  await expect(list.locator('.rail-overflow-entry')).toHaveCount(1)
  const box = (await list.boundingBox())!
  await expect.poll(() => page.evaluate(() => typeof (window as any).eventListeners['rail-native-drop'])).toBe('function')
  await page.evaluate(({ x, y }) => {
    (window as any).eventListeners['rail-native-drop']({ payload: {
      paths: ['C:/TestDesktop/Demo.lnk'], position: { x: x * devicePixelRatio, y: y * devicePixelRatio },
    } })
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await expect(list.locator('.rail-overflow-entry')).toHaveCount(4)
  await expect(list.getByRole('searchbox', { name: '搜索挂件' })).toHaveValue('')
  await expect(list.getByRole('button', { name: '选择Demo.lnk，软件', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).drops)).toEqual([{ group: 'apps', paths: ['C:/TestDesktop/Demo.lnk'] }])
  await expect(list).toBeVisible()
})

test('WebView2 DOM file drops allow copy or shortcut link feedback and forward actual file objects', async ({ page }) => {
  await fixture(page)
  await clickCord(page, true)
  const result = await page.evaluate(() => {
    const sent: { message: any; names: string[] }[] = []
    ;(window as any).chrome.webview = { postMessageWithAdditionalObjects: (message: string, files: File[]) => {
      sent.push({ message: JSON.parse(message), names: files.map(file => file.name) })
    } }
    const target = document.querySelector('.rail-popup-more')!
    const make = (effect: string) => {
      const data = new DataTransfer()
      for (const name of ['软件.lnk', '工作 文件夹', '照片.png']) data.items.add(new File(['fixture'], name))
      Object.defineProperty(data, 'effectAllowed', { value: effect })
      Object.defineProperty(data, 'dropEffect', { value: 'none', writable: true })
      return data
    }
    const feedback = []
    for (const effect of ['all', 'copyMove', 'link', 'linkMove']) {
      const data = make(effect)
      const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
      target.dispatchEvent(over)
      feedback.push({ prevented: over.defaultPrevented, effect: data.dropEffect })
    }
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: 180, clientY: 240, dataTransfer: make('link') })
    target.dispatchEvent(drop)
    return { feedback, sent, prevented: drop.defaultPrevented, ratio: devicePixelRatio }
  })
  expect(result.feedback).toEqual(['copy', 'copy', 'link', 'link'].map(effect => ({ prevented: true, effect })))
  expect(result.prevented).toBe(true)
  expect(result.sent).toEqual([{ message: { kind: 'soundspectra:rail-file-drop', x: 180 * result.ratio, y: 240 * result.ratio }, names: ['软件.lnk', '工作 文件夹', '照片.png'] }])
  await expect(page.locator('.rail-popup-more')).toBeVisible()
  await page.evaluate(() => (window as any).setDropActive(false))
  const inactive = await page.evaluate(() => {
    const data = new DataTransfer(); data.items.add(new File(['fixture'], 'blocked.lnk'))
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data })
    document.dispatchEvent(over)
    return { prevented: over.defaultPrevented, effect: data.dropEffect }
  })
  expect(inactive).toEqual({ prevented: true, effect: 'none' })
})

test('dragging an entry out unmounts only after release without opening or copying the file', async ({ page }) => {
  await fixture(page)
  await clickCord(page, true)
  const list = page.getByRole('region', { name: '更多挂件', exact: true })
  const item = list.getByRole('button', { name: '选择文件，文件', exact: true })
  const box = (await item.boundingBox())!, panel = (await list.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(panel.x + panel.width + 35, box.y + box.height / 2, { steps: 10 })
  await expect(list.getByRole('status')).toHaveText('松开恢复到桌面')
  expect(await page.evaluate(() => (window as any).changes)).toEqual([])
  await page.screenshot({ path: 'artifacts/rail-list-detaching.png' })
  await page.mouse.up()
  await expect(item).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).detaches)).toEqual(['one'])
  expect(await page.evaluate(() => (window as any).commands.filter((command: any) => ['rail_open', 'rail_drag_out'].includes(command.command)))).toEqual([])
  await expect(list).toBeVisible()
})

test('bringing a dragged entry back or pressing Escape preserves its mount', async ({ page }) => {
  await fixture(page)
  await clickCord(page, true)
  const list = page.getByRole('region', { name: '更多挂件', exact: true })
  const item = list.getByRole('button', { name: '选择文件，文件', exact: true })
  const box = (await item.boundingBox())!, panel = (await list.boundingBox())!
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(panel.x + panel.width + 35, y, { steps: 10 })
  await expect(list.getByRole('status')).toHaveText('松开恢复到桌面')
  await page.mouse.move(x, y, { steps: 10 })
  await page.mouse.up()
  await expect(item).toBeVisible()
  expect(await page.evaluate(() => (window as any).changes)).toEqual([])
  await page.mouse.down()
  await page.mouse.move(panel.x + panel.width + 35, y, { steps: 10 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).changes)).toEqual([])
  expect(await page.evaluate(() => (window as any).currentSettings.groups[0].items.length)).toBe(3)
})

test('paste is scoped away from text editors, serializes pending work, and reports failure for retry', async ({ page }) => {
  await fixture(page)
  const input = page.getByRole('textbox', { name: '其他输入' })
  await input.fill('正在输入')
  await input.press('Control+v')
  expect(await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_paste_image'))).toEqual([])
  await input.evaluate(node => (node as HTMLElement).blur())
  await page.keyboard.press('Control+v')
  const requests = () => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_paste_image').length)
  await expect.poll(requests).toBe(1)
  await page.keyboard.press('Control+v')
  expect(await requests()).toBe(1)
  await page.evaluate(() => (window as any).finishPaste(true))
  await expect(page.getByRole('alert')).toContainText('剪贴板里没有图片')
  expect(await page.evaluate(() => (window as any).currentSettings.groups[0].items.length)).toBe(3)
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByRole('button', { name: '粘贴图片', exact: true }).click()
  await expect.poll(requests).toBe(2)
  await expect(page.getByRole('button', { name: '粘贴图片', exact: true })).toBeDisabled()
  await page.evaluate(() => (window as any).finishPaste(false))
  await expect(page.getByRole('button', { name: '剪贴板图片，图片', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).currentSettings.groups[0].items.at(-1).path)).toBe('C:/owned/pasted.png')
})

test('crossing rail bounds hands files to the OS once and leaves references intact on cancellation', async ({ page }) => {
  await fixture(page)
  const file = page.getByRole('button', { name: '文件，文件', exact: true })
  const source = (await file.boundingBox())!, bounds = (await page.locator('.rail-surface').boundingBox())!
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(source.x + source.width / 2, bounds.y + bounds.height + 35, { steps: 12 })
  const drags = () => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_drag_out'))
  await expect.poll(async () => (await drags()).length).toBe(1)
  await page.mouse.move(source.x + 40, bounds.y + bounds.height + 50)
  await page.mouse.up()
  await page.evaluate(() => (window as any).finishDrag())
  expect(await drags()).toEqual([{ command: 'rail_drag_out', args: { id: 'one' } }])
  expect(await page.evaluate(() => (window as any).changes)).toEqual([])
  expect(await page.evaluate(() => (window as any).currentSettings.groups[0].items.map((i: any) => i.id))).toEqual(['one', 'two', 'note'])
  await file.click()
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_open').length)).toBe(1)
})

test('notes can be exported by the OS and internal reordering stays local', async ({ page }) => {
  await fixture(page)
  const note = (await page.getByRole('button', { name: '便签，便签', exact: true }).boundingBox())!
  const bounds = (await page.locator('.rail-surface').boundingBox())!
  await page.mouse.move(note.x + 20, note.y + 20)
  await page.mouse.down()
  await page.mouse.move(note.x + 20, bounds.y + bounds.height + 30, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_drag_out').length)).toBe(1)
  await page.evaluate(() => (window as any).finishDrag())
  await page.evaluate(() => { (window as any).commands = [] })
  const file = (await page.getByRole('button', { name: '文件，文件', exact: true }).boundingBox())!
  const photo = (await page.getByRole('button', { name: '照片，图片', exact: true }).boundingBox())!
  await page.mouse.move(file.x + 20, file.y + 20)
  await page.mouse.down()
  await page.mouse.move(photo.x + photo.width * .8, photo.y + 30, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as any).changes)).toEqual([{ type: 'move', id: 'one', groupId: 'apps', index: 1 }])
  expect(await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_drag_out'))).toEqual([])
})

test('a single click opens an off-center item once and leaves no selection outline', async ({ page }) => {
  await fixture(page)
  const photo = page.getByRole('button', { name: '照片，图片', exact: true })
  await photo.click()
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_open'))).toEqual([{ command: 'rail_open', args: { id: 'two', reveal: false } }])
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'two')
  expect(await photo.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('none')
})

test('double clicking a moving card does not launch twice', async ({ page }) => {
  await fixture(page)
  const photo = page.getByRole('button', { name: '照片，图片', exact: true })
  await expect(photo).toBeVisible()
  const box = (await photo.boundingBox())!
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2, { delay: 180 })
  await expect.poll(() => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_open'))).toEqual([{ command: 'rail_open', args: { id: 'two', reveal: false } }])
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'two')
})

test('dragging and releasing on the original card does not open it or block later activation', async ({ page }) => {
  await fixture(page)
  const file = page.getByRole('button', { name: '文件，文件', exact: true })
  const box = (await file.boundingBox())!
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 12, y + 8, { steps: 4 })
  await page.mouse.move(x, y, { steps: 4 })
  await page.mouse.up()
  const opens = () => page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_open'))
  expect(await opens()).toEqual([])
  await file.press('Space')
  await expect.poll(async () => (await opens()).length).toBe(1)
  await file.click()
  await expect.poll(async () => (await opens()).length).toBe(2)
})

test('pasting centers the new item even when an old item was selected', async ({ page }) => {
  await fixture(page)
  await page.getByRole('button', { name: '文件，文件', exact: true }).click()
  await page.keyboard.press('Control+v')
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishPaste)).toBe('function')
  await page.evaluate(() => (window as any).finishPaste(false))
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'pasted')
})

for (const kind of ['file', 'folder', 'image', 'note']) {
  test(`list ${kind} drag out restores to Desktop and keeps the mount on failure`, async ({ page }) => {
    await page.addInitScript(kind => { (window as any).fixtureKind = kind }, kind)
    await fixture(page)
    await clickCord(page, true)
    const panel = page.locator('.rail-popup-more')
    const item = panel.locator('[data-rail-list-item="one"]')
    const dragOutside = async () => {
      const box = (await item.boundingBox())!, list = (await panel.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(list.x + list.width + 32, box.y + box.height / 2, { steps: 12 })
      await expect(panel.getByRole('status')).toHaveText('松开恢复到桌面')
      await page.mouse.up()
    }
    await page.evaluate(() => { (window as any).detachFailure = true })
    await dragOutside()
    await expect(panel.getByRole('alert')).toContainText('挂件已保留')
    await expect(item).toBeVisible()
    await page.evaluate(() => { (window as any).detachFailure = false })
    await dragOutside()
    await expect(item).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).detaches)).toEqual(['one', 'one'])
    expect(await page.evaluate(() => (window as any).commands.filter((c: any) => c.command === 'rail_open'))).toEqual([])
  })
}
