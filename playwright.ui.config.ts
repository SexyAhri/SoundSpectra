import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const workspacePort = Number(process.env.PLAYWRIGHT_UI_PORT ?? 1422);
const fixturesPort = Number(process.env.PLAYWRIGHT_FIXTURES_PORT ?? 1423);
const workspaceURL = `http://127.0.0.1:${workspacePort}`;
const fixturesURL = `http://127.0.0.1:${fixturesPort}`;

// Workbench tests use a frozen build. Renderer probes need Vite's TSX fixtures.
export default defineConfig({
  ...base,
  outputDir: "artifacts/ui-workspace-tests",
  use: { ...base.use, baseURL: workspaceURL },
  projects: [
    {
      name: "workspace",
      testMatch: [
        "**/effect-settings.spec.ts",
        "**/performance-placement.spec.ts",
        "**/inspector-layout.spec.ts",
        "**/rail.spec.ts",
        "**/studio.spec.ts",
        "**/workspace-experience.spec.ts",
        "**/workspace-layout.spec.ts",
        "**/music-dock-layout.spec.ts",
        "**/settings.spec.ts",
        "**/application.spec.ts",
        "**/theme.spec.ts",
        "**/audio-sources.spec.ts",
      ],
      use: { ...base.use, baseURL: workspaceURL },
    },
    {
      name: "renderer-fixtures",
      testMatch: [
        "**/music-card.spec.ts",
        "**/wallpaper-depth.spec.ts",
        "**/lyrics.spec.ts",
        "**/desktop-scenes.spec.ts",
        "**/valley-library.spec.ts",
        "**/workspace-polish.spec.ts",
        "**/startup.spec.ts",
        "**/atmosphere-home.spec.ts",
        "**/progress-motion.spec.ts",
        "**/music-library.spec.ts",
        "**/music-readonly.spec.ts",
        "**/music-kugou.spec.ts",
        "**/music-recovery.spec.ts",
      ],
      use: { ...base.use, baseURL: fixturesURL },
    },
  ],
  webServer: [
    {
      command: `npm run preview -- --outDir artifacts/ui-build --port ${workspacePort} --strictPort`,
      url: workspaceURL,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npm run dev -- --port ${fixturesPort} --strictPort`,
      url: fixturesURL,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
