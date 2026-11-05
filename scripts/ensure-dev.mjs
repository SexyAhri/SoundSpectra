import { spawn } from 'node:child_process'
import { join } from 'node:path'

let existing = false
try {
  const response = await fetch('http://127.0.0.1:1420/', { signal: AbortSignal.timeout(1500) })
  const html = await response.text()
  if (!html.includes('SoundSpectra')) {
    console.error('1420 端口已被其他服务占用，请关闭该服务或更改开发端口。')
    process.exit(1)
  }
  existing = true
} catch { /* Vite will report an occupied or inaccessible port if necessary. */ }

if (existing) {
  console.log('复用已运行的 SoundSpectra 前端预览服务。')
} else {
  const server = spawn(process.execPath, [join(process.cwd(), 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { stdio: 'inherit', windowsHide: true })
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
  server.on('exit', (code) => { process.exitCode = code ?? 1 })
  process.on('SIGTERM', () => server.kill())
  process.on('SIGINT', () => server.kill())
}
