import test from 'node:test'
import assert from 'node:assert/strict'
import { publishRelease } from '../publish-release.mjs'

test('publishing uploads to the exact release ID, uploads the manifest last and validates attachments before publishing', async () => {
  const calls = [], remote = []
  const result = await publishRelease({ repository: 'SexyAhri/SoundSpectra', releaseId: 123, version: '1.0.1', token: 'fixture',
    assets: [{ name: 'latest.json', bytes: Buffer.from('{}') }, { name: 'installer.exe', bytes: Buffer.from('package') }],
    fetcher: async (url, options) => {
      calls.push({ url, method: options.method || 'GET' })
      if (url.startsWith('https://uploads.github.com/')) {
        assert.match(url, /\/releases\/123\/assets\?name=/)
        remote.push({ name: new URL(url).searchParams.get('name'), size: options.body.length, state: 'uploaded' })
        return Response.json(remote.at(-1))
      }
      if (options.method === 'PATCH') { assert.equal(remote.length, 2); return Response.json({ draft: false }) }
      return Response.json(url.includes('/assets?') ? remote : { id: 123, tag_name: 'v1.0.1', draft: true })
    },
  })
  assert.deepEqual(result.assets, ['installer.exe', 'latest.json'])
  assert.equal(calls.at(-1).method, 'PATCH')
  assert.equal(calls.some(call => call.url.includes('/tags/')), false)
})

test('a missing remote attachment blocks publication', async () => {
  let published = false
  await assert.rejects(publishRelease({ repository: 'SexyAhri/SoundSpectra', releaseId: 123, version: '1.0.1', token: 'fixture', assets: [{ name: 'installer.exe', bytes: Buffer.from('package') }],
    fetcher: async (url, options) => {
      if (options.method === 'PATCH') published = true
      return Response.json(url.includes('/assets?') ? [] : { tag_name: 'v1.0.1', draft: true })
    },
  }), /附件验收失败/)
  assert.equal(published, false)
})

test('the exact versioned draft from the build commit can replace an untagged placeholder', async () => {
  const patches = []
  let release = { id: 123, name: 'SoundSpectra v1.0.3', tag_name: 'untagged-example', draft: true, target_commitish: 'build-sha' }
  await publishRelease({ repository: 'SexyAhri/SoundSpectra', releaseId: 123, version: '1.0.3', sourceCommit: 'build-sha', token: 'fixture', assets: [],
    fetcher: async (url, options) => {
      if (options.method === 'PATCH') {
        const patch = JSON.parse(options.body)
        patches.push(patch)
        release = { ...release, ...patch }
      }
      return Response.json(url.includes('/assets?') ? [] : release)
    },
  })
  assert.deepEqual(patches, [{ tag_name: 'v1.0.3', draft: true }, { draft: false }])
})

test('a placeholder draft from another version or source commit cannot be relabeled', async () => {
  for (const fields of [{ name: 'SoundSpectra v1.0.2', target_commitish: 'build-sha' }, { name: 'SoundSpectra v1.0.3', target_commitish: 'other-sha' }]) {
    await assert.rejects(publishRelease({ repository: 'SexyAhri/SoundSpectra', releaseId: 123, version: '1.0.3', sourceCommit: 'build-sha', token: 'fixture', assets: [],
      fetcher: async (_url, options) => {
        assert.equal(options.method, undefined)
        return Response.json({ id: 123, tag_name: 'untagged-example', draft: true, ...fields })
      },
    }), /预期 v1.0.3/)
  }
})
