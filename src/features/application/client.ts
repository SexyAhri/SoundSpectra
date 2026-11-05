import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { openUrl } from '@tauri-apps/plugin-opener'
import { native } from '../spectrum/bridge'
import packageInfo from '../../../package.json'
import distribution from '../../../release.config.json'

export interface Preferences { closeToTray: boolean; autoCheckUpdates: boolean; autoInstallUpdates: boolean; showUpdateButton: boolean }
export interface ApplicationInfo { version: string; repository: string; updaterConfigured: boolean; development: boolean }
export const defaultPreferences: Preferences = { closeToTray: true, autoCheckUpdates: true, autoInstallUpdates: true, showUpdateButton: true }
const storageKey = 'soundspectra.application.v1'

export async function applicationInfo(): Promise<ApplicationInfo> {
  return native ? invoke('application_info') : { version: packageInfo.version, repository: distribution.repository, updaterConfigured: false, development: true }
}
export async function loadPreferences(): Promise<Preferences> {
  if (native) return invoke('get_preferences')
  const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}')
  return Object.fromEntries(Object.entries(defaultPreferences).map(([key, value]) => [key, typeof stored[key] === 'boolean' ? stored[key] : value])) as unknown as Preferences
}
export async function savePreferences(preferences: Preferences): Promise<Preferences> {
  if (native) return invoke('save_preferences', { preferences })
  localStorage.setItem(storageKey, JSON.stringify(preferences))
  return preferences
}
export async function openHistory(repository: string) {
  return openGithub(repository, '/releases')
}
export async function openRepository(repository = distribution.repository) {
  return openGithub(repository, '')
}
async function openGithub(repository: string, path: '' | '/releases') {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('尚未配置历史版本地址')
  const url = `https://github.com/${repository}${path}`
  if (native) await openUrl(url)
  else window.open(url, '_blank', 'noopener,noreferrer')
}
export const backupConfiguration = () => invoke<string>('backup_configuration')
export const exportDiagnostics = () => invoke<string>('export_diagnostics')

export type ApplicationAction = 'quit' | 'settings' | 'updates' | 'about' | 'rail' | 'scene' | 'lyrics' | 'card' | 'wallpaper'
export function subscribeApplicationActions(onAction: (action: ApplicationAction) => void) {
  return listen<ApplicationAction>('application-action', event => onAction(event.payload))
}
