import { expect, test, type Page } from '@playwright/test'
import { clickCord } from './rail-helpers'

// Exercise real components with delayed IPC, without launching a desktop window
// or touching the user's persisted configuration.
async function fixture(page: Page, surface = false, popupWindow?: 'source' | 'host') {
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import { RailControls } from '/src/features/rail/rail-controls.tsx';
    import { changeRail } from '/src/features/rail/model.ts';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.changes = []; window.popupCalls = []; window.popupRequests = []; window.panelSizes = []; window.hiddenPanels = []; window.eventListeners = {}; window.callbacks = new Map();
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'plugin:event|listen') { window.eventListeners[args.event] = window.callbacks.get(args.handler); return args.handler; }
      if (command === 'plugin:event|unlisten') { delete window.eventListeners[args.event]; return; }
      if (command === 'rail_desktop_entries') return new Promise(resolve => {
        window.finishDesktop = () => resolve({ entries: [], issues: [], truncated: false });
      });
      if (command === 'rail_popup') {
        window.popupCalls.push(args.open);
        window.popupRequests.push(args.request);
        if (args.open) return new Promise(resolve => { window.finishPopup = resolve; });
      }
      if (command === 'rail_popup_get') return { token: 'initial-panel', mode: 'more', itemId: 'two', left: 100, top: 180, width: 440 };
      if (command === 'rail_popup_resize') window.panelSizes.push(args);
      if (command === 'rail_popup_hide') window.hiddenPanels.push(args.token);
      return null;
    }, transformCallback: callback => { const id = window.callbacks.size + 1; window.callbacks.set(id, callback); return id; } };
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
        ? React.createElement(RailSurface, { group: settings.groups[0], controller, desktop: true, popupWindow: ${JSON.stringify(popupWindow) ?? 'undefined'} })
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
  await page.getByRole('button', { name: '从桌面添加', exact: true }).click()
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
    await page.mouse.move(end.x + end.width * .8, end.y + end.height / 2, { steps: 10 })
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

test('losing desktop window focus dismisses a popup without stealing focus back', async ({ page }) => {
  await fixture(page, true)
  await page.locator('[data-rail-item="one"] .rail-item-menu').click()
  await expect(page.locator('.rail-popup')).toBeVisible()
  await page.evaluate(() => (window as any).finishPopup())
  await expect.poll(() => page.evaluate(() => typeof (window as any).eventListeners['rail-dismiss-popup'])).toBe('function')
  const other = page.getByRole('textbox', { name: 'other input' })
  await other.focus()
  await page.evaluate(() => (window as any).eventListeners['rail-dismiss-popup']({ payload: null }))
  await expect(page.locator('.rail-popup')).toHaveCount(0)
  await expect(other).toBeFocused()
  await expect.poll(() => page.evaluate(() => (window as any).popupCalls.at(-1))).toBe(false)
})

test('clicking another card inside the same rail closes its menu', async ({ page }) => {
  await fixture(page, true)
  await page.locator('[data-rail-item="one"] .rail-item-menu').click()
  await expect(page.locator('.rail-popup')).toBeVisible()
  await page.evaluate(() => (window as any).finishPopup())
  const other = page.getByRole('button', { name: 'two，软件', exact: true })
  await other.click()
  await expect(page.locator('.rail-popup')).toHaveCount(0)
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'two')
  await expect.poll(() => page.evaluate(() => (window as any).popupCalls.at(-1))).toBe(false)
})

test('opening a desktop list tolerates webview blur and its entries remain clickable', async ({ page }) => {
  await fixture(page, true)
  await clickCord(page, true)
  const panel = page.getByRole('region', { name: '更多挂件', exact: true })
  await expect(panel).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new FocusEvent('blur')))
  await page.evaluate(() => (window as any).finishPopup())
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '选择two，软件', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'two')
})

