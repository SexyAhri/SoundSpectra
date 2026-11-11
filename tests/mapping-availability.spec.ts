import { expect, test } from '@playwright/test'
import { chooseStyle, settingsSection } from './helpers/module-settings'

test('unsupported effects explain mapping availability instead of showing an empty section', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('soundspectra.settings.v1', JSON.stringify({ effect: 'rhythm_balls', quality: 'eco', regionVisible: false })))
  await page.goto('/#scene')
  await settingsSection(page, '外观')
  const mapping = page.getByRole('region', { name: '音乐响应映射', exact: true })
  await expect(mapping).toContainText('当前灯效使用自身的音乐响应，暂不支持自定映射。')
  await expect(mapping).toContainText('潮汐之结、层海或回声廊道')
  await expect(mapping.getByRole('combobox')).toHaveCount(0)
})

for (const [effect, name] of [['tidal_knot', '潮汐之结'], ['layered_tides', '层海'], ['echo_corridor', '回声廊道']]) {
  test(`${name} mapping remains editable and survives effect switches and reload`, async ({ page }) => {
    await page.addInitScript(effect => {
      if (!localStorage.getItem('soundspectra.settings.v1')) localStorage.setItem('soundspectra.settings.v1', JSON.stringify({ effect, quality: 'eco', regionVisible: false }))
    }, effect)
    await page.goto('/#scene')
    await settingsSection(page, '外观')
    const preset = page.getByRole('combobox', { name: '音乐映射预设', exact: true })
    await preset.click()
    await page.getByRole('option', { name: '低频推动局部展开', exact: true }).click()
    await page.getByText('细调映射', { exact: true }).click()
    await page.getByRole('combobox', { name: '映射来源', exact: true }).click()
    await page.getByRole('option', { name: '中频 RMS', exact: true }).click()
    const saved = () => page.evaluate(effect => JSON.parse(localStorage.getItem('soundspectra.performance.v1')!).mappings[`primary--${effect}`], effect)
    await expect.poll(saved).toMatchObject({ preset: 'custom', source: 'middle', target: 'unfold' })
    await chooseStyle(page, '灯效', '浮光水母')
    await settingsSection(page, '外观')
    await expect(page.getByRole('region', { name: '音乐响应映射', exact: true })).toContainText('暂不支持自定映射')
    await chooseStyle(page, '灯效', name)
    await settingsSection(page, '外观')
    await expect(preset).toHaveText('自定映射')
    await page.reload()
    await settingsSection(page, '外观')
    await expect(preset).toHaveText('自定映射')
    await expect.poll(saved).toMatchObject({ source: 'middle', target: 'unfold' })
  })
}
