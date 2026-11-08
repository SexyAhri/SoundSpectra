import { settingsSection } from './helpers/module-settings'
import { expect, test, type Page } from '@playwright/test'
import { defaults } from '../src/features/spectrum/model'
import { regionStyle } from '../src/features/spectrum/regions'

async function nativeWorkspace(page: Page, desktop: boolean) {
  const settings = { ...structuredClone(defaults), enabled: true, effect: 'aurora_flow' as const, quality: 'eco' as const,
    followCover: true, bounds: { x: 0, y: 0, width: .48, height: 1 },
    regions: [{ ...regionStyle(defaults), effect: 'petal_bloom' as const, bounds: { x: .52, y: 0, width: .48, height: 1 }, id: 'second', name: '第二区域', visible: true }] }
  await page.addInitScript(({ settings, desktop }) => {
    const app = window as any
    app.isTauri = true
    const callbacks = new Map(), listeners = new Map()
    let callbackId = 0, eventId = 0, sequence = 0
    const state = app.sceneIntegration = { settings, live: false, mediaPolls: 0, statusPolls: 0, lyricLine: null as string | null, lyricStart: 0 }
    const emit = (event: string, payload: unknown) => { for (const listener of listeners.values()) if (listener.event === event) callbacks.get(listener.handler)?.({ payload }) }
    state.patch = (patch: object) => { state.settings = { ...state.settings, ...patch }; emit('settings-changed', structuredClone(state.settings)) }
    state.lyrics = (line: string | null) => { state.lyricLine = line }
    app.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} }
    app.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: desktop ? 'overlay' : 'settings' }, currentWebview: { label: desktop ? 'overlay' : 'settings' } },
      transformCallback(callback: unknown) { callbacks.set(++callbackId, callback); return callbackId },
      unregisterCallback(id: number) { callbacks.delete(id) },
      async invoke(command: string, args: any = {}) {
        switch (command) {
          case 'plugin:event|listen': listeners.set(++eventId, args); return eventId
          case 'plugin:event|unlisten': listeners.delete(args.eventId); return
          case 'get_settings': return structuredClone(state.settings)
          case 'update_settings': state.settings = args.settings; emit('settings-changed', structuredClone(state.settings)); return structuredClone(state.settings)
          case 'get_status': state.statusPolls++; return { state: state.live ? 'listening' : 'waiting', message: '测试音源', processId: state.live ? 10 : null, sourceName: state.live ? '测试音源' : null, editing: false, desktopAttached: true }
          case 'get_now_playing': state.mediaPolls++; return { title: '原创测试片段', artist: '', album: '', cover: null, position: 1, duration: 60, playing: false, source: '测试音源', processId: 10, updated: Date.now(), issue: null, timelineAvailable: true }
          case 'get_current_lyrics': return { key: '原创测试片段\u001f\u001f', status: 'ready', message: '', file: null, lines: state.lyricLine ? [{ text: state.lyricLine, start: state.lyricStart, end: 60000, words: [] }] : [] }
          case 'get_audio_sources': return { selection: { mode: 'auto' }, error: null, catalog: [], discovery: { targets: [], warning: null } }
          case 'rail_get': return { settings: { version: 1, enabled: false, groups: [] }, missing: [], desktopError: null, supported: true }
          case 'get_desktop_background': return { screen: { x: 0, y: 0, width: 1280, height: 720 }, virtualScreen: { x: 0, y: 0, width: 1280, height: 720 }, position: 'fill', color: '#25232c', image: null, revision: 'solid', issue: null }
          case 'application_info': return { version: '1.0.4', repository: 'SexyAhri/SoundSpectra', updaterConfigured: false, development: true }
          case 'get_preferences': return { closeToTray: true, autoCheckUpdates: false, showUpdateButton: true }
          case 'plugin:window|is_visible': return true
          case 'plugin:window|is_minimized': case 'plugin:window|is_maximized': case 'plugin:autostart|is_enabled': return false
          default: return null
        }
      },
    }
    setInterval(() => {
      const rms = state.live ? .12 : 0, level = state.live ? .4 : 0
      emit('music-analysis', { sourceRevision: 1, streamId: 1, sequence: ++sequence, samplePosition: sequence * 1024, sampleRate: 48000,
        rms, bands: Array(6).fill(level), spectrum: Array(48).fill(level), skin: [], bandRms: Array(6).fill(rms), spectrumRms: Array(48).fill(rms / 8) })
    }, 22)
  }, { settings, desktop })
  await page.goto(desktop ? '/?window=overlay' : '/')
  await expect(page.locator('.three-scene-surface canvas')).toHaveCount(2)
  await expect.poll(() => page.evaluate(() => (window as any).sceneIntegration.mediaPolls)).toBeGreaterThan(5)
  // Media polling can finish before shader preparation and the initial resize.
  // Begin idle sampling only after both scenes have presented the silent input.
  for (const canvas of await page.locator('.three-scene-surface canvas').all()) {
    await expect(canvas).toHaveAttribute('data-rms', '0.0000')
    await expect(canvas).toHaveAttribute('data-resize-paused', 'false')
  }
}

