import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420, strictPort: true,
    // Playwright captures browser errors directly. Vite's console forwarding
    // can race its WebSocket connection during standalone renderer probes.
    forwardConsole: process.env.CI ? false : undefined,
    // Downloads, traces and native outputs can be locked while tests/builds write them.
    watch: { ignored: ['**/src-tauri/**', '**/artifacts/**', '**/test-results/**', '**/playwright-report/**', '**/.tools/**', '**/releases/**', '**/dist/**'] },
  },
  // Keep even small Unicode font shards as local files: native CSP excludes data: fonts.
  build: { target: 'es2022', assetsInlineLimit: file => /\.woff2?$/.test(file) ? false : undefined },
})
