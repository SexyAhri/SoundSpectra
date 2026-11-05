import { readFileSync, writeFileSync } from 'node:fs'

const paths = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json']
const documents = paths.map((path) => JSON.parse(readFileSync(path, 'utf8')))
const cargoPath = 'src-tauri/Cargo.toml'
const cargo = readFileSync(cargoPath, 'utf8')
const lockPath = 'src-tauri/Cargo.lock'
const lock = readFileSync(lockPath, 'utf8')
const ownPackage = /(\[\[package\]\]\r?\nname = "soundspectra"\r?\nversion = ")([^"]+)(")/
const version = process.argv[2] === '--check' ? documents[0].version : process.argv[2]
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) throw new Error('用法：node scripts/version.mjs 0.2.0 或 --check')
if (process.argv[2] === '--check') {
  if (documents.some((doc) => doc.version !== version) || documents[1].packages[''].version !== version || cargo.match(/^version = "([^"]+)"/m)?.[1] !== version || lock.match(ownPackage)?.[2] !== version) throw new Error('版本号不一致，请运行 npm run version:set -- <版本>。')
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
  if (tag && tag !== `v${version}`) throw new Error(`标签 ${tag} 与项目版本 ${version} 不一致。`)
  console.log(`版本一致：${version}`)
} else {
  documents.forEach((doc, index) => {
    doc.version = version
    if (index === 1) doc.packages[''].version = version
    writeFileSync(paths[index], JSON.stringify(doc, null, 2) + '\n')
  })
  writeFileSync(cargoPath, cargo.replace(/^version = "[^"]+"/m, `version = "${version}"`))
  writeFileSync(lockPath, lock.replace(ownPackage, (_, prefix, _old, suffix) => `${prefix}${version}${suffix}`))
  console.log(`版本已更新为 ${version}，包含前后端清单和锁文件。`)
}
