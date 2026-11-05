import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function makeReleaseConfig(repository, publicKey) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('请配置有效的 GitHub owner/repository。')
  if (!publicKey?.trim()) throw new Error('缺少 TAURI_UPDATER_PUBLIC_KEY；请先生成并备份更新签名密钥。')
  let decoded
  try { decoded = Buffer.from(publicKey.trim(), 'base64').toString('utf8') } catch { /* validated below */ }
  if (!decoded?.startsWith('untrusted comment:') || !decoded.includes('\n')) throw new Error('更新公钥必须是 Tauri signer 生成的完整公钥文件内容。')
  return {
    bundle: { createUpdaterArtifacts: true },
    plugins: {
      updater: { pubkey: publicKey.trim(), endpoints: [`https://github.com/${repository}/releases/latest/download/latest.json`], windows: { installMode: 'passive' } },
      distribution: { repository },
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync('release.config.json', 'utf8'))
  const repository = process.env.GITHUB_REPOSITORY || config.repository
  const publicKey = process.env.TAURI_UPDATER_PUBLIC_KEY || config.publicKey
  const result = makeReleaseConfig(repository, publicKey)
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error('缺少 TAURI_SIGNING_PRIVATE_KEY，未生成可发布配置。')
  writeFileSync('src-tauri/tauri.release.conf.json', JSON.stringify(result, null, 2) + '\n')
  console.log(`已配置签名更新源：${repository}；私钥未写入项目文件。`)
}
