import { expect, test } from '@playwright/test'

test('a recreated overlay subscribes first and cannot restore stale layout over live settings', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { isTauri: true }))
  await page.route('**/src/main.tsx*', route => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { DesktopOverlay } from '/src/features/desktop/desktop-overlay.tsx';
    import { defaults, browserStatus } from '/src/features/spectrum/model.ts';
    import { emptyNowPlaying } from '/src/features/desktop-card/use-now-playing.ts';
    window.commands = []; window.callbacks = new Map(); window.eventListeners = {};
    const initial = { ...defaults, enabled: true, regionVisible: false,
      desktopCard: { ...defaults.desktopCard, enabled: true, variant: 'compact' } };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      window.commands.push(command);
      if (command === 'plugin:event|listen') { window.eventListeners[args.event] = window.callbacks.get(args.handler); return args.handler; }
      if (command === 'plugin:event|unlisten') return;
      if (command === 'get_settings') return new Promise(resolve => { window.finishSettings = () => resolve(initial); });
      if (command === 'get_status') return browserStatus;
      if (command === 'get_now_playing') return emptyNowPlaying;
      if (command === 'rail_get') return { settings: { version: 1, enabled: false, groups: [] }, missing: [], desktopError: null, supported: true };
      return null;
    }, transformCallback: callback => { const id = window.callbacks.size + 1; window.callbacks.set(id, callback); return id; } };
    window.showNewLayout = () => window.eventListeners['settings-changed']({ payload: {
      ...initial, desktopCard: { ...initial.desktopCard, variant: 'afternoon' }
    } });
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(DesktopOverlay));
  ` }))
  await page.goto('/?window=overlay')
  await expect.poll(() => page.evaluate(() => typeof (window as any).finishSettings)).toBe('function')
  const commands = await page.evaluate(() => (window as any).commands as string[])
  expect(commands.indexOf('plugin:event|listen')).toBeLessThan(commands.indexOf('get_settings'))
  await page.evaluate(() => (window as any).showNewLayout())
  await expect(page.locator('.music-card-afternoon')).toBeVisible()
  await page.evaluate(() => (window as any).finishSettings())
  await expect(page.locator('.music-card-afternoon')).toBeVisible()
  await expect(page.locator('.music-card-compact')).toHaveCount(0)
})
