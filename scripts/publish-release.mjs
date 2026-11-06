import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyUpdateSignature } from './update-manifest.mjs'

export async function publishRelease({ repository, releaseId, version, token, assets, sourceCommit, repairMissing = false, fetcher = fetch }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^\d+$/.test(String(releaseId)) || !token) throw Error('发布参数不完整')
  const api = `https://api.github.com/repos/${repository}`
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  const request = async (url, options = {}) => {
    const response = await fetcher(url, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(180000) })
    if (!response.ok) throw Error(`GitHub ${options.method || 'GET'} failed (${response.status}): ${await response.text()}`)
    return response.status === 204 ? null : response.json()
  }
  let release = await request(`${api}/releases/${releaseId}`)
  const expectedTag = `v${version}`
  // GitHub can give a draft an untagged-* placeholder before its tag exists.
  // Repair only the exact versioned draft from this build's source commit.
  if (release.draft && release.tag_name?.startsWith('untagged-') &&
      release.name === `SoundSpectra ${expectedTag}` && sourceCommit && release.target_commitish === sourceCommit) {
    release = await request(`${api}/releases/${releaseId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_name: expectedTag, draft: true }),
    })
  }
  if (release.tag_name !== expectedTag) throw Error(`Release ID 与项目版本不一致：Release ${releaseId} 标签为 ${release.tag_name}，预期 ${expectedTag}`)
  if (!release.draft && !repairMissing) throw Error('已发布的版本不能覆盖；请递增版本号')
  const existing = await request(`${api}/releases/${releaseId}/assets?per_page=100`)
  // Upload the manifest last. Never resolve a draft by tag: several drafts may
  // share that tag, while this ID is the exact release prepared by the workflow.
  const ordered = [...assets].sort((a, b) => Number(a.name === 'latest.json') - Number(b.name === 'latest.json'))
  for (const asset of ordered) {
    const digest = 'sha256:' + createHash('sha256').update(asset.bytes).digest('hex')
    const old = existing.find(item => item.name === asset.name)
    if (old) {
      if (old.size !== asset.bytes.length || old.digest && old.digest !== digest) throw Error(`不能覆盖已有附件：${asset.name}`)
      continue
    }
    await request(`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: asset.bytes,
    })
  }
  const uploaded = await request(`${api}/releases/${releaseId}/assets?per_page=100`)
  for (const asset of assets) {
    const remote = uploaded.find(item => item.name === asset.name)
    const digest = 'sha256:' + createHash('sha256').update(asset.bytes).digest('hex')
    if (!remote || remote.size !== asset.bytes.length || remote.state !== 'uploaded' || remote.digest && remote.digest !== digest) throw Error(`公开发布前附件验收失败：${asset.name}`)
  }
  if (release.draft) await request(`${api}/releases/${releaseId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: false }) })
  return { id: Number(releaseId), version, assets: uploaded.map(asset => asset.name) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] || 'artifacts/release'
  const files = readdirSync(directory, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => join(item.parentPath, item.name))
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  const { repository, publicKey } = JSON.parse(readFileSync('release.config.json', 'utf8'))
  const assets = files.filter(file => /(?:-setup\.exe(?:\.sig)?|\.dmg|\.app\.tar\.gz(?:\.sig)?|latest\.json|SHA256SUMS\.txt)$/i.test(file)).map(file => ({ name: basename(file), bytes: readFileSync(file) }))
  if (new Set(assets.map(asset => asset.name)).size !== assets.length || assets.length !== 7) throw Error('发布附件缺失或重名')
  const manifest = JSON.parse(assets.find(asset => asset.name === 'latest.json').bytes.toString('utf8'))
  if (manifest.version !== version) throw Error('更新清单版本不一致')
  for (const platform of ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64']) {
    const entry = manifest.platforms?.[platform]
    const prefix = `https://github.com/${repository}/releases/download/v${version}/`
    if (!entry?.url.startsWith(prefix)) throw Error(`更新平台地址不正确：${platform}`)
    const file = assets.find(asset => asset.name === decodeURIComponent(entry.url.slice(prefix.length)))
    const signature = assets.find(asset => asset.name === file?.name + '.sig')?.bytes.toString('utf8').trim()
    if (!file || signature !== entry.signature) throw Error(`更新文件与清单不一致：${platform}`)
    verifyUpdateSignature(file.bytes, signature, publicKey)
  }
  console.log(await publishRelease({ repository, releaseId: process.env.RELEASE_ID, version, sourceCommit: process.env.GITHUB_SHA, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN, assets, repairMissing: process.argv.includes('--repair-missing') }))
}
