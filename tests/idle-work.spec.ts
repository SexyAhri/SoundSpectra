import { expect, test } from '@playwright/test'

test('an invisible live meter stops scheduling and wakes for fresh audio when shown', async ({ page }) => {
  await page.goto('/tests/fixtures/idle-work.html')
  const meter = page.locator('svg')
  await expect(meter).toBeVisible()
  await page.evaluate(() => { document.getElementById('meter-host')!.style.display = 'none' })
  await page.waitForTimeout(350)
  await page.evaluate(() => { (window as any).idleWork.frames = 0 })
  await page.waitForTimeout(650)
  const outside = await page.evaluate(() => (window as any).idleWork.frames)
  console.log('invisible meter RAF callbacks in 650ms:', outside)
  expect(outside).toBe(0)
  await page.evaluate(() => {
    (window as any).idleWork.sound()
    document.getElementById('meter-host')!.style.display = ''
  })
  await expect.poll(() => meter.locator('rect').first().getAttribute('height').then(Number)).toBeGreaterThan(1)
  await page.evaluate(() => (window as any).idleWork.hidden(true))
  await page.waitForTimeout(100)
  await page.evaluate(() => { (window as any).idleWork.frames = 0 })
  await page.waitForTimeout(650)
  expect(await page.evaluate(() => (window as any).idleWork.frames)).toBe(0)
  await page.evaluate(() => { (window as any).idleWork.sound(); (window as any).idleWork.hidden(false) })
  await expect.poll(() => page.evaluate(() => (window as any).idleWork.frames)).toBeGreaterThan(0)
})

test('inspector memory batches events, ignores equal snapshots and flushes before changing scope', async ({ page }) => {
  await page.goto('/tests/fixtures/idle-work.html?mode=memory')
  await page.waitForTimeout(150)
  const work = await page.evaluate(async () => {
    const probe = (window as any).idleWork, pane = document.querySelector('.inspector-scroll')!
    probe.writes = 0; probe.scans = 0
    for (let i = 0; i < 8; i++) pane.dispatchEvent(new Event('scroll'))
    await new Promise(resolve => setTimeout(resolve, 100))
    return { writes: probe.writes, scans: probe.scans }
  })
  console.log('memory work for eight scroll events:', work)
  expect(work.writes).toBe(1)
  expect(work.scans).toBe(2)
  await page.evaluate(() => {
    const probe = (window as any).idleWork
    probe.writes = 0
    document.querySelector('.inspector-scroll')!.dispatchEvent(new Event('scroll'))
  })
  await page.waitForTimeout(100)
  expect(await page.evaluate(() => (window as any).idleWork.writes)).toBe(0)
  const leaving = await page.evaluate(() => {
    const pane = document.querySelector('.inspector-scroll')!, details = pane.querySelector('details')!
    details.open = true; details.dispatchEvent(new Event('toggle'))
    pane.scrollTop = 170; pane.dispatchEvent(new Event('scroll'))
    ;(window as any).idleWork.scope('second')
    return JSON.parse(sessionStorage.getItem('soundspectra.panel-memory.first')!)
  })
  expect(leaving).toEqual({ top: [0, 170], open: { first: true } })
  await page.waitForTimeout(150)
  await page.evaluate(() => (window as any).idleWork.scope('first'))
  await expect(page.locator('details')).toHaveAttribute('open', '')
  await expect.poll(() => page.locator('.inspector-scroll').evaluate(node => node.scrollTop)).toBe(170)
  const closed = await page.evaluate(() => {
    const pane = document.querySelector('.inspector-scroll')!
    pane.scrollTop = 230; pane.dispatchEvent(new Event('scroll'))
    ;(window as any).idleWork.mount(false)
    return JSON.parse(sessionStorage.getItem('soundspectra.panel-memory.first')!)
  })
  expect(closed.top).toEqual([0, 230])
})

test('a paused rehearsal clock is idle and playback, seeking and cue jumps remain responsive', async ({ page }) => {
  await page.goto('/tools/performance-lab.html')
  const output = page.locator('.performance-preview output')
  await expect(output).toContainText('0.0 /')
  await output.evaluate(node => {
    const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!
    ;(window as any).clockReads = 0
    Object.defineProperty(node, 'textContent', {
      get() { (window as any).clockReads++; return descriptor.get!.call(this) },
      set(value) { descriptor.set!.call(this, value) },
    })
  })
  await page.waitForTimeout(250)
  const reads = await page.evaluate(() => (window as any).clockReads)
  console.log('paused rehearsal text reads in 250ms:', reads)
  expect(reads).toBe(0)
  await page.getByLabel('预演播放头').fill('12000')
  await expect(output).toContainText('12.0 /')
  await page.getByRole('button', { name: '播放预演', exact: true }).click()
  await expect(output).not.toContainText('12.0 /')
  await page.getByRole('button', { name: '暂停预演', exact: true }).click()
  await page.waitForTimeout(50)
  const paused = await output.textContent()
  await page.waitForTimeout(150)
  await expect(output).toHaveText(paused!)
  await page.getByRole('button', { name: '7.0 · 粒子散入层海', exact: true }).click()
  await expect(output).toContainText('7.0 /')
  await page.getByRole('button', { name: '回到开头', exact: true }).click()
  await expect(output).toContainText('0.0 /')
})

test('paused rehearsal props and visibility changes publish once without restarting idle polling', async ({ page }) => {
  await page.goto('/tests/fixtures/idle-work.html?mode=rehearsal')
  const output = page.locator('.performance-preview output')
  await expect(output).toContainText('0.0 / 36 s')
  await page.evaluate(() => (window as any).idleWork.cue(40000))
  await expect(output).toContainText('40.0 / 44 s')
  await expect(page.getByLabel('预演播放头')).toHaveAttribute('max', '44000')
  await page.evaluate(() => (window as any).idleWork.duration(50000))
  await expect(output).toContainText('40.0 / 54 s')
  await page.getByRole('button', { name: '播放预演', exact: true }).click()
  await page.evaluate(() => (window as any).idleWork.hidden(true))
  await page.waitForTimeout(100)
  const hidden = await output.textContent()
  await page.waitForTimeout(150)
  await expect(output).toHaveText(hidden!)
  await page.evaluate(() => (window as any).idleWork.hidden(false))
  await expect(output).not.toHaveText(hidden!)
  await page.getByRole('button', { name: '暂停预演', exact: true }).click()
  await page.getByLabel('预演播放头').fill('54000')
  await expect(output).toContainText('54.0 / 54 s')
  await page.getByRole('button', { name: '播放预演', exact: true }).click()
  await expect(output).toContainText('54.0 / 54 s')
  await page.getByRole('button', { name: '回到开头', exact: true }).click()
  await expect(output).not.toContainText('54.0 /')
})
