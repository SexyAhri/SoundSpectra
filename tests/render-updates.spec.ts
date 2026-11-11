import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.addInitScript(() => {
    const originalNow = Date.now
    ;(window as any).renderClockShift = 0
    Date.now = () => originalNow() + (window as any).renderClockShift
    const timeout = window.setTimeout.bind(window)
    // Exercise the real polling hook without making each assertion wait 1.5s.
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) => timeout(handler, delay === 1500 ? 60 : delay, ...args)) as typeof setTimeout
  })
  await page.route('**/src/features/spectrum/bridge.ts*', route => {
    if (route.request().url().includes('render-original')) return route.continue()
    return route.fulfill({ contentType: 'text/javascript', body: `
      export * from '/src/features/spectrum/bridge.ts?render-original';
      export async function getStatus() {
        const probe = window.renderUpdates;
        probe.polls++;
        if (probe.issue) throw new Error(probe.issue);
        return structuredClone(probe.status);
      }
    ` })
  })
  await page.route('**/src/features/settings/scene-inspector.tsx*', async route => {
    const response = await route.fetch()
    const source = await response.text()
    expect(source).toContain('const heading = {')
    await route.fulfill({ response, body: source.replace('const heading = {', 'window.renderUpdates.inspectorRenders++; const heading = {') })
  })
  await page.goto('/tests/fixtures/render-updates.html')
  await expect(page.getByTestId('status')).toHaveAttribute('data-loaded', 'true')
  await expect(page.locator('canvas')).toHaveAttribute('data-fonts-ready', 'true')
}

test('same-line playback and pause avoid lyric React commits while the canvas keeps its clock', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).renderUpdates.lyricCommits = 0 })
  const frames = Number(await page.locator('canvas').getAttribute('data-frames'))
  await page.waitForTimeout(800)
  const commits = await page.evaluate(() => (window as any).renderUpdates.lyricCommits)
  console.log('same-line lyric React commits in 800ms:', commits)
  expect(commits).toBe(0)
  expect(Number(await page.locator('canvas').getAttribute('data-frames'))).toBeGreaterThan(frames + 2)
  await page.evaluate(() => (window as any).renderUpdates.set({ position: 4.8 }))
  await expect(page.getByLabel('当前歌词')).toHaveText('你听见 光落下的声音')
  await page.evaluate(() => (window as any).renderUpdates.set({ position: 6, playing: false }))
  await expect(page.locator('canvas')).toHaveAttribute('data-time', '6000')
  const paused = await page.evaluate(() => (window as any).renderUpdates.lyricCommits)
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as any).renderUpdates.lyricCommits)).toBe(paused)
  await page.evaluate(() => (window as any).renderUpdates.set({ position: 11 }))
  await expect(page.getByLabel('当前歌词')).toHaveText('漫长夜色 缓缓经过掌心')
})

test('lyric status expires without a media update and recovers immediately after a seek', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).renderClockShift += 4100 })
  await expect(page.locator('canvas')).toHaveCount(0)
  await expect(page.getByTestId('lyric-layer')).toContainText('等待播放器提供有效播放进度')
  await page.evaluate(() => (window as any).renderUpdates.set({ position: 11, playing: false }))
  await expect(page.getByLabel('当前歌词')).toHaveText('漫长夜色 缓缓经过掌心')
  await expect(page.locator('canvas')).toHaveAttribute('data-time', '11000')
  await page.evaluate(() => (window as any).renderUpdates.settings({ offsetMs: 5000 }))
  await expect(page.getByLabel('当前歌词')).toHaveText('把未说出口的话 交给星群')
  await expect(page.locator('canvas')).toHaveAttribute('data-time', '16000')
  await page.evaluate(() => (window as any).renderUpdates.set({ title: 'Different song' }))
  await expect(page.locator('canvas')).toHaveCount(0)
})

test('demo lyrics update at line boundaries and loop without React frame ticks', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).renderUpdates.demo(true))
  await expect(page.getByLabel('当前歌词')).toHaveText('风把晚霞 折成一页信')
  await page.evaluate(() => { (window as any).renderClockShift += 5000 })
  await expect(page.getByLabel('当前歌词')).toHaveText('你听见 光落下的声音')
  await page.evaluate(() => { (window as any).renderClockShift += 25000 })
  await expect(page.getByLabel('当前歌词')).toHaveText('风把晚霞 折成一页信')
  await page.evaluate(() => { (window as any).renderUpdates.lyricCommits = 0 })
  const before = Number(await page.locator('canvas').getAttribute('data-frames'))
  await page.waitForTimeout(600)
  expect(await page.evaluate(() => (window as any).renderUpdates.lyricCommits)).toBe(0)
  expect(Number(await page.locator('canvas').getAttribute('data-frames'))).toBeGreaterThan(before + 2)
})

