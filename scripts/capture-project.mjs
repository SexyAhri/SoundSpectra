// Reproducible public screenshots: production UI, isolated browser state, no accounts.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = process.env.SHOWCASE_URL ?? "http://127.0.0.1:1420";
const output = "docs/images";
await mkdir(output, { recursive: true });
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--enable-webgl",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 940 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("soundspectra.theme", "light");
    localStorage.setItem(
      "soundspectra.settings.v1",
      JSON.stringify({
        version: 1,
        effect: "tidal_knot",
        quality: "eco",
        sceneMode: "immersive",
        opacity: 90,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
      }),
    );
  });
  await page.goto(base);
  await page.getByRole("switch", { name: "模拟预览", exact: true }).click();
  await page.locator("canvas[data-preparing=false]").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(2500);
  // Author-provided showcase images must never be replaced by a simulation.
  await page.screenshot({ path: "artifacts/workspace-simulation.png", animations: "disabled" });

  // Render the actual login component with only public platform capabilities.
  await page.addInitScript(() => {
    window.isTauri = true;
  });
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { MusicLibrary } from '/src/features/music/music-library.tsx';
    import { emptySnapshot } from '/src/features/music/types.ts';
    import '/src/index.css';
    window.isTauri = true;
    const snapshot = structuredClone(emptySnapshot);
    snapshot.providers = [['qq', 'QQ 音乐'], ['netease', '网易云音乐'], ['kugou', '酷狗音乐']].map(([id, name]) => ({ id, name, capabilities: ['qr-login'] }));
    window.__TAURI_INTERNALS__ = { invoke: async command => command === 'music_snapshot' ? snapshot : null };
    document.documentElement.dataset.theme = 'light';
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div', {className:'studio-shell',style:{height:'100dvh',display:'flex'}}, React.createElement(MusicLibrary)));
  `,
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "网易云音乐 可连接" }).waitFor();
  await page.getByRole("button", { name: "网易云音乐 可连接" }).click();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/music-login.png`, animations: "disabled" });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Captured public login to docs/images and workspace simulation to artifacts; author screenshots preserved.",
  );
} finally {
  await browser.close();
}
