import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { updateManifest, verifyUpdateSignature } from '../update-manifest.mjs'

const files = [
  { name: 'SoundSpectra_1.0.1_x64-setup.exe', text: '' }, { name: 'SoundSpectra_1.0.1_x64-setup.exe.sig', text: 'windows-signature\n' },
  { name: 'SoundSpectra.app.tar.gz', text: '' }, { name: 'SoundSpectra.app.tar.gz.sig', text: 'macos-signature\n' },
  { name: 'SoundSpectra_1.0.1_universal.dmg', text: '' },
]
const options = { repository: 'SexyAhri/SoundSpectra', version: '1.0.1' }
test('updates target the Windows installer and both architectures of the universal Mac app', () => {
  const result = updateManifest(files, options)
  assert.equal(result.version, '1.0.1')
  assert.match(result.platforms['windows-x86_64'].url, /v1\.0\.1\/.*-setup\.exe$/)
  assert.equal(result.platforms['windows-x86_64'].signature, 'windows-signature')
  assert.deepEqual(result.platforms['darwin-aarch64'], result.platforms['darwin-x86_64'])
  assert.match(result.platforms['darwin-aarch64'].url, /\.app\.tar\.gz$/)
})
test('incomplete or ambiguous builds cannot become a published update', () => {
  for (const missing of ['.dmg', '.exe.sig', '.app.tar.gz', '.app.tar.gz.sig']) {
    assert.throws(() => updateManifest(files.filter(file => !file.name.endsWith(missing)), options))
  }
  assert.throws(() => updateManifest([...files, { name: 'duplicate-setup.exe', text: '' }], options))
})

test('publishing verifies the payload, matching key and signed comment', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519'), id = randomBytes(8), bytes = Buffer.from('original release package')
  const rawKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)
  const key = Buffer.from('untrusted comment: key\n' + Buffer.concat([Buffer.from('Ed'), id, rawKey]).toString('base64')).toString('base64')
  const signature = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey), comment = 'version:1.0.1'
  const lines = ['untrusted comment: signature', Buffer.concat([Buffer.from('ED'), id, signature]).toString('base64'), 'trusted comment: ' + comment, sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString('base64')]
  const encode = lines => Buffer.from(lines.join('\n')).toString('base64')
  assert.doesNotThrow(() => verifyUpdateSignature(bytes, encode(lines), key))
  assert.throws(() => verifyUpdateSignature(Buffer.from('modified package'), encode(lines), key))
  assert.throws(() => verifyUpdateSignature(bytes, encode(lines.map((line, index) => index === 2 ? 'trusted comment: changed' : line)), key))
  const otherId = Buffer.from(Buffer.from(key, 'base64').toString().split('\n')[1], 'base64'); otherId[2] ^= 1
  const otherKey = Buffer.from('untrusted comment: key\n' + otherId.toString('base64')).toString('base64')
  assert.throws(() => verifyUpdateSignature(bytes, encode(lines), otherKey))
})
