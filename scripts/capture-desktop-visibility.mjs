import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { visualProbeHtml } from "./visual-probe-html.mjs";

const option = (name) =>
  process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const label = option("label");
if (!label || !/^[\w-]+$/.test(label)) throw Error("Pass a unique --label");
const folder = `artifacts/desktop-visibility/${label}`;
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-webgl"],
});
try {
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.routeWebSocket("**", (socket) => {
    socket.send(JSON.stringify({ type: "connected" }));
    socket.onMessage(() => {});
  });
  await page.route("**/desktop-visibility-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: visualProbeHtml("<body></body>"),
    }),
  );
  await page.goto("http://127.0.0.1:1420/desktop-visibility-probe");
  const catalog = await page.evaluate(async () => {
    const { musicEffects } =
      await import("/src/features/spectrum/music-engine/catalog.ts");
    return musicEffects;
  });
  const effects =
    option("effects")?.split(",") ?? catalog.map((item) => item.value);
  const reports = [];
  for (const effect of effects) {
    const report = await page.evaluate(async (effect) => {
      const { renderVisualStudy, studySettings } =
        await import("/src/features/spectrum/visual-study.ts");
      return renderVisualStudy(
        document.body,
        { ...studySettings(effect, "daily"), opacity: 85 },
        { width: 480, height: 270, points: [{ id: "sustain", time: 5.2 }] },
      );
    }, effect);
    const frame = report.frames[0];
    await writeFile(
      `${folder}/${effect}.png`,
      Buffer.from(frame.image.split(",")[1], "base64"),
    );
    delete frame.image;
    reports.push(report);
    console.log(`${effect}: errors=${report.errors.length}`);
  }
  await writeFile(
    `${folder}/report.json`,
    JSON.stringify(
      {
        input:
          "Fixed synthetic analysis; transparent desktop output at 85% opacity; no system playback or capture.",
        catalog,
        errors,
        reports,
      },
      null,
      2,
    ),
  );
  if (
    errors.length ||
    reports.some(
      (r) => r.errors.length || r.remaining.geometries || r.remaining.textures,
    )
  )
    process.exitCode = 1;
} finally {
  await browser.close();
}
