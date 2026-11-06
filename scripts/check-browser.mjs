import { spawnSync } from 'node:child_process'
import { chromium } from '@playwright/test'

try {
  const browser = await chromium.launch({ channel: 'chrome' })
  console.log(`Chrome 已就绪：${browser.version()}`)
  await browser.close()
} catch (error) {
  const missing = error.message.includes("Executable doesn't exist")
    || /Chromium distribution .* is not found/.test(error.message)
  if (!missing || !process.env.npm_execpath) throw error
  const result = spawnSync(process.execPath,
    [process.env.npm_execpath, 'exec', '--', 'playwright', 'install', 'chrome'],
    { stdio: 'inherit', env: process.env, windowsHide: true })
  if (result.error) console.error(result.error.message)
  process.exit(result.status ?? 1)
}
