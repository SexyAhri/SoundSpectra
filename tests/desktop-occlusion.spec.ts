import { expect, test, type Page } from '@playwright/test'
import { fulfillFixtureEntry } from './helpers/fixture-entry'

async function railWindow(page: Page, initiallyOccluded = false, deferRead = false) {
  await page.addInitScript(() => { Object.assign(window, { isTauri: true }) })
  await page.route('**/src/main.tsx*', route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailDesktop } from '/src/features/rail/rail-desktop.tsx';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    const callbacks = new Map(), listeners = new Map();
    let id = 0;
    const group = { id: 'test', name: '遮挡检查', x: 0, y: 0, width: 1, collapsed: false, skin: 'floral',
      audioSync: { enabled: true, profile: 'gentle', amount: 35 },
      items: [{ id: 'note', name: '测试挂件', kind: 'note', path: '', text: '保留内容', crop: 'cover' }] };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'rail-test' }, currentWebview: { label: 'rail-test' } },
      transformCallback: callback => { callbacks.set(++id, callback); return id },
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') { listeners.set(args.handler, args.event); return args.handler }
        if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return }
        if (command === 'rail_get') return { settings: { version: 1, enabled: true, groups: [group] }, supported: true, missing: [], desktopError: null };
        if (command === 'rail_double_click_interval') return 500;
        if (command === 'get_desktop_occlusion') {
          window.occlusionRead = true;
          if (${deferRead}) return new Promise(resolve => { window.finishRead = () => resolve({ occluded: ${initiallyOccluded} }) });
          return { occluded: ${initiallyOccluded} };
        }
        return null;
      }
    };
    window.occlude = occluded => {
      for (const [id, event] of listeners) if (event === 'desktop://occlusion_changed')
        callbacks.get(id)({ event, id, payload: { occluded } });
    };
    window.audioListeners = () => [...listeners.values()].filter(event => event === 'music-analysis').length;
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(RailDesktop));
  `))
  await page.goto('/?window=rail&group=test')
  await expect(page.locator('.rail-surface')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).occlusionRead)).toBe(true)
}

async function rafCalls(page: Page) {
  return page.evaluate(async () => {
    const original = window.requestAnimationFrame
    let calls = 0
    window.requestAnimationFrame = callback => { calls++; return original(callback) }
    await new Promise(resolve => setTimeout(resolve, 250))
    window.requestAnimationFrame = original
    return calls
  })
}

test('independent rail sleeps from its own initial state, resumes, and releases audio while covered', async ({ page, context }) => {
  const visibleRail = await context.newPage()
  await railWindow(visibleRail)
  await railWindow(page, true)
  const surface = page.locator('.rail-surface')
  await expect(surface).toHaveAttribute('data-breeze-active', 'false')
  await expect(visibleRail.locator('.rail-surface')).toHaveAttribute('data-breeze-active', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).audioListeners())).toBe(0)
  expect(await rafCalls(page)).toBe(0)
  await page.evaluate(() => (window as any).occlude(false))
  await expect(surface).toHaveAttribute('data-breeze-active', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).audioListeners())).toBe(1)
  await expect.poll(() => rafCalls(page)).toBeGreaterThan(0)
  await page.evaluate(() => (window as any).occlude(true))
  await expect(surface).toHaveAttribute('data-breeze-active', 'false')
  expect(await rafCalls(page)).toBe(0)
  await expect(page.locator('[data-rail-item=note]')).toContainText('保留内容')
  await visibleRail.close()
})

test('a stale initial read cannot override a newer uncover event', async ({ page }) => {
  await railWindow(page, true, true)
  await page.evaluate(() => {
    ;(window as any).occlude(false)
    ;(window as any).finishRead()
  })
  // Let the delayed read settle before checking its effect on the new state.
  await rafCalls(page)
  await expect(page.locator('.rail-surface')).toHaveAttribute('data-breeze-active', 'true')
})
