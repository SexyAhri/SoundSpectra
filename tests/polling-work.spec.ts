import { expect, test, type Page } from '@playwright/test'

async function fixture(page: Page) {
  await page.routeWebSocket(/ws:\/\/127\.0\.0\.1:\d+/, socket => {
    const server = socket.connectToServer()
    server.onMessage(message => {
      if (typeof message === 'string' && ['update', 'full-reload'].includes(JSON.parse(message).type)) return
      socket.send(message)
    })
  })
  await page.addInitScript(() => {
    const app = window as any
    app.isTauri = true
    app.pollCallbacks = {}
    const timeout = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: any[]) => {
      const name = delay === 500 ? 'media' : delay === 3000 ? 'lyrics' : null
      if (!name) return timeout(handler, delay, ...args)
      app.pollCallbacks[name] = handler
      return name === 'media' ? -1 : -2
    }) as typeof setTimeout
    window.clearTimeout = (id => {
      if (id === -1 || id === -2) delete app.pollCallbacks[id === -1 ? 'media' : 'lyrics']
      else clear(id)
    }) as typeof clearTimeout
    app.__TAURI_INTERNALS__ = { invoke: async (command: string) => {
      const probe = app.pollingWork
      const name = command === 'get_now_playing' ? 'media' : command === 'get_current_lyrics' ? 'lyrics' : command === 'get_desktop_background' ? 'background' : null
      if (!name) throw new Error(`Unexpected IPC: ${command}`)
      probe.calls[name]++
      if (probe.failures[name]) throw new Error('poll failed')
      if (name === 'background' && app.holdBackground) {
        return new Promise(resolve => { app.releaseBackground = () => resolve(structuredClone(probe.background)) })
      }
      return structuredClone(probe[name])
    } }
  })
  await page.goto('/tests/fixtures/polling-work.html')
  await expect(page.getByTestId('background')).toContainText('initial')
  await expect(page.getByTestId('lyrics')).toContainText('probe.lrc')
  await step(page, 'media')
  await page.evaluate(() => { (window as any).pollingWork.commits = { background: 0, media: 0, lyrics: 0 } })
}

async function step(page: Page, name: 'background' | 'media' | 'lyrics', quiet = true) {
  await page.evaluate(async ({ name, quiet }) => {
    const app = window as any
    if (name === 'background') await app.pollingWork.refresh(quiet)
    else await app.pollCallbacks[name]()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  }, { name, quiet })
}

test('identical wallpaper, media and lyric snapshots avoid React commits', async ({ page }) => {
  await fixture(page)
  const before = await page.evaluate(() => structuredClone((window as any).pollingWork.calls))
  for (let index = 0; index < 6; index++) {
    for (const name of ['background', 'media', 'lyrics'] as const) await step(page, name)
  }
  const work = await page.evaluate(() => ({ commits: (window as any).pollingWork.commits, calls: (window as any).pollingWork.calls }))
  console.log('six unchanged polls per source:', work)
  for (const name of ['background', 'media', 'lyrics'] as const) expect(work.calls[name] - before[name]).toBe(6)
  expect(work.commits).toEqual({ background: 0, media: 0, lyrics: 0 })
})

test('unchanged wallpaper revision still publishes geometry and placement changes', async ({ page }) => {
  await fixture(page)
  for (const patch of [
    { screen: { x: -1280, y: 40, width: 1280, height: 720 } },
    { virtualScreen: { x: -1280, y: -20, width: 3200, height: 1100 } },
    { position: 'span' }, { color: '#aabbcc' }, { anchor: { x: .2, y: .8 } },
    { anchor: { x: .7, y: .3 } }, { issue: 'wallpaper unavailable' }, { issue: null },
  ]) {
    await page.evaluate(patch => Object.assign((window as any).pollingWork.background, patch), patch)
    await step(page, 'background')
    expect(JSON.parse((await page.getByTestId('background').textContent())!).desktop).toMatchObject(patch)
  }
  await page.evaluate(() => { delete (window as any).pollingWork.background.anchor })
  await step(page, 'background')
  expect(JSON.parse((await page.getByTestId('background').textContent())!).desktop.anchor).toBeUndefined()
  await page.evaluate(() => {
    const app = window as any
    app.holdBackground = true
    app.manualRefresh = app.pollingWork.refresh(false)
  })
  await expect.poll(async () => JSON.parse((await page.getByTestId('background').textContent())!).loading).toBe(true)
  await page.evaluate(async () => {
    const app = window as any
    app.holdBackground = false
    app.releaseBackground()
    await app.manualRefresh
  })
  await expect.poll(async () => JSON.parse((await page.getByTestId('background').textContent())!).loading).toBe(false)
})

