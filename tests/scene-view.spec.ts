import { chooseStyle } from './helpers/module-settings'
import { openDetails, settingsSection } from './helpers/module-settings'
import { test, expect } from '@playwright/test'
import { defaults, normalizeSettings } from '../src/features/spectrum/model'
import { defaultSceneView, normalizeSceneView, rotateSceneView } from '../src/features/spectrum/three/view'
import { regionPatch } from '../src/features/spectrum/regions'
import { importScene, layout, sceneDocument } from '../src/features/preview/scene-library'

const saved = (page: import('@playwright/test').Page) => page.evaluate(() => JSON.parse(localStorage.getItem('soundspectra.settings.v1')!))

test('precise view sliders, presets and drift directions persist independently', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto('/#scene')
  await chooseStyle(page, '灯效', '雪花飘舞')
  await settingsSection(page, '位置')
  await page.getByText('精细视角', { exact: true }).click()
  await page.getByRole('button', { name: '恢复三维视角', exact: true }).click()
  await page.getByRole('slider', { name: '左右旋转', exact: true }).press('ArrowRight')
  await expect.poll(async () => (await saved(page)).view.yaw).toBe(1)
  await page.getByRole('slider', { name: '上下旋转', exact: true }).press('ArrowLeft')
  await expect.poll(async () => (await saved(page)).view.pitch).toBe(-1)
  await page.getByRole('button', { name: '俯视角度', exact: true }).click()
  await expect.poll(async () => (await saved(page)).view.pitch).toBe(-35)
  await page.getByRole('button', { name: '默认朝向', exact: true }).click()
  const canvas = page.locator('.three-scene-surface canvas').first()
  const box = (await canvas.boundingBox())!
  await page.keyboard.down('Control')
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .55, box.y + box.height * .4, { steps: 6 })
  await page.mouse.up(); await page.keyboard.up('Control')
  await expect.poll(async () => (await saved(page)).view.yaw).toBeCloseTo(-6, 0)
  await canvas.press('Home')
  await expect.poll(async () => (await saved(page)).view).toEqual(defaultSceneView)
  await settingsSection(page, '动效')
  await settingsSection(page, '动效')
  await openDetails(page, '造型细节')
  await page.getByRole('slider', { name: '飘雪风向', exact: true }).press('Home')
  await expect.poll(async () => (await saved(page)).music.rippleTwist).toBe(-1.5)
  await page.reload()
  await settingsSection(page, '动效')
  await settingsSection(page, '动效')
  await openDetails(page, '造型细节')
  await expect(page.getByRole('slider', { name: '飘雪风向', exact: true })).toHaveAttribute('aria-valuenow', '-1.5')
  await expect.poll(async () => (await saved(page)).view).toEqual(defaultSceneView)
  await page.screenshot({ path: 'artifacts/snow-direction-controls.png' })
  await settingsSection(page, '动效')
  await chooseStyle(page, '灯效', '晴空浮游')
  await settingsSection(page, '动效')
  await settingsSection(page, '动效')
  await openDetails(page, '造型细节')
  await page.getByRole('slider', { name: '风向倾角', exact: true }).press('End')
  await expect.poll(async () => (await saved(page)).music.meteorAngle).toBe(45)
  await page.getByRole('button', { name: '恢复当前灯效参数', exact: true }).click()
  await expect.poll(async () => (await saved(page)).music.meteorAngle).toBe(defaults.music.meteorAngle)
})

test('view state is independent per region, survives export and keeps old scenes compatible', () => {
  const settings = normalizeSettings({ ...defaults, effect: 'star_flight', view: { yaw: 150, pitch: -100, roll: 60, x: 12, y: -8, distance: .55 },
    regions: [{ ...defaults, id: 'other', name: '另一场景', visible: true, effect: 'petal_bloom' }] })
  const changed = { ...settings, ...regionPatch(settings, 'other', { view: { ...defaultSceneView, yaw: -120 } }) }
  expect(changed.view.yaw).toBe(150); expect(changed.regions[0].view.yaw).toBe(-120)
  expect(importScene(sceneDocument({ name: '视角', scene: layout(changed) })).scene.view).toEqual(settings.view)
  const old = JSON.parse(sceneDocument({ name: '旧场景', scene: layout(changed) }))
  delete old.scene.view; delete old.scene.regions[0].view
  delete old.scene.music.ambientDensity; delete old.scene.music.ambientSpread
  expect(importScene(JSON.stringify(old)).scene.view).toEqual(defaultSceneView)
  expect(normalizeSceneView({ yaw: Infinity, pitch: 700, x: -300, distance: 0 })).toMatchObject({ yaw: 0, pitch: 180, x: -100, distance: .25 })
  expect(rotateSceneView({ ...defaultSceneView, yaw: 170 }, 40, 0).yaw).toBe(-150)
})

