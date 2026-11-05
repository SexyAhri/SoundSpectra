import { chromium, expect } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223')
const page = browser.contexts().flatMap(c => c.pages()).find(p => !p.url().includes('window=overlay') && (p.url().includes('tauri.localhost') || p.url().includes('127.0.0.1:1420')))
if (!page) throw new Error('找不到 SoundSpectra 设置窗口')
const invoke = (command, args) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args })
const original = await invoke('get_preferences')
const report = { application: await invoke('application_info'), errors: [] }
page.on('pageerror', error => report.errors.push(error.message))
const launchSecondInstance = async () => {
  await new Promise((resolve, reject) => {
    const process = spawn('src-tauri/target/debug/soundspectra.exe', [], { windowsHide: true, stdio: 'ignore' })
    process.once('error', reject)
    const timer = setTimeout(() => { process.kill(); reject(new Error('第二个实例没有及时退出')) }, 15000)
    process.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`第二个实例退出码 ${code}`)) })
  })
}
try {
  await page.getByRole('button', { name: '最大化', exact: true }).click()
  await expect(page.getByRole('button', { name: '还原窗口', exact: true })).toBeVisible()
  assert.equal(await invoke('plugin:window|is_maximized', { label: 'settings' }), true)
  await page.getByRole('button', { name: '还原窗口', exact: true }).click()
  await page.getByRole('button', { name: '最小化', exact: true }).click()
  await expect.poll(() => invoke('plugin:window|is_minimized', { label: 'settings' })).toBe(true)
  await launchSecondInstance()
  await expect.poll(() => invoke('plugin:window|is_minimized', { label: 'settings' })).toBe(false)
  report.minimizeAndSingleInstance = true
  await page.getByRole('button', { name: '应用设置与更新', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/此构建尚未启用在线更新/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: '检查更新', exact: true })).toBeDisabled()
  await dialog.getByRole('button', { name: '备份配置', exact: true }).click()
  const notice = dialog.getByRole('status').filter({ hasText: '配置已备份到：' })
  await expect(notice).toBeVisible()
  const folder = (await notice.textContent()).replace('配置已备份到：', '')
  const backup = JSON.parse(readFileSync(`${folder}/settings.json`, 'utf8'))
  assert.deepEqual(backup, await invoke('get_settings'))
  report.backupMatchesCurrent = true
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.screenshot({ path: 'artifacts/application-native.png' })
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await invoke('save_preferences', { preferences: { ...await invoke('get_preferences'), closeToTray: true } })
  await page.reload()
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click()
  await expect.poll(() => invoke('plugin:window|is_visible', { label: 'settings' })).toBe(false)
  await launchSecondInstance()
  await expect.poll(() => invoke('plugin:window|is_visible', { label: 'settings' })).toBe(true)
  report.closeToTrayAndReopen = true
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.error = String(error); process.exitCode = 1; console.error(error)
} finally {
  await invoke('save_preferences', { preferences: { ...await invoke('get_preferences'), closeToTray: original.closeToTray } })
  await page.reload()
  writeFileSync('artifacts/native-application-smoke.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
  await browser.close()
}
