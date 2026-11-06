import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareRelease } from '../prepare-release.mjs'

function fixture(eventName, releases = [], inputs = {}, ref = 'refs/heads/main') {
  const calls = []
  const context = { eventName, ref, sha: 'build-sha', repo: { owner: 'fixture', repo: 'app' }, payload: { inputs } }
  const repos = Object.fromEntries(['listReleases', 'createRelease', 'updateRelease', 'deleteReleaseAsset'].map(name => [name, async args => {
    calls.push({ name, args })
    return { data: { id: 123 } }
  }]))
  const github = { rest: { repos }, paginate: async (_method, args) => { calls.push({ name: 'paginate', args }); return releases } }
  return { context, github, calls, version: '1.0.5' }
}

test('pushes of an already published version skip installers and never alter its assets', async () => {
  for (const ref of ['refs/heads/main', 'refs/tags/v1.0.5']) {
    const input = fixture('push', [{ id: 10, tag_name: 'v1.0.5', draft: true }, { id: 11, tag_name: 'v1.0.5', draft: false }], {}, ref)
    assert.deepEqual(await prepareRelease(input), { version: '1.0.5', build: false, publish: false, release_id: '' })
    assert.deepEqual(input.calls.map(call => call.name), ['paginate'])
  }
})

test('PRs and manual build-only runs build installers without touching releases', async () => {
  for (const event of ['pull_request', 'workflow_dispatch']) {
    const input = fixture(event, [], { publish: 'false' })
    assert.deepEqual(await prepareRelease(input), { version: '1.0.5', build: true, publish: false, release_id: '' })
    assert.deepEqual(input.calls, [])
  }
})

test('manual publish requests for a published version still build without replacing it', async () => {
  for (const publish of [true, 'true']) {
    const input = fixture('workflow_dispatch', [{ id: 11, tag_name: 'v1.0.5', draft: false }], { publish })
    assert.deepEqual(await prepareRelease(input), { version: '1.0.5', build: true, publish: false, release_id: '' })
    assert.deepEqual(input.calls.map(call => call.name), ['paginate'])
  }
})

test('a new version creates an exact versioned draft for both platform builds', async () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const input = fixture(event, [{ tag_name: 'v1.0.4', draft: false }], { publish: 'true' })
    assert.deepEqual(await prepareRelease(input), { version: '1.0.5', build: true, publish: true, release_id: '123' })
    assert.deepEqual(input.calls.map(call => call.name), ['paginate', 'createRelease'])
    assert.deepEqual(input.calls[1].args, { ...input.context.repo, tag_name: 'v1.0.5', target_commitish: 'build-sha', name: 'SoundSpectra v1.0.5', draft: true, prerelease: false, body: 'Windows x64 + macOS Universal (Intel / Apple Silicon).' })
  }
})

test('retrying an unpublished draft only clears assets from that exact draft', async () => {
  const input = fixture('push', [{ id: 10, tag_name: 'v1.0.4', draft: true, assets: [{ id: 91 }] },
    { id: 12, tag_name: 'v1.0.5', draft: true, assets: [{ id: 92 }] }])
  assert.equal((await prepareRelease(input)).release_id, '12')
  assert.deepEqual(input.calls.slice(1), [
    { name: 'updateRelease', args: { ...input.context.repo, release_id: 12, target_commitish: 'build-sha' } },
    { name: 'deleteReleaseAsset', args: { ...input.context.repo, asset_id: 92 } },
  ])
})

test('a mismatched version tag fails before requesting or modifying releases', async () => {
  const input = fixture('push', [], {}, 'refs/tags/v1.0.4')
  await assert.rejects(prepareRelease(input), /Tag and package version disagree/)
  assert.deepEqual(input.calls, [])
})
