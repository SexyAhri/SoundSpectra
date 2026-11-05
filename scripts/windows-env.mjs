import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, delimiter, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const versions = (root) => existsSync(root)
  ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => entry.name).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  : []

export function windowsBuildEnvironment() {
  const env = { ...process.env }
  // Windows environment names are case-insensitive, but a spread JS object is not.
  // Keep exactly one spelling so child_process does not discard the original Path.
  for (const name of ['PATH', 'LIB', 'INCLUDE']) {
    const keys = Object.keys(env).filter((key) => key.toUpperCase() === name)
    const value = keys.map((key) => env[key]).find(Boolean)
    for (const key of keys) delete env[key]
    if (value) env[name] = value
  }
  env.CARGO_BUILD_JOBS ??= '1'
  const cargoBin = join(env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin')
  env.PATH = [cargoBin, dirname(process.execPath), env.PATH ?? ''].join(delimiter)
  const probe = (program, args) => {
    try { return execFileSync(program, args, { env, encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
    catch { return null }
  }
  const problems = []
  if (process.platform !== 'win32') problems.push('本原型的原生端仅支持 Windows。')
  const rustc = probe('rustc', ['--version'])
  const cargo = probe('cargo', ['--version'])
  if (!rustc || !cargo) problems.push('请安装 Rust stable 的 x86_64-pc-windows-msvc 工具链。')
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = join(programFilesX86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  let installations = []
  try { installations = JSON.parse(probe(vswhere, ['-products', '*', '-format', 'json', '-utf8']) ?? '[]') }
  catch { /* The exact missing tool is reported below. */ }
  let toolset
  let visualStudio
  for (const installation of installations) {
    const root = join(installation.installationPath, 'VC', 'Tools', 'MSVC')
    for (const version of versions(root)) {
      const candidate = join(root, version)
      // Individual v143 components in VS 2026 do not carry the generic latest-toolset ID.
      // Some version directories contain only metadata; check real compiler/library files.
      if (['bin/Hostx64/x64/cl.exe', 'bin/Hostx64/x64/link.exe', 'lib/x64/libcmt.lib', 'include/vcruntime.h'].every((file) => existsSync(join(candidate, file)))) {
        toolset = candidate; visualStudio = installation.installationPath; break
      }
    }
    if (toolset) break
  }
  const kitsInfo = probe('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows Kits\\Installed Roots', '/v', 'KitsRoot10'])
  const kits = kitsInfo?.match(/KitsRoot10\s+REG_SZ\s+(.+)/)?.[1]?.trim() ?? join(programFilesX86, 'Windows Kits', '10')
  const sdkVersion = versions(join(kits, 'Lib')).find((version) =>
    ['Lib/' + version + '/um/x64/kernel32.lib', 'Lib/' + version + '/ucrt/x64/ucrt.lib',
      'Include/' + version + '/um/Windows.h', 'bin/' + version + '/x64/rc.exe'].every((file) => existsSync(join(kits, file))))
  if (!toolset) problems.push('未找到完整的 MSVC C++ x64/x86 生成工具。请在 Visual Studio Installer 的单个组件中安装。')
  if (!sdkVersion) problems.push('未找到完整的 Windows SDK（含 x64 库与资源编译器）。')
  if (toolset && sdkVersion) {
    env.PATH = [join(toolset, 'bin', 'Hostx64', 'x64'), join(kits, 'bin', sdkVersion, 'x64'), env.PATH].join(delimiter)
    env.LIB = [join(toolset, 'lib', 'x64'), join(kits, 'Lib', sdkVersion, 'um', 'x64'), join(kits, 'Lib', sdkVersion, 'ucrt', 'x64'), env.LIB].filter(Boolean).join(delimiter)
    env.INCLUDE = [join(toolset, 'include'), ...['ucrt', 'shared', 'um', 'winrt'].map((folder) => join(kits, 'Include', sdkVersion, folder)), env.INCLUDE].filter(Boolean).join(delimiter)
    env.VCINSTALLDIR = join(visualStudio, 'VC') + '\\'
    env.VCToolsInstallDir = toolset + '\\'
    env.WindowsSdkDir = kits + '\\'
    env.WindowsSDKVersion = sdkVersion + '\\'
    env.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = join(toolset, 'bin', 'Hostx64', 'x64', 'link.exe')
  }
  return { env, problems, rustc, cargo, toolset, sdkVersion }
}
