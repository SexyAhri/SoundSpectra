import test from 'node:test'
import assert from 'node:assert/strict'
import { updateManifest } from '../update-manifest.mjs'

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
