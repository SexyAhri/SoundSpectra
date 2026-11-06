// Shared by the workflow and local release tests. Published assets are immutable;
// manual builds can still produce fresh artifacts without replacing a release.
export async function prepareRelease({ github, context, version }) {
  const tag = `v${version}`
  if (context.ref.startsWith('refs/tags/') && context.ref !== `refs/tags/${tag}`)
    throw new Error('Tag and package version disagree')
  const plan = { version, build: true, publish: false, release_id: '' }
  const publish = context.eventName === 'push'
    || context.eventName === 'workflow_dispatch' && [true, 'true'].includes(context.payload.inputs?.publish)
  if (!publish) return plan

  const releases = await github.paginate(github.rest.repos.listReleases, { ...context.repo, per_page: 100 })
  const candidates = releases.filter(release => release.tag_name === tag)
  let release = candidates.find(release => !release.draft) || candidates.find(release => release.draft)
  if (release && !release.draft) return { ...plan, build: context.eventName !== 'push' }

  if (!release) release = (await github.rest.repos.createRelease({
    ...context.repo, tag_name: tag, target_commitish: context.sha,
    name: `SoundSpectra ${tag}`, draft: true, prerelease: version.includes('-'),
    body: 'Windows x64 + macOS Universal (Intel / Apple Silicon).',
  })).data
  else {
    await github.rest.repos.updateRelease({ ...context.repo, release_id: release.id, target_commitish: context.sha })
    for (const asset of release.assets)
      await github.rest.repos.deleteReleaseAsset({ ...context.repo, asset_id: asset.id })
  }
  return { ...plan, publish: true, release_id: String(release.id) }
}