test('preview drag saves while held, supports controlled rotation, pan, roll, dolly and reload', async ({ page }) => {
  test.setTimeout(60000)
  await page.addInitScript(s => { if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify(s)) }, { ...defaults, effect: 'star_flight', bounds: { x: 0, y: 0, width: 1, height: 1 } })
  await page.goto('/#scene')
  await page.locator('.startup-screen').waitFor({ state: 'hidden' })
  const canvas = page.locator('.three-scene-surface canvas')
  await expect(canvas).toHaveAttribute('data-renderer', 'three')
  const box = (await canvas.boundingBox())!, start = { x: box.x + box.width * .2, y: box.y + box.height * .4 }
  await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(start.x + box.width * .35,start.y + box.height * .25,{steps:12})
  await expect.poll(async () => Math.abs((await saved(page)).view.yaw)).toBeGreaterThan(35)
  await page.mouse.up()
  const rotated = (await saved(page)).view
  expect(Math.abs(rotated.yaw)).toBeLessThan(50)
  expect(Math.abs(rotated.pitch)).toBeGreaterThan(25)
  expect(Math.abs(rotated.pitch)).toBeLessThan(35)
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-view'))!)).toEqual(rotated)
  await page.keyboard.down('Shift'); await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(start.x+70,start.y+35,{steps:5}); await page.mouse.up(); await page.keyboard.up('Shift')
  await expect.poll(async () => (await saved(page)).view.x).toBeGreaterThan(5)
  await page.keyboard.down('Alt'); await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(start.x+80,start.y,{steps:5}); await page.mouse.up(); await page.keyboard.up('Alt')
  await expect.poll(async () => (await saved(page)).view.roll).toBeGreaterThan(8)
  await page.mouse.wheel(0,-200)
  await expect.poll(async () => (await saved(page)).view.distance).toBeLessThan(1)
  const expected = (await saved(page)).view
  await page.getByRole('button',{name:'放大预览',exact:true}).click()
  await expect.poll(async () => JSON.parse((await page.getByRole('dialog').locator('canvas').getAttribute('data-view'))!)).toEqual(expected)
  await page.getByRole('button',{name:'关闭放大预览',exact:true}).click()
  await page.reload()
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-view'))!)).toEqual(expected)
  await settingsSection(page, '位置')
  await page.getByText('精细视角', { exact: true }).click()
  await expect(page.getByRole('slider',{name:'左右旋转',exact:true})).toHaveAttribute('aria-valuemin','-180')
  await expect(page.getByRole('slider',{name:'上下旋转',exact:true})).toHaveAttribute('aria-valuemax','180')
  await page.screenshot({path:'artifacts/scene-view-controls.png',fullPage:true})
  await page.getByRole('button',{name:'恢复三维视角',exact:true}).click()
  await expect.poll(async () => (await saved(page)).view).toEqual(defaultSceneView)
  await page.setViewportSize({width:390,height:844})
  await expect(page.getByRole('slider',{name:'左右旋转',exact:true})).toBeVisible()
  // ResizeObserver and the responsive workspace layout settle after viewport changes.
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('camera matrices are deterministic through all axes and a full turn', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { SceneCamera } = await import('/src/features/spectrum/three/camera.ts')
    const { defaultSceneView } = await import('/src/features/spectrum/three/view.ts')
    const T = await import('/node_modules/.vite/deps/three.js')
    const a = new T.PerspectiveCamera(46,16/9,.1,160), b = new T.PerspectiveCamera(46,16/9,.1,160)
    const one = new SceneCamera(), two = new SceneCamera(), position = new T.Vector3(0,1,16), target = new T.Vector3(0,0,-5)
    const views = [{...defaultSceneView},{...defaultSceneView,yaw:179,pitch:120,roll:-110,x:20,y:-12,distance:.4}, {...defaultSceneView,yaw:-180,pitch:-180,roll:180,distance:4}]
    for (const view of views) {
      one.apply(a,position,target,view); two.apply(b,position,target,view)
      if (!a.matrixWorld.elements.every(Number.isFinite)) throw Error('Non-finite camera')
      if (JSON.stringify(a.matrixWorld.elements)!==JSON.stringify(b.matrixWorld.elements)) throw Error('Preview/desktop diverged')
    }
    one.apply(a,position,target,defaultSceneView)
    two.apply(b,position,target,{...defaultSceneView,roll:90})
    return { samePosition: a.position.distanceTo(b.position), orientationChanged: a.quaternion.angleTo(b.quaternion) }
  })
  expect(result.samePosition).toBeLessThan(.00001); expect(result.orientationChanged).toBeCloseTo(Math.PI/2)
})