test('identical runtime polls keep the workspace idle and real status changes still publish', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).renderUpdates.statusCommits = 0; (window as any).renderUpdates.polls = 0 })
  await page.waitForTimeout(400)
  const work = await page.evaluate(() => {
    const probe = (window as any).renderUpdates
    return { polls: probe.polls, commits: probe.statusCommits }
  })
  console.log('identical runtime polling work:', work)
  expect(work.polls).toBeGreaterThanOrEqual(3)
  expect(work.commits).toBe(0)
  const output = page.getByTestId('status')
  for (const patch of [
    { state: 'listening' }, { message: 'changed message' }, { processId: 123 },
    { sourceName: 'player' }, { desktopAttached: true }, { editing: true }, { desktopError: 'desktop unavailable' },
  ]) {
    await page.evaluate(patch => Object.assign((window as any).renderUpdates.status, patch), patch)
    await expect.poll(async () => JSON.parse((await output.textContent())!)).toMatchObject(patch)
  }
  await page.evaluate(() => { (window as any).renderUpdates.issue = 'poll failed' })
  await expect(output).toContainText('poll failed')
  const failed = await page.evaluate(() => (window as any).renderUpdates.statusCommits)
  await page.waitForTimeout(250)
  expect(await page.evaluate(() => (window as any).renderUpdates.statusCommits)).toBe(failed)
  await page.evaluate(() => { (window as any).renderUpdates.issue = '' })
  await expect(output).toContainText('changed message')
})

test('unrelated media updates skip inspector content and its controls still respond', async ({ page }) => {
  await fixture(page)
  await expect(page.getByLabel('对象属性')).toBeVisible()
  await expect(page.getByRole('switch', { name: '局部音乐微光', exact: true })).toBeEnabled()
  const work = await page.evaluate(async () => {
    const probe = (window as any).renderUpdates
    probe.inspectorRenders = 0
    for (let index = 0; index < 12; index++) {
      probe.inspect({ nowPlaying: { title: 'Polling track', updated: Date.now(), position: index } })
      await new Promise(requestAnimationFrame)
    }
    return probe.inspectorRenders
  })
  console.log('unrelated media updates inspector renders:', work)
  expect(work).toBe(0)
  await page.evaluate(() => (window as any).renderUpdates.inspect({ disabled: true }))
  await expect(page.getByRole('switch', { name: '局部音乐微光', exact: true })).toBeDisabled()
})

test('card and lyric inspectors still receive current media and matched lyrics', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => (window as any).renderUpdates.inspect({ panel: 'card', nowPlaying: { title: 'First track', artist: 'Test', position: 1, duration: 100, updated: Date.now() } }))
  const inspector = page.getByLabel('对象属性')
  await expect(inspector.locator('.card-style-preview').first()).toContainText('First track')
  await page.evaluate(() => (window as any).renderUpdates.inspect({ nowPlaying: { title: 'Second track', artist: 'Test', position: 1, duration: 100, updated: Date.now() } }))
  await expect(inspector.locator('.card-style-preview').first()).toContainText('Second track')
  await page.evaluate(() => (window as any).renderUpdates.inspect({ panel: 'lyrics', nowPlaying: { title: 'Render probe', artist: 'Test', position: 1 } }))
  await expect(inspector.locator('.lyric-style-preview').first()).toContainText('风把晚霞 折成一页信')
  await page.evaluate(() => (window as any).renderUpdates.inspect({ nowPlaying: { title: 'Render probe', artist: 'Test', position: 6 } }))
  await expect(inspector.locator('.lyric-style-preview').first()).toContainText('你听见 光落下的声音')
  await page.evaluate(() => (window as any).renderUpdates.inspect({ lyricDocument: { key: 'new', status: 'ready', message: '', file: null, lines: [{ text: '换歌后的新歌词', start: 0, end: 10000, words: [] }] } }))
  await expect(inspector.locator('.lyric-style-preview').first()).toContainText('换歌后的新歌词')
})
