import { expect, test, type Page } from '@playwright/test'
import { fulfillFixtureEntry } from './helpers/fixture-entry'
import { defaults } from '../src/features/spectrum/model'
import type { RailSettings } from '../src/features/rail/model'

test.describe.configure({ timeout: 60_000 })
test.beforeEach(async ({ page }) => {
  // Other work in the shared checkout may update Vite during a long probe.
  // Keep the loaded component version stable without changing the desktop server.
  await page.routeWebSocket(/ws:\/\/127\.0\.0\.1:\d+/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => {
      if (typeof message === 'string' && ['update', 'full-reload'].includes(JSON.parse(message).type)) return
      socket.send(message)
    })
  })
})

const initial: RailSettings = { version: 1, enabled: false, groups: [
  { id: 'apps', name: '日常工具', x: .03, y: .1, width: .94, collapsed: false, items: [
    { id: 'note', name: '今天的灵感', kind: 'note', path: '', crop: 'cover', text: '音乐响起，留住此刻。' },
  ] },
  { id: 'work', name: '工作资料', x: .1, y: .5, width: .8, collapsed: false, items: [] },
] }

test('music settings save per group, survive reload and fit both themes on narrow screens', async ({ page }, info) => {
  const keyWarnings: string[] = []
  page.on('console', message => { if (message.type() === 'error' && /same key|unique.*key/i.test(message.text())) keyWarnings.push(message.text()) })
  await page.addInitScript(({ settings, rail }) => {
    if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(settings))
    if (!localStorage.getItem('soundspectra.rail.v1')) localStorage.setItem('soundspectra.rail.v1', JSON.stringify(rail))
  }, { settings: { ...defaults, regionVisible: false }, rail: initial })
  await page.goto('/#rail')
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  const section = page.getByRole('region', { name: '拾光绳音乐联动' })
  const toggle = section.getByRole('switch', { name: '跟随音乐' })
  await expect(toggle).not.toBeChecked()
  await expect(section.getByRole('combobox')).toHaveCount(0)
  await toggle.click()
  await expect(section.getByRole('status').filter({ hasText: '桌面端可接收音乐' })).toBeVisible()
  await section.getByRole('combobox', { name: '律动方式' }).click()
  await page.getByRole('option', { name: '节拍轻弹' }).click()
  const slider = section.getByRole('slider', { name: '律动幅度' })
  await slider.focus()
  await slider.press('End')
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.rail.v1')!) as RailSettings)
  await expect.poll(async () => (await stored()).groups[0].audioSync).toEqual({ enabled: true, profile: 'bounce', amount: 100 })
  const saved = await stored()
  expect(saved.groups[0].items).toEqual(initial.groups[0].items)
  expect(saved.groups[1]).toEqual(initial.groups[1])
  await page.reload()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await expect(toggle).toBeChecked()
  await expect(slider).toHaveAttribute('aria-valuenow', '100')
  await expect(section.getByRole('combobox')).toContainText('节拍轻弹')
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value }, theme)
      await section.scrollIntoViewIfNeeded()
      const box = (await section.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(width)
      await section.screenshot({ path: info.outputPath(`settings-${width}-${theme}.png`) })
    }
  }
  await page.getByRole('combobox', { name: '当前拾光绳', exact: true }).click()
  await page.getByRole('option').filter({ hasText: '工作资料' }).click()
  await expect(toggle).not.toBeChecked()
  expect((await stored()).groups[0]).toEqual(saved.groups[0])
  expect(keyWarnings).toEqual([])
})

