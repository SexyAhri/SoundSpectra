import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fulfillFixtureEntry } from './helpers/fixture-entry'

test('video stills use the photo keepsake across skins and sizes and retain file operations', async ({ page }) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  // A native smoke run can supply the frame extracted from a real local video.
  const thumbnail = process.env.RAIL_TEST_THUMBNAIL
    ? `data:image/png;base64,${readFileSync(process.env.RAIL_TEST_THUMBNAIL).toString('base64')}`
    : `data:image/webp;base64,${readFileSync('src/assets/desktop-scenes/warm-sand.webp').toString('base64')}`
  await page.addInitScript(() => Object.assign(window, { isTauri: true }))
  await page.route('**/src/main.tsx*', route => fulfillFixtureEntry(route, `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { RailSurface } from '/src/features/rail/rail-surface.tsx';
    import '/src/index.css';
    import '/src/features/rail/rail.css';
    window.opened = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === 'rail_double_click_interval') return 500;
      if (command === 'rail_media') return ${JSON.stringify(thumbnail)};
      if (command === 'rail_open') window.opened.push(args.id);
      return null;
    }, transformCallback: () => 1 };
    function Fixture() {
      const [state, setState] = React.useState({ width: 880, skin: 'floral', missing: false });
      window.videoFixture = patch => setState(current => ({ ...current, ...patch }));
      const items = [
        { id:'video', name:'80年代中国农村场景视频', path:'C:/影片/农村.MP4', kind:'file', crop:'contain' },
        { id:'photo', name:'田园照片', path:'C:/照片.jpg', kind:'image', crop:'cover' },
        { id:'document', name:'阅读笔记.txt', path:'C:/笔记.txt', kind:'file', crop:'contain' },
      ];
      const group = { id:'video-group', name:'留住片刻', x:0, y:0, width:1, collapsed:false, skin:state.skin, items };
      const controller = { settings:{version:1, enabled:true, groups:[group]}, loaded:true, pending:0, error:null, desktopError:null, supported:true, missing: state.missing ? ['video'] : [], change:async () => {}, refresh:async () => {} };
      return React.createElement('div', { style:{ width:state.width, maxWidth:'100%', margin:'70px auto' } }, React.createElement(RailSurface, { group, controller, selected:'video', layoutWidth:state.width }));
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Fixture));
  `))
  await page.goto('/?video-keepsake')
  const video = page.locator('[data-rail-item="video"]')
  const image = video.getByRole('img', { name: '80年代中国农村场景视频', exact: true })
  await expect(image).toBeVisible()
  expect(await image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 32 && node.naturalHeight > 32)).toBe(true)
  await expect(video).toHaveClass(/rail-image rail-video/)
  await expect(page.locator('[data-rail-item="document"]')).toHaveClass(/rail-file/)
  await expect(page.locator('video')).toHaveCount(0)
  for (const skin of ['woodland', 'floral', 'wisteria', 'autumn']) {
    for (const width of [880, 480]) {
      await page.evaluate(patch => (window as any).videoFixture(patch), { skin, width })
      await expect(page.locator('.rail-surface')).toHaveAttribute('data-rail-skin', skin)
      const forms = await page.evaluate(() => ['video', 'photo'].map(id => {
        const node = document.querySelector<HTMLElement>('[data-rail-item="' + id + '"]')!
        const paper = node.querySelector<HTMLElement>('.rail-item')!
        const media = node.querySelector<HTMLElement>('.rail-item-media')!
        const label = node.querySelector<HTMLElement>('.rail-item-name')!
        return { width:node.style.width, paper:getComputedStyle(paper).backgroundColor, media:getComputedStyle(media).height, labelFits:label.offsetLeft >= 0 && label.offsetLeft + label.offsetWidth <= paper.offsetWidth + 1, botanical:getComputedStyle(node.querySelector('.rail-paper-botanical')!).display };
      }))
      expect(forms[0].width).toBe(forms[1].width)
      expect(forms[0].paper).toBe(forms[1].paper)
      expect(forms[0].media).toBe(forms[1].media)
      expect(forms[0].botanical).toBe('none')
      expect(forms[0].labelFits).toBe(true)
    }
  }
  await page.evaluate(() => (window as any).videoFixture({ width:880, skin:'floral' }))
  await page.getByRole('button', { name:'80年代中国农村场景视频，文件', exact:true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).opened)).toEqual(['video'])
  await page.getByRole('button', { name:'80年代中国农村场景视频，文件', exact:true }).press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).opened)).toEqual(['video', 'video'])
  await page.mouse.move(0, 0)
  await page.locator('.rail-surface').screenshot({ path:'artifacts/video-keepsake.png' })
  await page.evaluate(() => (window as any).videoFixture({ missing:true }))
  await expect(video.getByText('需重新关联')).toBeVisible()
  await expect(video.getByText('视频暂无预览')).toBeVisible()
  await page.evaluate(() => (window as any).videoFixture({ missing:false }))
  await expect(image).toBeVisible()
  expect(errors).toEqual([])
})