const sample = (page: Page, duration = 1700) => page.evaluate(async duration => {
  const read = () => [...document.querySelectorAll<HTMLCanvasElement>('.three-scene-surface canvas')].map(canvas => Number(canvas.dataset.frames))
  const before = read(), polls = (window as any).sceneIntegration.mediaPolls
  await new Promise(resolve => setTimeout(resolve, duration))
  return { before, after: read(), polls: (window as any).sceneIntegration.mediaPolls - polls }
}, duration)

for (const desktop of [false, true]) test(`${desktop ? 'overlay' : 'workspace'}: media polling cannot repaint silent regions, while edits and real analysis still wake them`, async ({ page }) => {
  test.setTimeout(90000)
  await nativeWorkspace(page, desktop)
  const idle = await sample(page)
  expect(idle.polls).toBeGreaterThan(1)
  expect(idle.after).toEqual(idle.before)
  const canvases = page.locator('.three-scene-surface canvas')
  const beforeEdit = Number(await canvases.first().getAttribute('data-frames'))
  if (desktop) await page.evaluate(() => (window as any).sceneIntegration.patch({ opacity: 62 }))
  else {
    await settingsSection(page, '外观')
    await page.getByRole('slider', { name: '不透明度', exact: true }).press('ArrowLeft')
  }
  await expect.poll(() => canvases.first().getAttribute('data-frames').then(Number)).toBeGreaterThan(beforeEdit)
  await page.waitForTimeout(300)
  const edited = await sample(page)
  expect(edited.after).toEqual(edited.before)
  if (desktop) {
  // Values nested inside settings must still invalidate a sleeping scene.
  for (const field of ['music', 'masks', 'view', 'bounds'] as const) {
    const before = Number(await canvases.first().getAttribute('data-frames'))
    await page.evaluate(field => {
      const state = (window as any).sceneIntegration, settings = state.settings
      const patches = {
        music: { music: { ...settings.music, ambientSpread: .74 } },
        masks: { masks: [{ id: 'integration-mask', bounds: { x: .1, y: .1, width: .1, height: .1 }, feather: .01 }] },
        view: { view: { ...settings.view, yaw: 17 } },
        bounds: { bounds: { ...settings.bounds, width: .46 } },
      }
      state.patch(patches[field])
    }, field)
    await expect.poll(() => canvases.first().getAttribute('data-frames').then(Number), { message: `${field} wakes the scene` }).toBeGreaterThan(before)
    await page.waitForTimeout(300)
    const settled = await sample(page, 700)
    expect(settled.after, field).toEqual(settled.before)
  }
  await page.evaluate(() => {
    const state = (window as any).sceneIntegration
    state.lyrics('第一句'); state.patch({ lyrics: { ...state.settings.lyrics, enabled: true } })
  })
  await expect(canvases.first()).toHaveAttribute('data-focus', /^\{/)
  const beforeLine = Number(await canvases.first().getAttribute('data-frames'))
  await page.evaluate(() => { const state = (window as any).sceneIntegration; state.lyrics('第二句'); state.lyricStart = 100 })
  await expect(page.getByLabel('当前歌词')).toHaveText('第二句')
  await expect.poll(() => canvases.first().getAttribute('data-frames').then(Number)).toBeGreaterThan(beforeLine)
  await page.evaluate(() => { const state = (window as any).sceneIntegration; state.patch({ lyrics: { ...state.settings.lyrics, enabled: false } }) })
  await expect(canvases.first()).toHaveAttribute('data-focus', '')
  await page.waitForTimeout(300)
  const unfocused = await sample(page)
  expect(unfocused.after).toEqual(unfocused.before)
  }
  await page.evaluate(() => { (window as any).sceneIntegration.live = true })
  await expect(canvases.first()).toHaveAttribute('data-rms', '0.1200')
  const live = await sample(page, 400)
  expect(live.after.every((value, i) => value > live.before[i])).toBe(true)
  await page.evaluate(() => { (window as any).sceneIntegration.live = false })
  await expect(canvases.first()).toHaveAttribute('data-rms', '0.0000')
  await page.waitForTimeout(2500)
  const released = await sample(page)
  expect(released.after).toEqual(released.before)
})
