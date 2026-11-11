# Scene thumbnails

These WebP files capture SoundSpectra's production desktop preview with the three
presets in `src/features/preview/desktop-scenes.ts`. They use the browser's neutral
preview background, simulated analysis and original demo lyrics. No private
wallpaper, account, song metadata or audio is captured.

To regenerate after changing a preset or its visual components, start a dedicated
Vite dev server and run from the repository root:

```powershell
npm run dev -- --port 1449
# In a separate terminal:
node scripts/capture-scene-thumbnails.mjs --port=1449
```

The script updates `manifest.json` with the full scene signature. A saved scene
with the same settings can reuse a capture, regardless of JSON key order.
Newly saved favorites first use a real preview snapshot stored locally in
IndexedDB, validated against their scene signature and saved version. The cache
holds up to 80 snapshots, each at most 256 KiB. Snapshot failure does not prevent
saving settings. Favorites without a valid snapshot use a matching preset capture
or the layout diagram labeled “布局示意”. A failed image also falls back to that
diagram. Gallery thumbnails never mount renderers.

Gallery images preserve the desktop's full 16:9 composition; they are representative
demo frames, not a promise of the user's wallpaper or the currently playing song.
