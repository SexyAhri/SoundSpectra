import { fulfillFixtureEntry } from './helpers/fixture-entry'
import { railSection } from './helpers/module-settings'
import { expect, test, type Page } from '@playwright/test'
import { clickCord } from './rail-helpers'

// Exercise real components with delayed IPC, without launching a desktop window
// or touching the user's persisted configuration.
async function fixture(page: Page, surface = false, popupWindow?: 'source' | 'host', surfaceWidth = 860) {
  await page.route('**/src/main.tsx*', route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import { RailControls } from '/src/features/rail/rail-controls.tsx';
    import { changeRail } from '/src/features/rail/model.ts';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    import '/src/features/settings/module-settings.css';
    window.changes = []; window.popupCalls = []; window.popupRequests = []; window.panelSizes = []; window.hiddenPanels = []; window.hitRegions = []; window.eventListeners = {}; window.callbacks = new Map();
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
      if (command === 'rail_hit_regions') window.hitRegions.push(args.regions);
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
      return React.createElement('div', { className: ${surface} ? 'rail-desktop' : '', style: { width: ${surface ? surfaceWidth : 390}, margin: 24 } },
        React.createElement('input', { 'aria-label': 'other input' }), children);
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `));
  await page.addInitScript(() => { Object.assign(window, { isTauri: true }) })
  await page.goto('/?rail-input-fixture')
}

test('desktop discovery finishing or refreshing cannot steal an edited field', async ({ page }) => {
  await fixture(page)
  await railSection(page, '添加')
  await page.getByRole('button', { name: '从桌面添加', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '正在读取' })).toBeVisible()
  // The chooser is modal; an editable field inside it must keep focus.
  await page.getByRole('dialog').evaluate(dialog => { const input = document.createElement('input'); input.setAttribute('aria-label', 'chooser input'); dialog.append(input) })
  const other = page.getByRole('textbox', { name: 'chooser input' })
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
  await railSection(page, '布局')
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

test('native regions cover a full-width cord without gaps and preserve desktop space', async ({ page }) => {
  await page.setViewportSize({ width: 2800, height: 700 })
  await fixture(page, true, 'source', 2560)
  await expect.poll(() => page.evaluate(() => (window as any).hitRegions.length)).toBeGreaterThan(0)
  const result = await page.locator('.rail-surface').evaluate(node => {
    const regions = (window as any).hitRegions.at(-1) as { x: number; y: number; width: number; height: number }[]
    const host = node.getBoundingClientRect(), dpi = devicePixelRatio
    const path = node.querySelector('.rail-cord-hit') as SVGPathElement
    const covers = (x: number, y: number) => regions.some(r => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    const holes = []
    for (let i = 0; i <= 1000; i++) {
      const point = path.getPointAtLength(path.getTotalLength() * i / 1000)
      const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!)
      if (!covers((screen.x - host.x) * dpi, (screen.y - host.y) * dpi)) holes.push(i)
    }
    return { holes, count: regions.length, desktopBelow: covers(host.width / 2 * dpi, (host.height - 2) * dpi) }
  })
  expect(result.holes).toEqual([])
  expect(result.count).toBeLessThanOrEqual(256)
  expect(result.desktopBelow).toBe(false)
  await clickCord(page)
  await expect.poll(() => page.evaluate(() => (window as any).popupRequests.filter(Boolean).at(-1)?.mode)).toBe('add')
})

test('wind sways hangings independently and pauses for interaction and reduced motion', async ({ page }) => {
  await fixture(page, true, 'source')
  await page.mouse.move(5, 5)
  const sway = page.locator('[data-rail-item="one"] .rail-sway')
  await expect.poll(() => sway.evaluate(node => node.getAnimations().some(a => a.playState === 'running'))).toBe(true)
  const first = await sway.evaluate(node => getComputedStyle(node).transform)
  await expect.poll(() => sway.evaluate(node => getComputedStyle(node).transform)).not.toBe(first)
  const timings = await page.locator('.rail-sway').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).animationDelay))
  expect(new Set(timings).size).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'one，软件', exact: true }).hover()
  await expect.poll(() => sway.evaluate(node => getComputedStyle(node).animationPlayState)).toBe('paused')
  await page.getByRole('button', { name: 'one的操作', exact: true }).focus()
  await page.mouse.move(5, 5)
  await expect.poll(() => sway.evaluate(node => getComputedStyle(node).animationPlayState)).toBe('paused')
  await page.getByRole('button', { name: 'one，软件', exact: true }).click({ button: 'right' })
  expect(await page.evaluate(() => (window as any).popupRequests.filter(Boolean))).toEqual([])
  await page.getByRole('button', { name: 'one的操作', exact: true }).press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).popupRequests.filter(Boolean).at(-1)?.mode)).toBe('menu')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => sway.evaluate(node => node.getAnimations().length)).toBe(0)
})

test('native animation keeps moving cards inside the region without updates on every frame', async ({ page }) => {
  await page.setViewportSize({ width: 2800, height: 700 })
  await fixture(page, true, 'source', 2560)
  await expect.poll(() => page.evaluate(() => (window as any).hitRegions.length)).toBeGreaterThan(0)
  await expect.poll(() => page.locator('.rail-surface').evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).length)).toBe(0)
  await page.evaluate(() => { (window as any).hitRegions = [] })
  await page.locator('[data-wheel-active=true] .rail-item').press('ArrowRight')
  const frames = await page.locator('.rail-surface').evaluate(async node => {
    const frames = []
    for (let i = 0; i < 20; i++) {
      await new Promise(requestAnimationFrame)
      const regions = (window as any).hitRegions.at(-1) as { x: number; y: number; width: number; height: number }[] | undefined
      const host = node.getBoundingClientRect()
      const clipped = [...node.querySelectorAll<HTMLElement>('.rail-hanging:not([inert])')].filter(card => {
        const box = card.querySelector('.rail-sway')!.getBoundingClientRect()
        return [[box.left + 2, box.top + 2], [box.right - 2, box.bottom - 2]].some(([x, y]) => !regions?.some(r =>
          (x - host.x) * devicePixelRatio >= r.x && (x - host.x) * devicePixelRatio <= r.x + r.width &&
          (y - host.y) * devicePixelRatio >= r.y && (y - host.y) * devicePixelRatio <= r.y + r.height))
      }).map(card => card.dataset.railItem)
      frames.push(clipped)
    }
    return { frames, calls: (window as any).hitRegions.length }
  })
  expect(frames.frames.flat()).toEqual([])
  expect(frames.calls).toBeLessThanOrEqual(5)
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