async function fixture(page: Page, skin: string) {
  await page.addInitScript(() => { Object.assign(window, { isTauri: true }) })
  await page.route('**/src/main.tsx*', route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.listeners = {}; window.callbacks = new Map(); window.regions = []; window.opens = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__TAURI_INTERNALS__ = {
      transformCallback: callback => { const id = window.callbacks.size + 1; window.callbacks.set(id, callback); return id; },
      invoke: async (command, args) => {
        if (command === 'plugin:event|listen') { window.listeners[args.event] = window.callbacks.get(args.handler); return args.handler; }
        if (command === 'plugin:event|unlisten') { delete window.listeners[args.event]; return; }
        if (command === 'rail_hit_regions') window.regions.push(args.regions);
        if (command === 'rail_open') window.opens++;
        if (command === 'rail_double_click_interval') return 500;
        return null;
      }
    };
    function Fixture() {
      const [audioSync, setAudio] = React.useState({ enabled: true, profile: 'gentle', amount: 100 });
      const [items, setItems] = React.useState(Array.from({ length: 3 }, (_, i) => ({ id: 'item-' + i, name: '挂件 ' + i, kind: i ? 'note' : 'app', path: i ? '' : 'C:/editor.exe', text: '留住此刻 ' + i, crop: 'cover' })));
      window.configure = patch => setAudio(current => ({ ...current, ...patch }));
      window.remove = () => setItems(current => current.slice(1));
      const group = React.useMemo(() => ({ id: 'audio', name: '音乐联动', x: 0, y: 0, width: 1, collapsed: false, skin: ${JSON.stringify(skin)}, audioSync, items }), [audioSync, items]);
      const controller = { settings: { version: 1, enabled: true, groups: [group] }, loaded: true, pending: 0, missing: [], change: async () => {}, refresh: async () => {}, supported: true, error: null };
      return React.createElement('div', { className: 'rail-desktop', style: { width: 1000, margin: 24 } }, React.createElement(RailSurface, { group, controller, desktop: true }));
    }
    let sequence = 0;
    window.feed = () => {
      if (window.audioTimer) return;
      window.audioTimer = setInterval(() => {
        const rms = sequence % 23 < 3 ? .32 : .035;
        const payload = { sourceRevision: 1, streamId: 1, sequence, samplePosition: 4096 + sequence * 1024, sampleRate: 48000, rms, bandRms: Array(6).fill(rms * .7), bands: Array(6).fill(.45), spectrum: Array(48).fill(.5), skin: [] };
        window.listeners['music-analysis']?.({ payload }); sequence++;
      }, 1024 / 48);
    };
    window.silence = () => { clearInterval(window.audioTimer); window.audioTimer = undefined; };
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `))
  await page.goto('/?rail-audio-fixture')
  await expect(page.locator('.rail-hanging[data-rail-item]')).toHaveCount(3)
  await expect.poll(() => page.evaluate(() => !!(window as any).listeners['music-analysis'])).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as any).regions.length)).toBeGreaterThan(1)
}

test('resizing a desktop rail keeps every drawn cord in sync with its authored full-width path', async ({ page }) => {
  await page.setViewportSize({ width: 2800, height: 700 })
  await fixture(page, 'wisteria')
  await page.evaluate(() => (window as any).configure({ enabled: false }))
  for (const width of [2560, 620, 1920, 1000, 2560]) {
    await page.evaluate(width => { document.querySelector<HTMLElement>('.rail-surface')!.parentElement!.style.width = `${width}px` }, width)
    await expect(page.locator('.rail-surface')).toHaveJSProperty('clientWidth', width)
    await expect.poll(() => page.locator('.rail-surface').evaluate(host => {
      const unit = parseFloat(getComputedStyle(host).getPropertyValue('--rail-unit'))
      return [...host.querySelectorAll<SVGPathElement>('[data-rail-rope-path]')].map(path => ({
        matches: path.getAttribute('d') === path.dataset.railRopePath,
        reachesEnd: Math.abs(path.getPointAtLength(path.getTotalLength()).x - (host.clientWidth - 4 * unit)) < .01,
      }))
    })).toEqual(Array.from({ length: 6 }, () => ({ matches: true, reachesEnd: true })))
  }
})

for (const skin of ['woodland', 'floral', 'wisteria', 'autumn']) test(`${skin} music shares attachment offsets, fits native regions and settles for interaction`, async ({ page }, info) => {
  await fixture(page, skin)
  const sample = () => page.locator('.rail-surface').evaluate(host => {
    const node = host.querySelector<HTMLElement>('[data-wheel-active=true]')!
    const path = host.querySelector<SVGPathElement>('.rail-cord-hit')!
    const x = parseFloat(node.style.getPropertyValue('--wheel-x'))
    const data = path.getAttribute('d')!, points = [...data.matchAll(/[ML]\s*([-\d.]+)[,\s]+([-\d.]+)/g)].map(m => ({ x: +m[1], y: +m[2] }))
    const closest = points.reduce((a, b) => Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b, { x: 0, y: 0 })
    // Center is always an exact sample of the symmetric cord.
    const rest = path.dataset.railRopePath!, numbers = rest.match(/[-\d.]+/g)!.map(Number)
    const restingY = numbers[1] * .25 + numbers[3] * .5 + numbers[5] * .25
    return { drop: parseFloat(node.style.getPropertyValue('--rail-audio-drop')) || 0,
      cordDrop: closest.y - restingY, active: data !== rest,
      angle: parseFloat(node.querySelector<HTMLElement>('.rail-sway')!.style.getPropertyValue('--rail-sway-angle')) || 0 }
  })
  expect((await sample()).active).toBe(false)
  await page.evaluate(() => (window as any).feed())
  for (const profile of ['gentle', 'bounce', 'string']) {
    await page.evaluate(profile => (window as any).configure({ profile }), profile)
    await expect.poll(async () => Math.abs((await sample()).drop)).toBeGreaterThan(.02)
    for (let i = 0; i < 8; i++) {
      const value = await sample()
      expect(Math.abs(value.drop)).toBeLessThanOrEqual(4.05)
      expect(Math.abs(value.cordDrop - value.drop)).toBeLessThan(.03)
    }
  }
  await page.screenshot({ path: info.outputPath(`music-${skin}.png`) })
  const clipping = await page.locator('.rail-surface').evaluate(host => {
    const box = host.getBoundingClientRect(), dpi = devicePixelRatio
    const regions = (window as any).regions.at(-1)
    const covered = (x: number, y: number) => regions.some((r: any) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    const missed = [...host.querySelectorAll('.rail-floral-sprig :is(path, ellipse, circle, image), .rail-leaf-canopy :is(path, image), .rail-botanical-cord > g, .rail-themed-thread')].flatMap(shape => {
      const b = shape.getBoundingClientRect()
      let points = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]
      if (shape instanceof SVGGeometryElement) {
        const length = shape.getTotalLength(), matrix = shape.getScreenCTM()!, samples = Math.max(1, Math.ceil(length))
        points = Array.from({ length: samples + 1 }, (_, i) => {
          const p = shape.getPointAtLength(length * i / samples).matrixTransform(matrix)
          return [p.x, p.y]
        })
      }
      return points.filter(([x, y]) => !covered((x - box.x) * dpi, (y - box.y) * dpi))
    })
    return { missed: missed.length, validCount: regions.length > 0 && regions.length <= 256 }
  })
  expect(clipping).toEqual({ missed: 0, validCount: true })
  // Configuration changes publish once, with a final tightened region after 440 ms.
  await page.waitForTimeout(500)
  const count = await page.evaluate(() => (window as any).regions.length)
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => (window as any).regions.length)).toBe(count)
  // Real pointer proximity must stop animation so ordinary click remains usable.
  const card = page.locator('[data-wheel-active=true] .rail-item')
  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect.poll(async () => Math.abs((await sample()).drop)).toBeLessThan(.001)
  await expect.poll(async () => Math.abs((await sample()).angle)).toBeLessThan(.00001)
  await card.click()
  await expect.poll(() => page.evaluate(() => (window as any).opens)).toBe(1)
  await card.focus()
  await page.mouse.move(1200, 800)
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur())
  await expect.poll(async () => Math.abs((await sample()).drop)).toBeGreaterThan(.02)
  // No capture after 350 ms: return to the authored curve while wind remains.
  await page.evaluate(() => (window as any).silence())
  await expect.poll(async () => (await sample()).active, { timeout: 5000 }).toBe(false)
  await page.evaluate(() => (window as any).feed())
  await expect.poll(async () => (await sample()).active).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(async () => (await sample()).active).toBe(false)
  expect((await sample()).drop).toBe(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect.poll(async () => (await sample()).active).toBe(true)
  await page.evaluate(() => (window as any).configure({ enabled: false }))
  await expect.poll(async () => (await sample()).active).toBe(false)
  expect((await sample()).drop).toBe(0)
  await expect.poll(() => page.evaluate(() => !!(window as any).listeners['music-analysis'])).toBe(false)
})
