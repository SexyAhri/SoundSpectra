import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { windowsBuildEnvironment } from './windows-env.mjs'

const { env, problems, rustc, cargo, toolset, sdkVersion } = process.platform === 'darwin'
  ? { env: { ...process.env }, problems: [], rustc: 'system toolchain', cargo: 'system toolchain', toolset: 'Xcode', sdkVersion: 'macOS SDK' }
  : windowsBuildEnvironment()
console.log(`Node.js: ${process.version}\nRust: ${rustc ?? '不可用'}\nCargo: ${cargo ?? '不可用'}\nMSVC: ${toolset ?? '未找到'}\nWindows SDK: ${sdkVersion ?? '未找到'}`)
if (problems.length) {
  console.error(`\n原生端暂不能构建：\n${problems.map((item) => `- ${item}`).join('\n')}\n详见 docs/DEVELOPMENT.md。`)
  process.exitCode = 1
} else if (process.argv[2] === '--check') {
  console.log('\nRust、MSVC 和 Windows SDK 检查通过。构建环境仅对当前进程及其子进程生效。')
} else {
  const args = process.argv.slice(2)
  const cargoMode = args[0] === '--cargo'
  const child = cargoMode
    ? spawn('cargo', [...args.slice(1)], { stdio: 'inherit', env, windowsHide: true })
    : spawn(process.execPath, [join(process.cwd(), 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), args[0] === '--build' ? 'build' : 'dev', ...args.slice(args[0] === '--build' ? 1 : 0)], { stdio: 'inherit', env, windowsHide: true })
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', (code) => { process.exitCode = code ?? 1 })
}