test('media timing, track identity and individual controls continue to update', async ({ page }) => {
  await fixture(page)
  for (const patch of [
    { title: 'Track', artist: 'Artist', album: 'Album', cover: 'cover.png' },
    { position: 2, duration: 100, playing: true, updated: 1000 },
    { source: 'player', processId: 123, trackId: 'track', sessionId: 'session' },
    { timelineAvailable: true, timelineSource: 'kugou-checkpoint', timelineValidUntil: 5000, playbackAvailable: true },
    { updated: 1500 }, { position: 40 }, { timelineValidUntil: 7000 },
    { controls: { previous: false, next: true, play: true, pause: false } },
    { controls: { previous: true, next: true, play: true, pause: false } },
    { controls: { previous: true, next: false, play: true, pause: false } },
    { controls: { previous: true, next: false, play: false, pause: false } },
    { controls: { previous: true, next: false, play: false, pause: true } },
    { issue: 'media unavailable' }, { issue: null, playing: false },
  ]) {
    await page.evaluate(patch => Object.assign((window as any).pollingWork.media, patch), patch)
    await step(page, 'media')
    expect(JSON.parse((await page.getByTestId('media').textContent())!)).toMatchObject(patch)
  }
  await page.evaluate(() => { (window as any).pollingWork.commits.media = 0 })
  await step(page, 'media')
  expect(await page.evaluate(() => (window as any).pollingWork.commits.media)).toBe(0)
  await page.evaluate(() => { delete (window as any).pollingWork.media.controls })
  await step(page, 'media')
  expect(JSON.parse((await page.getByTestId('media').textContent())!).controls).toBeUndefined()
})

test('lyric file, line and word edits publish even when the track is unchanged', async ({ page }) => {
  await fixture(page)
  for (const patch of [{ file: 'edited.lrc' }, { message: 'changed' }, { issue: 'read issue' }, { status: 'error' }, { status: 'ready', issue: null }]) {
    await page.evaluate(patch => Object.assign((window as any).pollingWork.lyrics, patch), patch)
    await step(page, 'lyrics')
    expect(JSON.parse((await page.getByTestId('lyrics').textContent())!)).toMatchObject(patch)
  }
  for (const edit of ['text', 'start', 'end', 'words', 'wordText', 'wordStart', 'wordEnd', 'removeLine'] as const) {
    await page.evaluate(edit => {
      const lines = (window as any).pollingWork.lyrics.lines
      if (edit === 'text') lines[0].text += ' edited'
      if (edit === 'start') lines[0].start += 100
      if (edit === 'end') lines[0].end += 200
      if (edit === 'words') lines[0].words.push({ text: 'new', start: 100, end: 200 })
      if (edit === 'wordText') lines[0].words[0].text = 'changed'
      if (edit === 'wordStart') lines[0].words[0].start += 30
      if (edit === 'wordEnd') lines[0].words[0].end += 40
      if (edit === 'removeLine') lines.pop()
    }, edit)
    await step(page, 'lyrics')
    expect(JSON.parse((await page.getByTestId('lyrics').textContent())!).lines).toEqual(await page.evaluate(() => (window as any).pollingWork.lyrics.lines))
  }
  await page.evaluate(() => { (window as any).pollingWork.commits.lyrics = 0 })
  await step(page, 'lyrics')
  expect(await page.evaluate(() => (window as any).pollingWork.commits.lyrics)).toBe(0)
})

test('repeated polling failures stay idle and all sources recover', async ({ page }) => {
  await fixture(page)
  await page.evaluate(() => { (window as any).pollingWork.failures = { background: true, media: true, lyrics: true } })
  for (const name of ['background', 'media', 'lyrics'] as const) await step(page, name)
  await expect(page.getByTestId('background')).toContainText('poll failed')
  await expect(page.getByTestId('media')).toContainText('播放器媒体信息暂不可用')
  await expect(page.getByTestId('lyrics')).toContainText('歌词暂时不可用')
  await page.evaluate(() => { (window as any).pollingWork.commits = { background: 0, media: 0, lyrics: 0 } })
  for (let index = 0; index < 3; index++) {
    for (const name of ['background', 'media', 'lyrics'] as const) await step(page, name)
  }
  expect(await page.evaluate(() => (window as any).pollingWork.commits)).toEqual({ background: 0, media: 0, lyrics: 0 })
  await page.evaluate(() => { (window as any).pollingWork.failures = { background: false, media: false, lyrics: false } })
  for (const name of ['background', 'media', 'lyrics'] as const) await step(page, name)
  expect(JSON.parse((await page.getByTestId('background').textContent())!).error).toBeNull()
  expect(JSON.parse((await page.getByTestId('media').textContent())!).issue).toBeNull()
  expect(JSON.parse((await page.getByTestId('lyrics').textContent())!).status).toBe('ready')
})
