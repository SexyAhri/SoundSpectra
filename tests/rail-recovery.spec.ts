import { expect, test, type Page } from '@playwright/test'
import { clickCord } from './rail-helpers'

// Delay IPC reads and deliver real subscriptions to exercise the controller's
// ordering. All files and OS dialogs stay behind the mocked native boundary.
async function fixture(page: Page) {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }))
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { useRail } from '/src/features/rail/use-rail.ts';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.reads = []; window.replies = []; window.opens = []; window.commands = []; window.callbacks = new Map(); window.eventListeners = {};
    const initial = { settings: { version: 1, enabled: true, groups: [{ id: 'apps', name: '保留布局', x: .12, y: .23, width: .72, collapsed: false, items: [
      { id: 'reference', name: '我的工作文档', kind: 'file', path: 'C:/old.txt', crop: 'cover' }
    ] }] }, missing: [], supported: true, desktopError: null };
    window.serverSnapshot = structuredClone(initial);
    window.emitSnapshot = (name, missing = []) => {
      window.serverSnapshot.settings.groups[0].name = name;
      window.serverSnapshot.missing = missing;
      window.eventListeners['rail-changed']({ payload: structuredClone(window.serverSnapshot) });
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.commands.push({ command, args });
      if (command === 'plugin:event|listen') { window.eventListeners[args.event] = window.callbacks.get(args.handler); return args.handler; }
      if (command === 'plugin:event|unlisten') { delete window.eventListeners[args.event]; return; }
      if (command === 'rail_get') return new Promise((resolve, reject) => {
        const captured = structuredClone(window.serverSnapshot);
        window.reads.push({ finish: () => resolve(captured), fail: () => reject('过期的读取错误') });
      });
      if (command === 'rail_media') return null;
      if (command === 'rail_open') return new Promise((resolve, reject) => {
        window.opens.push({ finish: () => resolve(null), fail: () => reject('打开失败，请重试') });
      });
      if (command === 'rail_pick') return ['C:/new.txt'];
      if (command === 'rail_add_paths') {
        const item = window.serverSnapshot.settings.groups[0].items.find(item => item.id === args.replaceId);
        item.path = args.paths[0];
        window.serverSnapshot.missing = [];
        window.emitSnapshot(window.serverSnapshot.settings.groups[0].name);
        return structuredClone(window.serverSnapshot);
      }
      if (command === 'rail_change') {
        if (window.failNextChange) { window.failNextChange = false; throw '保存失败'; }
        if (args.change.type === 'group') window.serverSnapshot.settings.groups[0].name = args.change.name;
        if (args.change.type === 'item') {
          const item = window.serverSnapshot.settings.groups[0].items.find(item => item.id === args.change.id);
          if (args.change.text !== undefined) item.text = args.change.text;
        }
        if (args.change.type === 'remove') window.serverSnapshot.settings.groups[0].items = [];
        window.emitSnapshot(window.serverSnapshot.settings.groups[0].name, window.serverSnapshot.settings.groups[0].items.length ? window.serverSnapshot.missing : []);
        const reply = structuredClone(window.serverSnapshot);
        if (window.deferChanges) return new Promise(resolve => window.replies.push(() => resolve(reply)));
        return reply;
      }
      return null;
    }, transformCallback: callback => { const id = window.callbacks.size + 1; window.callbacks.set(id, callback); return id; } };
    function Fixture() {
      const controller = useRail();
      window.controller = controller;
      return React.createElement('main', { style: { width: 880, padding: 24 } },
        React.createElement('output', { 'data-testid': 'group-name' }, controller.loaded ? controller.settings.groups[0].name : 'loading'),
        React.createElement('button', { onClick: controller.refresh }, '刷新状态'),
        controller.error && React.createElement('p', { role: 'alert' }, controller.error),
        controller.loaded && React.createElement(RailSurface, { group: controller.settings.groups[0], controller }));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  ` }))
  await page.goto('/?rail-recovery-fixture')
  await expect.poll(() => page.evaluate(() => (window as any).reads.length)).toBe(1)
}

test('startup subscribes before reading and a late snapshot cannot roll back a live change', async ({ page }) => {
  await fixture(page)
  const order = await page.evaluate(() => (window as any).commands.map((entry: any) => entry.command))
  expect(order.indexOf('plugin:event|listen')).toBeLessThan(order.indexOf('rail_get'))
  await page.evaluate(() => (window as any).emitSnapshot('更新后的布局'))
  await expect(page.getByTestId('group-name')).toHaveText('更新后的布局')
  await page.evaluate(() => (window as any).reads[0].finish())
  await expect(page.getByTestId('group-name')).toHaveText('更新后的布局')
  await page.getByRole('button', { name: '刷新状态' }).click()
  await page.evaluate(() => (window as any).emitSnapshot('再次更新'))
  await page.evaluate(() => (window as any).reads[1].fail())
  await expect(page.getByTestId('group-name')).toHaveText('再次更新')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('missing targets offer relinking, preserve identity and layout, recover, and can be unmounted', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).reads[0].finish())
  const before = await page.evaluate(() => structuredClone((window as any).controller.settings))
  await page.evaluate(() => (window as any).emitSnapshot('保留布局', ['reference']))
  const card = page.getByRole('button', { name: '我的工作文档，文件', exact: true })
  await expect(card).toContainText('需重新关联')
  await card.click()
  const menu = page.getByRole('region', { name: '我的工作文档', exact: true })
  await expect(menu.getByRole('status')).toContainText('目标已移动或删除')
  await expect(menu.getByRole('button', { name: '打开', exact: true })).toHaveCount(0)
  await menu.getByRole('button', { name: '重新关联', exact: true }).click()
  await expect(card).not.toContainText('需重新关联')
  await expect(menu.getByRole('button', { name: '打开', exact: true })).toBeVisible()
  const after = await page.evaluate(() => structuredClone((window as any).controller.settings))
  expect(after.groups[0]).toEqual({ ...before.groups[0], items: [{ ...before.groups[0].items[0], path: 'C:/new.txt' }] })
  const commands = await page.evaluate(() => (window as any).commands)
  expect(commands.find((entry: any) => entry.command === 'rail_add_paths').args).toEqual({ groupId: 'apps', paths: ['C:/new.txt'], replaceId: 'reference' })
  await page.getByRole('button', { name: '关闭挂件面板' }).click()
  await page.evaluate(() => (window as any).emitSnapshot('保留布局', ['reference']))
  await card.click()
  await menu.getByRole('button', { name: '取消挂载', exact: true }).click()
  await expect(card).toHaveCount(0)
  await expect(menu).toHaveCount(0)
})

test('a delayed mutation reply preserves a newer recovery broadcast and the next save still works', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).reads[0].finish())
  await page.evaluate(() => {
    const app = window as any
    app.deferChanges = true
    app.saved = app.controller.change({ type: 'group', id: 'apps', name: '本次修改' })
  })
  await expect.poll(() => page.evaluate(() => (window as any).replies.length)).toBe(1)
  await page.evaluate(() => (window as any).emitSnapshot('另一个窗口的新布局', ['reference']))
  await page.evaluate(async () => { const app = window as any; app.replies[0](); await app.saved })
  await expect(page.getByTestId('group-name')).toHaveText('另一个窗口的新布局')
  await expect(page.getByRole('button', { name: '我的工作文档，文件', exact: true })).toContainText('需重新关联')
  await page.evaluate(async () => {
    const app = window as any
    app.deferChanges = false
    await app.controller.change({ type: 'group', id: 'apps', name: '继续编辑' })
  })
  await expect(page.getByTestId('group-name')).toHaveText('继续编辑')
})

test('a failed save keeps the reference and does not block the following queued edit', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).reads[0].finish())
  await page.evaluate(async () => {
    const app = window as any
    app.failNextChange = true
    const failed = app.controller.change({ type: 'remove', id: 'reference' }).catch(() => {})
    const saved = app.controller.change({ type: 'group', id: 'apps', name: '保存恢复' })
    await Promise.all([failed, saved])
  })
  await expect(page.getByTestId('group-name')).toHaveText('保存恢复')
  await expect(page.getByRole('button', { name: '我的工作文档，文件', exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).controller.pending)).toBe(0)
})

test('repeated activation shares a pending launch and a failed launch can be retried', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).reads[0].finish())
  const card = page.getByRole('button', { name: '我的工作文档，文件', exact: true })
  await card.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).opens.length)).toBe(1)
  await card.press('Enter')
  await card.press('Enter')
  expect(await page.evaluate(() => (window as any).opens.length)).toBe(1)
  await page.evaluate(() => (window as any).opens[0].fail())
  await expect(page.getByRole('alert')).toContainText('打开失败')
  await card.press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).opens.length)).toBe(2)
  await page.evaluate(() => (window as any).opens[1].finish())
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(card).toBeVisible()
})

test('a delayed file launch does not dismiss the panel opened afterwards', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).reads[0].finish())
  await page.getByRole('button', { name: '我的工作文档，文件', exact: true }).press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).opens.length)).toBe(1)
  await clickCord(page, true)
  const list = page.locator('.rail-popup-more')
  await expect(list).toHaveAttribute('data-state', 'open')
  await page.evaluate(() => (window as any).opens[0].finish())
  await expect(list).toHaveAttribute('data-state', 'open')
  await expect(list.getByRole('searchbox', { name: '搜索挂件' })).toBeVisible()
})

test('finishing a note save cannot close another note or discard its draft', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).reads[0].finish())
  await page.evaluate(() => {
    const app = window as any
    app.serverSnapshot.settings.groups[0].items.push(
      { id: 'note-one', name: '第一张', kind: 'note', path: '', crop: 'cover', text: '原内容一' },
      { id: 'note-two', name: '第二张', kind: 'note', path: '', crop: 'cover', text: '原内容二' },
    )
    app.emitSnapshot('保留布局')
    app.deferChanges = true
  })
  await page.getByRole('button', { name: '第一张，便签', exact: true }).press('Enter')
  const text = page.getByRole('textbox', { name: '便签内容', exact: true })
  await text.fill('第一张保存的新内容')
  await text.press('Control+Enter')
  await expect.poll(() => page.evaluate(() => (window as any).replies.length)).toBe(1)
  await page.getByRole('button', { name: '关闭挂件面板' }).click()
  await page.getByRole('button', { name: '第二张，便签', exact: true }).press('Enter')
  await text.fill('第二张尚未保存的草稿')
  await page.evaluate(() => (window as any).replies[0]())
  await expect(page.locator('.rail-popup-note')).toHaveAttribute('data-state', 'open')
  await expect(text).toHaveValue('第二张尚未保存的草稿')
  expect(await page.evaluate(() => (window as any).serverSnapshot.settings.groups[0].items.find((i: any) => i.id === 'note-one').text)).toBe('第一张保存的新内容')
})
