import { expect, test, type Page } from '@playwright/test'
import { fulfillFixtureEntry } from './helpers/fixture-entry'
import { writeFileSync } from 'node:fs'

// Real rendering with isolated state and mocked Shell boundaries.
async function fixture(page: Page, count: number) {
  await page.addInitScript(() => { Object.assign(window, { isTauri: true }) })
  await page.route('**/src/main.tsx*', route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.__TAURI_INTERNALS__ = { invoke: async command => command === 'rail_double_click_interval' ? 500 : null, transformCallback: () => 1 };
    function Fixture() {
      const [items, setItems] = React.useState(Array.from({ length: ${count} }, (_, i) => ({ id: 'item-' + i, name: '挂件 ' + i, kind: 'note', path: '', text: '渲染检查 ' + i, crop: 'cover' })));
      const [selected, select] = React.useState('item-0');
      window.selectItem = select;
      window.removeItem = id => setItems(current => current.filter(item => item.id !== id));
      const group = React.useMemo(() => ({ id: 'animation', name: '动画检查', x: 0, y: 0, width: 1, collapsed: false, items }), [items]);
      const controller = { settings: { version: 1, enabled: true, groups: [group] }, loaded: true, pending: 0, error: null, desktopError: null, supported: true, missing: [], change: async () => {}, refresh: async () => {} };
      return React.createElement('div', { style: { width: 1000, margin: 40 } }, React.createElement(RailSurface, { group, controller, selected, onSelect: (_, id) => select(id) }));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `))
  await page.goto('/?rail-animation-fixture')
  await expect(page.locator('.rail-hanging[data-rail-item]')).toHaveCount(count)
  await page.locator('.rail-surface').evaluate(async node => {
    await Promise.all(node.getAnimations({ subtree: true }).filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))
  })
}

test('removing a rotating hanging continues from its visible position', async ({ page }, info) => {
  await fixture(page, 12)
  const samples = await page.evaluate(async () => {
    const app = window as any
    app.selectItem('item-1')
    const target = document.querySelector<HTMLElement>('[data-rail-item="item-1"]')!
    const initialX = target.getBoundingClientRect().x
    for (let i = 0; i < 30; i++) {
      await new Promise(requestAnimationFrame)
      if (Math.abs(target.getBoundingClientRect().x - initialX) > 40) break
    }
    const before = target.getBoundingClientRect()
    app.removeItem('item-1')
    await new Promise(requestAnimationFrame)
    const ghost = document.querySelector<HTMLElement>('.rail-exiting')!
    const after = ghost.getBoundingClientRect()
    return { before: { x: before.x, y: before.y }, after: { x: after.x, y: after.y }, jump: Math.hypot(before.x - after.x, before.y - after.y) }
  })
  await info.attach('removal-position.json', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' })
  writeFileSync(info.outputPath('removal-position.json'), JSON.stringify(samples, null, 2))
  expect(samples.jump).toBeLessThan(12)
  await expect(page.locator('.rail-exiting')).toHaveCount(0)
})

test('full rail rendering records idle and rotating layout work', async ({ page }, info) => {
  await fixture(page, 48)
  const cdp = await page.context().newCDPSession(page)
  await page.evaluate(() => {
    const clone = Element.prototype.cloneNode
    ;(window as any).railCloneCount = 0
    Element.prototype.cloneNode = function (deep) {
      if (this instanceof Element && this.classList.contains('rail-hanging')) (window as any).railCloneCount++
      return clone.call(this, deep)
    }
  })
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m: { name: string; value: number }) => [m.name, m.value]))
  const before = await metrics()
  await page.evaluate(async () => { for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame) })
  const idle = await metrics()
  await page.evaluate(async () => {
    for (let i = 1; i <= 8; i++) {
      ;(window as any).selectItem('item-' + i)
      for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame)
    }
  })
  const moving = await metrics()
  const delta = (a: typeof before, b: typeof before) => Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'TaskDuration'].map(key => [key, b[key] - a[key]]))
  const result = { idle: delta(before, idle), moving: delta(idle, moving), visible: await page.locator('.rail-hanging:not([inert])').count(), total: 48, clones: await page.evaluate(() => (window as any).railCloneCount) }
  await info.attach('render-metrics.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  writeFileSync(info.outputPath('render-metrics.json'), JSON.stringify(result, null, 2))
  await page.screenshot({ path: info.outputPath('full-rail.png') })
  await expect(page.locator('[data-wheel-active=true]')).toHaveAttribute('data-rail-item', 'item-8')
  expect(result.clones).toBe(0)
  // Updating the selection may need layout, but interpolating its position must
  // not recalculate layout on every one of the 40 sampled animation frames.
  expect(result.moving.LayoutCount).toBeLessThanOrEqual(8)
  await cdp.detach()
})

test('resizing preserves centering and wheel animation survives system motion changes', async ({ page }) => {
  await fixture(page, 48)
  const surface = page.locator('.rail-surface')
  const active = surface.locator('[data-wheel-active=true]')
  await page.evaluate(() => {
    ;(window as any).selectItem('item-8')
    document.querySelector<HTMLElement>('.rail-surface')!.parentElement!.style.width = '620px'
  })
  await expect(active).toHaveAttribute('data-rail-item', 'item-8')
  await expect(surface).toHaveJSProperty('clientWidth', 620)
  const centered = () => surface.evaluate(node => {
    const host = node.getBoundingClientRect(), card = node.querySelector('[data-wheel-active=true]')!.getBoundingClientRect()
    return Math.abs(card.x + card.width / 2 - host.x - host.width / 2)
  })
  await expect.poll(centered).toBeLessThan(2)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const positions = await surface.evaluate(async node => {
    (window as any).selectItem('item-3')
    const values: number[] = []
    for (let i = 0; i < 40; i++) {
      await new Promise(requestAnimationFrame)
      values.push(node.querySelector('[data-rail-item="item-3"]')!.getBoundingClientRect().x)
    }
    return values
  })
  expect(new Set(positions.map(Math.round)).size).toBeGreaterThan(4)
  await expect(active).toHaveAttribute('data-rail-item', 'item-3')
  await expect.poll(centered).toBeLessThan(2)
})
