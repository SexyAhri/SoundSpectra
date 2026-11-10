// Opt-in Windows integration check. Build with the isolated identifier below
// and custom-protocol, then pass that executable. Never touches Explorer's
// global visibility setting or the user's running SoundSpectra configuration.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

assert.equal(process.platform, "win32");
assert.ok(process.argv[2], "Pass an isolated native test executable");
const identifier = "com.soundspectra.rail-visibility-regression";
const output = resolve("artifacts/rail-visibility-regression");
const port = Number(process.env.RAIL_VISIBILITY_TEST_PORT ?? 9253);
mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [] };
let child, browser, page;
const deadline = (task, message, ms = 15000) => {
  let timer;
  return Promise.race([
    task,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
const invoke = (command, args) =>
  deadline(
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    ),
    `${command} stalled`,
  );
try {
  let busy = false;
  try {
    busy = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  } catch {}
  assert.equal(busy, false, "Test port is already in use");
  child = spawn(resolve(process.argv[2]), [], {
    windowsHide: true,
    stdio: ["ignore", "ignore", openSync(join(output, "native.log"), "w")],
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: join(output, "webview"),
    },
  });
  child.on("error", (error) => report.errors.push(String(error)));
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
        } catch {
          return false;
        }
      },
      { timeout: 20000 },
    )
    .toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const pages = () => browser.contexts().flatMap((context) => context.pages());
  const settingsPage = () =>
    pages().find(
      (p) =>
        p.url().startsWith("http://tauri.localhost") &&
        !new URL(p.url()).searchParams.has("window"),
    );
  await expect.poll(() => !!settingsPage(), { timeout: 20000 }).toBe(true);
  page = settingsPage();
  await expect
    .poll(
      async () => {
        try {
          return (await invoke("application_info")).development;
        } catch {
          return false;
        }
      },
      { timeout: 20000 },
    )
    .toBe(true);
  let backup;
  await expect
    .poll(
      async () => {
        try {
          backup = await invoke("backup_configuration");
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 20000 },
    )
    .toBe(true);
  assert.ok(
    resolve(backup).startsWith(
      `${resolve(process.env.APPDATA, identifier)}${sep}`,
    ),
    "Refusing to mutate a non-isolated app",
  );
  page.on("pageerror", (error) => report.errors.push(error.message));
  const settings = await invoke("get_settings");
  await invoke("update_settings", {
    settings: { ...settings, enabled: false },
  });
  const snapshot = await invoke("rail_get");
  const groupId = snapshot.settings.groups[0].id;
  await invoke("rail_change", { change: { type: "enable", enabled: false } });
  await invoke("rail_add_paths", {
    groupId,
    replaceId: null,
    paths: [
      join(process.env.WINDIR, "notepad.exe"),
      resolve("src-tauri/icons/32x32.png"),
    ],
  });
  const enabled = await invoke("rail_change", {
    change: { type: "enable", enabled: true },
  });
  const railPage = () =>
    pages().find((p) => p.url().includes(`window=rail&group=${groupId}`));
  await expect.poll(() => !!railPage(), { timeout: 20000 }).toBe(true);
  const rail = railPage();
  rail.on("pageerror", (error) => report.errors.push(error.message));
  await expect(rail.locator(".rail-item-media img")).toHaveCount(2);
  await rail.evaluate(() => {
    window.__railMediaReloads = 0;
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLImageElement && node.closest('.rail-item-media')) window.__railMediaReloads++;
        }
      }
    }).observe(document.querySelector('.rail-items'), { childList: true, subtree: true });
  });
  const state = async () =>
    (await invoke("debug_rail_drop_state")).find(
      (w) => w.label === `rail-${groupId}`,
    );
  const healthy = async () => {
    report.lastState = await state();
    return report.lastState?.layoutHealthy;
  };
  const imagesReady = () =>
    rail.locator(".rail-item-media img").evaluateAll(
      (images) =>
        images.length === 2 &&
        images.every((image) => {
          if (!image.complete || !image.naturalWidth) return false;
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0);
          return ctx
            .getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0);
        }),
    );
  await expect.poll(healthy, { timeout: 10000 }).toBe(true);
  await expect.poll(imagesReady).toBe(true);
  const handle = (await state()).windows[0].hwnd;
  report.initialState = await state();
  console.log("Initial rail and both images are ready");
  for (const mode of ["rail", "browser", "cycle", "behind-icons"]) {
    // Also exercise a failed image; a normal snapshot rerender cannot reset
    // RailMedia's failed state when the item identity and path stay unchanged.
    if (mode === "cycle") {
      await rail
        .locator(".rail-item-media img")
        .first()
        .evaluate((image) => {
          image.src = "data:image/png;base64,invalid";
        });
      await expect(rail.locator(".rail-item-media img")).toHaveCount(1);
    }
    const before = await rail.evaluate(() => window.__railMediaReloads);
    await invoke("debug_rail_visibility", { groupId, mode });
    console.log(`Hidden: ${mode}`);
    await expect.poll(healthy, { timeout: 12000 }).toBe(true);
    await expect
      .poll(() => rail.evaluate(() => window.__railMediaReloads), {
        timeout: 12000,
      })
      .toBeGreaterThan(before);
    await expect.poll(imagesReady).toBe(true);
    const restored = await state();
    assert.equal(
      restored.windows[0].hwnd,
      handle,
      "Recovery replaced the rail window",
    );
    assert.ok(
      restored.windows
        .filter((w) => w.class === "Tauri Window" || w.class === "WRY_WEBVIEW")
        .every((w) => w.visible),
    );
    assert.deepEqual(
      (await invoke("rail_get")).settings,
      enabled.settings,
      "Recovery changed the saved layout",
    );
    await rail.locator(".rail-surface").screenshot({
      path: join(output, `${mode}-restored.png`),
      omitBackground: true,
    });
    report.checks.push(
      `${mode}: same native window, saved layout, decoded app icon and image restored automatically`,
    );
    console.log(`Restored: ${mode}`);
  }
  const settled = await rail.evaluate(() => window.__railMediaReloads);
  await expect
    .poll(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 6500));
        return rail.evaluate(() => window.__railMediaReloads);
      },
      { timeout: 10000 },
    )
    .toBe(settled);
  report.checks.push("Healthy recovery ticks do not reload icons repeatedly");
  assert.deepEqual(report.errors, []);
  delete report.initialState;
  delete report.lastState;
} catch (error) {
  report.failure = String(error);
  if (page && browser) {
    try {
      report.rail = await invoke("rail_get");
    } catch (error) {
      report.snapshotError = String(error);
    }
  }
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (page && browser)
      void page
        .evaluate(() => window.__TAURI_INTERNALS__.invoke("quit_application"))
        .catch(() => {});
    try {
      await deadline(exited, "Isolated app did not stop", 10000);
    } catch (error) {
      child.kill();
      report.errors.push(String(error));
      process.exitCode = 1;
    }
  }
  if (browser) await browser.close();
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
