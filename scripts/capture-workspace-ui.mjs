import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

await mkdir('artifacts/ui-workspace', { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
try {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const settings = localStorage.getItem('soundspectra.settings.v1')
    if (!settings) localStorage.setItem('soundspectra.settings.v1', JSON.stringify({
      quality: 'eco', effect: 'aurora_flow', sceneMode: 'immersive', opacity: 100,
      bounds: { x:0,y:0,width:1,height:1 },
      desktopCard: { enabled:true,variant:'afternoon',bounds:{ x:.04,y:.78,width:.27,height:.16 } },
      lyrics: { enabled:true,motion:'stage',fontSize:44,bounds:{ x:.15,y:.2,width:.7,height:.3 } },
    }))
  })
  const page = await context.newPage()
  for (const [name, width, height] of [['desktop',1440,940],['small',900,620],['mobile',390,844]]) {
    await page.setViewportSize({ width, height })
    await page.goto('http://127.0.0.1:1422')
    await page.locator('.startup-screen').waitFor({ state: 'hidden' })
    await page.getByText('已保存到此浏览器', { exact: true }).waitFor()
    await page.locator('.desktop-preview').waitFor()
    await page.waitForFunction(() => Number(document.querySelector('.three-scene-surface canvas')?.getAttribute('data-frames')) > 1)
    await page.screenshot({ path: `artifacts/ui-workspace/${name}.png`, fullPage: true, animations: 'disabled' })
    console.log(name, await page.evaluate(() => {
      const rect = node => { const b = node.getBoundingClientRect(); return { x:b.x,y:b.y,width:b.width,height:b.height } }
      return { overflow: document.documentElement.scrollWidth > innerWidth, scroll:document.documentElement.scrollHeight,
        preview:rect(document.querySelector('.desktop-preview')), footer:rect(document.querySelector('.workspace-footer')),
        sections:[...document.querySelector('.preview-section').children].map(n=>({class:n.className,...rect(n)})) }
    }))
  }
  await page.setViewportSize({ width:1440, height:940 })
  await page.goto('http://127.0.0.1:1422')
  await page.getByRole('button', { name:'使用指南', exact:true }).click()
  await page.screenshot({ path:'artifacts/ui-workspace/guide.png' })
  await page.getByRole('button', { name:'关闭工作台工具', exact:true }).click()
  await page.getByRole('button', { name:'快捷控制', exact:true }).click()
  await page.screenshot({ path:'artifacts/ui-workspace/quick.png' })
  await page.getByRole('button', { name:'关闭工作台工具', exact:true }).click()
  await page.getByRole('button', { name:'场景收藏', exact:true }).click()
  await page.screenshot({ path:'artifacts/ui-workspace/scenes.png' })
} finally { await browser.close() }