test('closing a panel retires only its presentation and reopening cancels the exit', async ({ page }) => {
  await fixture(page, true)
  const trigger = page.locator('[data-rail-item="one"] .rail-item-menu')
  await trigger.click()
  const panel = page.locator('.rail-popup')
  await expect(panel).toBeVisible()
  await page.evaluate(() => (window as any).finishPopup())
  const transition = await page.evaluate(async () => {
    const panel = document.querySelector('.rail-popup') as HTMLElement
    const rail = document.querySelector('.rail-body')
    panel.querySelector<HTMLButtonElement>('[aria-label="关闭挂件面板"]')!.click()
    await new Promise(requestAnimationFrame)
    const exiting = { connected: panel.isConnected, state: panel.dataset.state, inert: panel.inert }
    document.querySelector<HTMLButtonElement>('[data-rail-item="one"] .rail-item-menu')!.click()
    await new Promise(requestAnimationFrame)
    return { exiting, samePanel: panel === document.querySelector('.rail-popup'), sameRail: rail === document.querySelector('.rail-body'), state: panel.dataset.state, inert: panel.inert }
  })
  expect(transition).toEqual({ exiting: { connected: true, state: 'closed', inert: true }, samePanel: true, sameRail: true, state: 'open', inert: false })
  await expect(panel).toBeVisible()
  await page.getByRole('button', { name: '关闭挂件面板' }).click()
  await expect(panel).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).popupCalls.at(-1))).toBe(false)
})

test('desktop rail sends panel requests without changing its own presentation', async ({ page }) => {
  await fixture(page, true, 'source')
  await page.locator('[data-rail-item="one"] .rail-item-menu').click()
  await expect.poll(() => page.evaluate(() => (window as any).popupRequests.filter(Boolean).length)).toBe(1)
  await expect(page.locator('.rail-popup')).toHaveCount(0)
  await expect(page.locator('.rail-body')).toBeVisible()
  const first = await page.evaluate(() => (window as any).popupRequests.filter(Boolean).at(-1))
  expect(first).toMatchObject({ mode: 'menu', itemId: 'one', width: 280 })
  expect(first.token).toBeTruthy()
  await page.locator('[data-rail-item="two"] .rail-item-menu').click()
  await page.evaluate(token => (window as any).eventListeners['rail-popup-closed']({ payload: token }), first.token)
  expect(await page.evaluate(() => (window as any).popupRequests.filter(Boolean).at(-1).itemId)).toBe('two')
  await expect(page.locator('.rail-popup-open')).toHaveCount(1)
  await page.getByRole('button', { name: '点击绳子添加挂件', exact: true }).press('Shift+Enter')
  await expect.poll(() => page.evaluate(() => (window as any).popupRequests.filter(Boolean).at(-1))).toMatchObject({ mode: 'more', itemId: 'two' })
})

test('companion panel restores initial state and hides only after its exit', async ({ page }) => {
  await fixture(page, true, 'host')
  const panel = page.getByRole('region', { name: '更多挂件', exact: true })
  await expect(panel).toBeVisible()
  await expect(page.locator('.rail-body, .rail-header')).toHaveCount(0)
  await expect(panel.locator('.rail-overflow-entry')).toHaveCount(3)
  await expect(panel.locator('.rail-overflow-entry[aria-pressed=true]')).toHaveAttribute('data-rail-list-item', 'two')
  await expect.poll(() => page.evaluate(() => (window as any).panelSizes.length)).toBeGreaterThan(0)
  await panel.getByRole('button', { name: '关闭挂件面板' }).click()
  await expect(page.locator('.rail-popup[data-state=closed]')).toHaveAttribute('inert', '')
  await expect(page.locator('.rail-popup')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as any).hiddenPanels)).toEqual(['initial-panel'])
})

// Temporary baseline check: keep the original horizontal spacing in the browser.
test.beforeEach(async ({ page }) => {
  await page.route('**/src/features/rail/rail-wheel.ts', async route => {
    const response = await route.fetch();
    const body = await response.text();
    const original = 'const step = Math.max(minimumStep, usableHalf / sideSlots);';
    if (!body.includes(original)) throw new Error('Baseline substitution was not applied');
    await route.fulfill({ response, body: body.replace(original, 'const step = minimumStep;') });
  });
});
