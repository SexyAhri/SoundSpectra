import { expect, test, type Page } from '@playwright/test'

// Exercise real components with delayed IPC, without launching a desktop window
// or touching the user's persisted configuration.
async function fixture(page: Page, surface = false) {
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import { RailControls } from '/src/features/rail/rail-controls.tsx';
    import { changeRail } from '/src/features/rail/model.ts';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.changes = []; window.popupCalls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'rail_desktop_entries') return new Promise(resolve => {
        window.finishDesktop = () => resolve({ entries: [], issues: [], truncated: false });
      });
      if (command === 'rail_popup') {
        window.popupCalls.push(args.open);
        if (args.open) return new Promise(resolve => { window.finishPopup = resolve; });
      }
      return null;
    }};
    function Fixture() {
      const [settings, setSettings] = React.useState({ version: 1, enabled: true, groups: [{ id: 'apps', name: 'input test', x: .07, y: .12, width: .86, collapsed: false, items: [
        { id: 'one', name: 'one', kind: 'app', path: 'C:/one.exe', crop: 'cover' },
        { id: 'two', name: 'two', kind: 'app', path: 'C:/two.exe', crop: 'cover' },
        { id: 'note', name: 'note', kind: 'note', path: '', text: 'original', crop: 'cover' },
      ] }] });
      const [pending, setPending] = React.useState(0);
      const [selection, select] = React.useState(null);
      const controller = { settings, loaded: true, pending, error: null, desktopError: null, supported: true, missing: [],
        change: change => { window.changes.push(change); setPending(1); return new Promise(resolve => {
          window.finishSave = () => { const next = changeRail(settings, change); setSettings(next); setPending(0); resolve({ settings: next }); };
        }); },
        add: async () => ({ settings }), refresh: async () => {}, pick: async () => {},
      };
      window.currentSettings = settings;
      const children = ${surface}
        ? React.createElement(RailSurface, { group: settings.groups[0], controller, desktop: true })
        : React.createElement(RailControls, { controller, selectedGroup: 'apps', selectedItem: selection, onSelect: (_, id) => select(id ?? null), onApplyAfternoon: () => {} });
      window.updateGroup = () => setSettings(current => ({ ...current, groups: current.groups.map(group => ({ ...group, name: 'updated', items: [...group.items] })) }));
      return React.createElement('div', { className: ${surface} ? 'rail-desktop' : '', style: { width: ${surface ? 860 : 390}, margin: 24 } },
        React.createElement('input', { 'aria-label': 'other input' }), children);
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  ` }));
  await page.addInitScript(() => { Object.assign(window, { isTauri: true }) })
  await page.goto('/?rail-input-fixture')
}

test('desktop discovery finishing or refreshing cannot steal an edited field', async ({ page }) => {
  await fixture(page)
  await page.getByRole('tab', { name: '添加', exact: true }).click()
  await page.getByRole('button', { name: '从桌面批量添加', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toBeVisible()
  const other = page.getByRole('textbox', { name: 'other input' })
  await other.fill('continue typing')
  await page.evaluate(() => (window as any).finishDesktop())
  await expect(page.getByRole('searchbox', { name: '搜索桌面图标' })).toBeVisible()
  await expect(other).toBeFocused()
  await page.keyboard.type(' here')
  await expect(other).toHaveValue('continue typing here')
  await page.getByRole('button', { name: '刷新桌面图标' }).click()
  await other.click()
  await page.evaluate(() => (window as any).finishDesktop())
  await expect(page.getByRole('searchbox', { name: '搜索桌面图标' })).toBeVisible()
  await expect(other).toBeFocused()
})

test('layout slider remains enabled through a drag and saves once on release', async ({ page }) => {
  await fixture(page)
  await page.getByRole('tab', { name: '布局', exact: true }).click()
  const slider = page.getByRole('slider', { name: '距屏幕顶部' })
  const thumb = (await slider.boundingBox())!
  const track = (await page.locator('[data-slot=slider]').filter({ has: slider }).boundingBox())!
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width * .5, thumb.y + thumb.height / 2, { steps: 10 })
  await expect(slider).toBeEnabled()
  expect(await page.evaluate(() => (window as any).changes)).toEqual([])
  await page.mouse.move(track.x + track.width * .7, thumb.y + thumb.height / 2, { steps: 10 })
  const final = Number(await slider.getAttribute('aria-valuenow'))
  expect(final).toBeGreaterThan(35)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as any).changes.length)).toBe(1)
  await page.evaluate(() => (window as any).finishSave())
  await expect(slider).toHaveAttribute('aria-valuenow', String(final))
  await expect(slider).toBeEnabled()
  await slider.press('ArrowLeft')
  await expect.poll(() => page.evaluate(() => (window as any).changes.length)).toBe(2)
  await page.evaluate(() => (window as any).finishSave())
  await expect(slider).toHaveAttribute('aria-valuenow', String(final - 1))
})

test('desktop note waits for native readiness and stale completions cannot refocus it', async ({ page }) => {
  await fixture(page, true)
  const note = page.getByRole('button', { name: 'note，便签', exact: true })
  await note.click()
  const text = page.getByRole('textbox', { name: '便签内容', exact: true })
  await expect(text).toBeVisible()
  await expect(text).not.toBeFocused()
  await page.evaluate(() => (window as any).finishPopup())
  await expect(text).toBeFocused()
  await text.press('Control+a')
  await page.keyboard.type('typing without focus jumping')
  await expect(text).toHaveValue('typing without focus jumping')
  await page.evaluate(() => (window as any).updateGroup())
  await expect(text).toBeFocused()
  expect(await page.evaluate(() => (window as any).popupCalls)).toEqual([false, true])
  await page.getByRole('button', { name: '关闭挂件面板' }).click()
  await expect(note).toBeFocused()
  await note.click()
  const other = page.getByRole('textbox', { name: 'other input' })
  await other.click()
  await other.fill('outside')
  await expect(text).toHaveCount(0)
  await page.evaluate(() => (window as any).finishPopup())
  await expect(other).toBeFocused()
  await page.keyboard.type(' still typing')
  await expect(other).toHaveValue('outside still typing')
})

test('pointer reordering commits once, suppresses opening and releases capture on cancellation', async ({ page }) => {
  await fixture(page, true)
  const source = page.getByRole('button', { name: 'one，软件', exact: true })
  const target = page.getByRole('button', { name: 'two，软件', exact: true })
  await expect(source).toHaveAttribute('draggable', 'false')
  const start = (await source.boundingBox())!, end = (await target.boundingBox())!
  const drag = async () => {
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 10 })
  }
  await drag()
  await expect(page.locator('.rail-reorder-target')).toHaveAttribute('data-rail-item', 'two')
  await source.press('Escape')
  await page.mouse.up()
  expect(await page.evaluate(() => (window as any).changes)).toEqual([])
  await drag()
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => (window as any).changes.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).changes[0])).toEqual({ type: 'move', id: 'one', groupId: 'apps', index: 1 })
  await page.evaluate(() => (window as any).finishSave())
  await expect(page.locator('.rail-items > [data-rail-item]').nth(1)).toHaveAttribute('data-rail-item', 'one')
  await expect(page.locator('.rail-popup')).toHaveCount(0)
  await expect(page.locator('.rail-reorder-target')).toHaveCount(0)
  await page.getByRole('button', { name: 'note，便签', exact: true }).click()
  await page.evaluate(() => (window as any).finishPopup())
  const text = page.getByRole('textbox', { name: '便签内容', exact: true })
  await text.fill('input after drag')
  await expect(text).toBeFocused()
})
