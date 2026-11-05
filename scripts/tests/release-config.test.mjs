import test from 'node:test'
import assert from 'node:assert/strict'
import { makeReleaseConfig } from '../release-config.mjs'

const testPublicKey = Buffer.from('untrusted comment: test public key\nRWTestOnly\n').toString('base64')
test('release config keeps private keys out and enables HTTPS signed artifacts', () => {
  const config = makeReleaseConfig('SexyAhri/SoundSpectra', testPublicKey)
  assert.equal(config.bundle.createUpdaterArtifacts, true)
  assert.deepEqual(config.plugins.updater.endpoints, ['https://github.com/SexyAhri/SoundSpectra/releases/latest/download/latest.json'])
  assert.equal(config.plugins.updater.windows.installMode, 'passive')
  assert.equal(JSON.stringify(config).includes('PRIVATE_KEY'), false)
})
test('release preparation refuses missing keys and unexpected repository paths', () => {
  assert.throws(() => makeReleaseConfig('SexyAhri/SoundSpectra', ''))
  assert.throws(() => makeReleaseConfig('../evil/path', testPublicKey))
  assert.throws(() => makeReleaseConfig('SexyAhri/SoundSpectra', 'not-a-public-key'))
})
