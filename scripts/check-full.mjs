import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const npm = process.env.npm_execpath
if (!npm) {
  console.error('请使用 npm run check:full 运行本机全量检查。')
  process.exit(1)
}

// Match Checks with full=true; desktop.mjs supplies the local native toolchain.
// This command validates the current platform without packaging or publishing.
const env = { ...process.env, CI: 'true', CARGO_BUILD_JOBS: '1' }
const cargo = (...args) => ['scripts/desktop.mjs', '--cargo', ...args]
const steps = [
  ['安装锁定的前端依赖', [npm, 'ci']],
  ['版本一致性', [npm, 'run', 'version:check']],
  ['发布脚本测试', [npm, 'run', 'test:release']],
  ['前端构建', [npm, 'run', 'build']],
  ['准备 Chrome', ['scripts/check-browser.mjs']],
  ['完整浏览器回归', [npm, 'test']],
  ['Rust 格式检查', cargo('fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--', '--check')],
  ['完整 Rust 测试', cargo('test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked')],
  ['原生构建（custom-protocol）', cargo('build', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--features', 'custom-protocol')],
]

const started = Date.now()
for (const [index, [name, args]] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${name}`)
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) {
    console.error(`\n全量检查未通过：${name}。${result.error?.message ?? result.signal ?? ''}`)
    process.exit(result.status || 1)
  }
}
console.log(`\n本机全量检查通过（${Math.round((Date.now() - started) / 1000)} 秒）。`)
