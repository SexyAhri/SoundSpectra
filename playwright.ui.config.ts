import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Workbench tests use a frozen build. Renderer probes need Vite's TSX fixtures.
export default defineConfig({
  ...base,
  outputDir: 'artifacts/ui-workspace-tests',
  use: { ...base.use, baseURL: 'http://127.0.0.1:1422' },
  projects: [
    { name: 'workspace', testMatch: ['**/effect-settings.spec.ts', '**/performance-placement.spec.ts', '**/inspector-layout.spec.ts', '**/rail.spec.ts', '**/studio.spec.ts',  '**/workspace-experience.spec.ts', '**/workspace-layout.spec.ts', '**/settings.spec.ts', '**/application.spec.ts', '**/theme.spec.ts', '**/audio-sources.spec.ts'], use: { ...base.use, baseURL: 'http://127.0.0.1:1422' } },
    { name: 'renderer-fixtures', testMatch: ['**/music-card.spec.ts', '**/wallpaper-depth.spec.ts', '**/lyrics.spec.ts', '**/desktop-scenes.spec.ts', '**/valley-library.spec.ts'], use: { ...base.use, baseURL: 'http://127.0.0.1:1423' } },
  ],
  webServer: [
    { command: 'npm run preview -- --outDir artifacts/ui-build --port 1422 --strictPort', url: 'http://127.0.0.1:1422', reuseExistingServer: true },
    { command: 'npm run dev -- --port 1423 --strictPort', url: 'http://127.0.0.1:1423', reuseExistingServer: true },
  ],
})
