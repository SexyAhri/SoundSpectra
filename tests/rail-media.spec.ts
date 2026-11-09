import { expect, test } from '@playwright/test'
import { fulfillFixtureEntry } from './helpers/fixture-entry'

test.beforeEach(async ({ page }) => {
  await page.routeWebSocket('**', socket => {
    socket.send(JSON.stringify({ type: 'connected' })); socket.onMessage(() => {})
  })
  await page.addInitScript(() => Object.assign(window, { isTauri: true }))
  await page.route('**/src/main.tsx*', route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailMedia } from '/src/features/rail/rail-media.tsx';
    const mode = new URLSearchParams(location.search).get('mode');
    window.calls = [];
    const valid = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>');
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command !== 'rail_media') throw Error(command);
      window.calls.push(args.id);
      if (mode === 'pending') return new Promise(resolve => window.finish = resolve);
      if (mode === 'missing' || (mode === 'empty' && window.calls.length < 3)) return null;
      if (mode === 'error' && window.calls.length < 3) throw Error('Shell is still starting');
      if (mode === 'invalid' && window.calls.length < 3) return 'data:image/png;base64,invalid';
      return valid;
    } };
    function Fixture() {
      const [item, setItem] = React.useState({ id:'one', path:'C:/one.lnk', kind:new URLSearchParams(location.search).get('kind') ?? 'app', name:'App', crop:'contain' });
      const [visible, setVisible] = React.useState(true);
      window.replace = () => setItem({ ...item, id:'two', path:'C:/two.lnk' });
      window.unmount = () => setVisible(false);
      return React.createElement('main', null, visible && React.createElement(RailMedia, { item, unavailable: mode === 'unavailable' }));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `))
})

for (const mode of ['empty', 'error', 'invalid']) {
  test(`preview icons recover from ${mode} startup media without toggling the rail`, async ({ page }) => {
    await page.goto('/?mode=' + mode)
    await expect(page.locator('main img')).toBeVisible({ timeout: 10000 })
    expect(await page.locator('main img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    expect(await page.evaluate(() => (window as any).calls)).toEqual(['one', 'one', 'one'])
  })
}

test('unavailable references do not request media', async ({ page }) => {
  await page.goto('/?mode=unavailable')
  await expect(page.locator('main svg')).toBeVisible()
  expect(await page.evaluate(() => (window as any).calls)).toEqual([])
})

test('photo placeholder gives way to a decoded real preview', async ({ page }) => {
  await page.goto('/?mode=pending&kind=image')
  await expect(page.getByText('暂无预览', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).calls.length)).toBe(1)
  await page.evaluate(() => (window as any).finish('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/></svg>')))
  const image = page.getByRole('img', { name: 'App', exact: true })
  await expect(image).toBeVisible()
  expect(await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true)
  await expect(page.locator('.rail-photo-placeholder')).toHaveCount(0)
})

test('failed media retries stop after a bounded startup window', async ({ page }) => {
  await page.goto('/?mode=missing')
  await expect.poll(() => page.evaluate(() => (window as any).calls.length), { timeout: 10000 }).toBe(4)
  await page.clock.install()
  await page.clock.runFor(60000)
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(4)
})

test('unmount cancels retries and late replies cannot restore a replaced item', async ({ page }) => {
  await page.goto('/?mode=pending')
  await expect.poll(() => page.evaluate(() => (window as any).calls.length)).toBe(1)
  await page.evaluate(() => { const w = window as any; w.oldFinish = w.finish; w.replace() })
  await expect.poll(() => page.evaluate(() => (window as any).calls)).toEqual(['one', 'two'])
  await page.evaluate(() => (window as any).oldFinish(null))
  await page.clock.install()
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['one', 'two'])
  await page.evaluate(() => (window as any).unmount())
  await page.evaluate(() => (window as any).finish(null))
  await page.clock.runFor(10000)
  expect(await page.evaluate(() => (window as any).calls)).toEqual(['one', 'two'])
  await expect(page.locator('main img')).toHaveCount(0)
})
