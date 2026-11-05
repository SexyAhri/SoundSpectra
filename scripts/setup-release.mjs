import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const directory = join(homedir(), '.soundspectra', 'release-signing')
mkdirSync(directory, { recursive: true, mode: 0o700 })
if (process.platform === 'win32') {
  const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
  execFileSync('icacls', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`], { stdio: 'pipe', windowsHide: true })
}
const key = join(directory, 'updater.key'), passwordFile = join(directory, 'updater-password.txt')
if (!existsSync(key)) {
  const password = randomBytes(32).toString('hex')
  // Capture the signer's output: it must never echo private key material into logs.
  execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'generate', '--ci', '-p', password, '-w', key], { stdio: 'pipe', windowsHide: true })
  writeFileSync(passwordFile, password, { mode: 0o600 })
}
if (!existsSync(passwordFile) || !existsSync(key + '.pub')) throw new Error('已有签名密钥缺少密码或公钥，请先恢复配套文件；不会覆盖已有密钥。')
const publicKey = readFileSync(key + '.pub', 'utf8').trim()
const release = JSON.parse(readFileSync('release.config.json', 'utf8'))
release.publicKey = publicKey
writeFileSync('release.config.json', JSON.stringify(release, null, 2) + '\n')
const tauri = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
tauri.plugins.updater.pubkey = publicKey
tauri.plugins.updater.endpoints = [`https://github.com/${release.repository}/releases/latest/download/latest.json`]
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauri, null, 2) + '\n')
console.log(`更新公钥与 GitHub 更新源已写入项目。私钥和密码保存在仓库外：${directory}`)
console.log('GitHub Actions 需要 TAURI_SIGNING_PRIVATE_KEY 和 TAURI_SIGNING_PRIVATE_KEY_PASSWORD 两个 Secret；分别使用上述 updater.key 和 updater-password.txt 文件内容。')
