// Run against this application's debug build on port 9223, without concurrent user edits.
// Temporary scene changes are restored in finally; no synthetic audio is sent to the desktop.
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('artifacts', { recursive: true })
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const pages = browser.contexts().flatMap(context => context.pages())
const page = pages.find(p => p.url().startsWith('http://tauri.localhost') && !p.url().includes('window=overlay'))
const overlay = pages.find(p => p.url().includes('window=overlay'))
assert.ok(page && overlay, 'Requires packaged settings and desktop windows')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const report = { errors: [], samples: [], audioInput: 'native only; no injected audio' }
for (const target of [page, overlay]) target.on('pageerror', e => report.errors.push(e.message))
const neutral = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, distance: 1 }
const desktopCanvas = id => overlay.locator(`[data-region-id="${id}"] .three-scene-surface canvas`)
const viewOf = canvas => canvas.getAttribute('data-view').then(value => value ? JSON.parse(value) : null)
let original
try {
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  original = await invoke('get_settings')
  writeFileSync('artifacts/native-scene-view-settings-backup.json', JSON.stringify(original, null, 2))
  const status = await invoke('get_status')
  assert.equal(status.editing, false, 'Finish desktop position editing before running this check')
  const config = { ...original, enabled: true, regionVisible: true, effect: 'star_flight', view: neutral,
    bounds: { x: 0, y: 0, width: 1, height: 1 }, regions: [], masks: [],
    desktopCard: { ...original.desktopCard, enabled: false } }
  const extra = Object.fromEntries(['effect','sceneMode','view','color','opacity','sensitivity','decay','reflection','glow','bounds','atmosphere','music'].map(key => [key, config[key]]))
  config.regions = [{ ...extra, id: 'view-check', name: '视角验证', visible: true, effect: 'petal_bloom',
    bounds: { x: .72, y: .1, width: .26, height: .36 }, view: { ...neutral, yaw: 33 } }]
  await invoke('update_settings', { settings: config })
  await page.reload()
  await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
  const preview = page.locator('[data-region-id="primary"] .three-scene-surface canvas')
  await expect(preview).toHaveAttribute('data-renderer', 'three')
  await expect.poll(() => viewOf(desktopCanvas('primary')), { timeout: 15000 }).toEqual(neutral)
  const sync = async label => {
    await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
    const state = await invoke('get_settings')
    await expect.poll(() => viewOf(desktopCanvas('primary')), { timeout: 10000 }).toEqual(state.view)
    await expect.poll(() => viewOf(preview)).toEqual(state.view)
    await expect.poll(() => viewOf(desktopCanvas('view-check'))).toEqual(state.regions[0].view)
    report.samples.push({ label, view: state.view, extra: state.regions[0].view })
    return state
  }
  const box = await preview.boundingBox()
  const x = box.x + box.width * .22, y = box.y + box.height * .4
  await page.mouse.move(x,y); await page.mouse.down()
  for (const fraction of [.15,.3,.45]) {
    await page.mouse.move(x + box.width * fraction, y + box.height * fraction * .45, { steps: 8 })
    const start = Date.now(), state = await sync(`held drag ${fraction}`)
    report.samples.at(-1).settleMs = Date.now() - start
    assert.ok(Math.abs(state.view.yaw) > fraction * 100)
  }
  await page.mouse.up()
  await page.keyboard.down('Shift'); await page.mouse.move(x,y); await page.mouse.down()
  await page.mouse.move(x+60,y+30,{ steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift')
  assert.ok((await sync('pan')).view.x > 0)
  await page.keyboard.down('Alt'); await page.mouse.move(x,y); await page.mouse.down()
  await page.mouse.move(x+70,y,{ steps: 5 }); await page.mouse.up(); await page.keyboard.up('Alt')
  assert.ok((await sync('roll')).view.roll > 0)
  await page.mouse.wheel(0,-200)
  assert.ok((await sync('dolly')).view.distance < 1)
  await page.getByRole('tab',{name:'位置',exact:true}).click()
  for (const name of ['左右旋转','上下旋转','画面旋转','水平平移','垂直平移','前后距离']) {
    await page.getByRole('slider',{name,exact:true}).focus()
    await page.keyboard.press('ArrowRight')
    await sync(`slider ${name}`)
  }
  await page.getByRole('button',{name:'向右转',exact:true}).click()
  const expected = (await sync('fine turn')).view
  await page.getByRole('button',{name:'放大预览',exact:true}).click()
  await expect.poll(() => viewOf(page.getByRole('dialog').locator('[data-region-id="primary"] canvas'))).toEqual(expected)
  await page.getByRole('button',{name:'关闭放大预览',exact:true}).click()
  await page.reload()
  await expect.poll(() => viewOf(preview)).toEqual(expected)
  await page.getByRole('tab',{name:'位置',exact:true}).click()
  await page.getByRole('button',{name:'恢复三维视角',exact:true}).click()
  assert.deepEqual((await sync('reset')).view, neutral)
  // Exercise a secondary region through the same public settings UI.
  await page.getByRole('combobox',{name:'当前装饰区域'}).click()
  await page.getByRole('option',{name:'视角验证',exact:true}).click()
  await page.getByRole('button',{name:'向右转',exact:true}).click()
  const changed = await sync('secondary region')
  assert.deepEqual(changed.view, neutral)
  assert.equal(changed.regions[0].view.yaw,38)
  await page.getByRole('combobox',{name:'当前装饰区域'}).click()
  await page.getByRole('option',{name:original.regionName,exact:true}).click()
  for(const label of ['频谱回响','极光流域','星瓣花境','星尘航道']) {
    await page.getByRole('tab',{name:'动效',exact:true}).click()
    await page.getByRole('button',{name:label,exact:true}).click()
    await page.getByRole('tab',{name:'位置',exact:true}).click()
    await page.getByRole('button',{name:'向上转',exact:true}).click()
    await sync(`scene ${label}`)
  }
  report.rendered = await desktopCanvas('primary').evaluate(canvas => ({ ...canvas.dataset }))
  report.desktop = await invoke('debug_desktop_state')
  assert.equal(report.desktop.transparent,true)
  assert.equal(report.desktop.topmost,false)
  assert.equal((await invoke('get_status')).desktopAttached,true)
  if(report.desktop.parentClass === 'Progman') assert.equal(report.desktop.betweenDesktopLayers,true)
  report.status = await invoke('get_status')
  report.layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }))
  assert.ok(report.layout.scrollWidth <= report.layout.width && report.layout.scrollHeight <= report.layout.height)
  await page.screenshot({ path: 'artifacts/native-scene-view-controls.png' })
  assert.deepEqual(report.errors,[])
  report.passed = true
} catch (error) {
  report.error = String(error); process.exitCode = 1
  report.failure = await overlay.evaluate(() => ({ visibility: document.visibilityState,
    canvas: [...document.querySelectorAll('canvas')].map(c => ({ width:c.width,height:c.height,data:{...c.dataset} })),
    alerts: [...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent) }))
  report.status = await invoke('get_status')
  report.desktop = await invoke('debug_desktop_state')
}
finally {
  await page.mouse.up().catch(() => {})
  for(const key of ['Shift','Alt']) await page.keyboard.up(key).catch(() => {})
  if(original) {
    try {
      await invoke('update_settings',{settings:original})
      await page.reload()
      assert.deepEqual(await invoke('get_settings'),original)
      report.restored = true
    } catch(error) { report.restoreError = String(error); process.exitCode = 1 }
  }
  writeFileSync('artifacts/native-scene-view.json',JSON.stringify(report,null,2))
  console.log(JSON.stringify(report,null,2))
  await browser.close()
}
