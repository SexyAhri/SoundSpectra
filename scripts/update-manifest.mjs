import { createHash, createPublicKey, verify } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

// Tauri wraps Minisign keys/signatures in base64. Verify both the package
// signature and the signed trusted comment before publishing an update.
export function verifyUpdateSignature(bytes, envelope, publicEnvelope) {
  const keyLines = Buffer.from(publicEnvelope.trim(), 'base64').toString('utf8').split(/\r?\n/)
  const lines = Buffer.from(envelope.trim(), 'base64').toString('utf8').split(/\r?\n/)
  const key = Buffer.from(keyLines[1] || '', 'base64'), packet = Buffer.from(lines[1] || '', 'base64')
  const global = Buffer.from(lines[3] || '', 'base64'), algorithm = packet.subarray(0, 2).toString()
  if (key.length !== 42 || packet.length !== 74 || global.length !== 64 || !['Ed', 'ED'].includes(key.subarray(0, 2).toString()) || !['Ed', 'ED'].includes(algorithm) || !lines[2]?.startsWith('trusted comment: ')) throw Error('更新签名格式无效')
  if (!key.subarray(2, 10).equals(packet.subarray(2, 10))) throw Error('更新私钥与项目公钥不匹配')
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), key.subarray(10)]), format: 'der', type: 'spki' })
  const signature = packet.subarray(10)
  const content = algorithm === 'ED' ? createHash('blake2b512').update(bytes).digest() : bytes
  const comment = Buffer.concat([signature, Buffer.from(lines[2].slice('trusted comment: '.length))])
  if (!verify(null, content, publicKey, signature) || !verify(null, comment, publicKey, global)) throw Error('更新包或签名校验失败，未发布')
}

export function updateManifest(files, { repository, version, notes = '', date = new Date().toISOString() }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) throw Error('发布仓库或版本无效')
  const select = pattern => {
    const matches = files.filter(file => pattern.test(file.name))
    if (matches.length !== 1) throw Error(`发布文件缺失或重复：${pattern}`)
    const file = matches[0], signature = files.find(item => item.name === file.name + '.sig')?.text.trim()
    if (!signature) throw Error(`缺少更新签名：${file.name}`)
    return { signature, url: `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(file.name)}` }
  }
  const windows = select(/-setup\.exe$/i), macos = select(/\.app\.tar\.gz$/i)
  if (!files.some(file => /\.dmg$/i.test(file.name))) throw Error('缺少 macOS DMG 安装包')
  return { version, notes, pub_date: date, platforms: { 'windows-x86_64': windows, 'darwin-aarch64': macos, 'darwin-x86_64': macos } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] || 'artifacts/release'
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => join(item.parentPath, item.name))
  const packageInfo = JSON.parse(readFileSync('package.json', 'utf8'))
  const { repository, publicKey } = JSON.parse(readFileSync('release.config.json', 'utf8'))
  for (const file of files.filter(file => /(?:-setup\.exe|\.app\.tar\.gz)$/i.test(file))) {
    const signature = files.find(item => item === file + '.sig')
    if (!signature) throw Error('缺少更新签名：' + basename(file))
    verifyUpdateSignature(readFileSync(file), readFileSync(signature, 'utf8'), publicKey)
  }
  const notes = readFileSync('CHANGELOG.md', 'utf8').split(/^## /m).find(section => section.startsWith(packageInfo.version + ' '))?.trim() ?? ''
  const manifest = updateManifest(files.map(file => ({ name: basename(file), text: /\.sig$/.test(file) ? readFileSync(file, 'utf8') : '' })), { repository, version: packageInfo.version, notes })
  writeFileSync(join(directory, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n')
  const checksums = files.map(file => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}`).sort()
  writeFileSync(join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
  console.log(`已生成 ${packageInfo.version} 的 Windows、Intel Mac、Apple Silicon Mac 签名更新清单。`)
}
