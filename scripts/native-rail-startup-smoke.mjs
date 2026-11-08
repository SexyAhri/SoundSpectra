// Run against an isolated custom-protocol debug build using the identifier below.
// Optional second argument: JSON array of existing file paths to mount read-only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { chromium, expect } from "@playwright/test";

assert.equal(process.platform, "win32");
assert.ok(process.argv[2], "Pass an isolated native test executable");
const identifier = "com.soundspectra.rail-visibility-regression";
const output = resolve("artifacts/rail-startup-regression");
const port = Number(process.env.RAIL_STARTUP_TEST_PORT ?? 9254);
const paths = process.argv[3]
  ? JSON.parse(readFileSync(process.argv[3], "utf8"))
  : [join(process.env.WINDIR, "notepad.exe"), resolve("src-tauri/icons/32x32.png")];
assert.ok(Array.isArray(paths) && paths.length && paths.every(p => typeof p === "string"));
mkdirSync(output, { recursive: true });
const report = { checks: [], errors: [] };
let child, browser, page;
const deadline = (task, message, ms = 20000) => {
  let timer;
  return Promise.race([task, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(message)), ms);
  })]).finally(() => clearTimeout(timer));
};
const invoke = (command, args) => deadline(page.evaluate(
  ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
  { command, args },
), `${command} stalled`);
const pages = () => browser.contexts().flatMap(context => context.pages());
async function launch() {
  let busy = false;
  try { busy = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
  assert.equal(busy, false, "Test port is already in use");
  const log = openSync(join(output, "native.log"), "a");
  child = spawn(resolve(process.argv[2]), [], {
    windowsHide: true,
    stdio: ["ignore", "ignore", log],
    env: { ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
      WEBVIEW2_USER_DATA_FOLDER: join(output, "webview"),
    },
  });
  closeSync(log);
  child.on("error", error => report.errors.push(String(error)));
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; }
    catch { return false; }
  }, { timeout: 20000 }).toBe(true);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  await expect.poll(() => pages().some(p => p.url().startsWith("http://tauri.localhost") && !new URL(p.url()).searchParams.has("window")), { timeout: 20000 }).toBe(true);
  page = pages().find(p => p.url().startsWith("http://tauri.localhost") && !new URL(p.url()).searchParams.has("window"));
  page.on("pageerror", error => report.errors.push(error.message));
  assert.equal((await invoke("application_info")).development, true);
  let backup;
  await expect.poll(async () => {
    try { backup = await invoke("backup_configuration"); return true; }
    catch { return false; }
  }, { timeout: 30000 }).toBe(true);
  assert.ok(resolve(backup).startsWith(`${resolve(process.env.APPDATA, identifier)}${sep}`), "Refusing to mutate a non-isolated app");
}
async function stop() {
  const started = !!child;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    if (page && browser) void invoke("quit_application").catch(() => {});
    try { await deadline(exited, "Isolated app did not stop", 10000); }
    catch (error) { child.kill(); throw error; }
  }
  if (browser) await browser.close();
  browser = null; page = null; child = null;
  if (started) {
    // WebView2 subprocesses can outlive the native process briefly on exit.
    await expect.poll(async () => {
      try { return !(await fetch(`http://127.0.0.1:${port}/json/version`)).ok; }
      catch { return true; }
    }, { timeout: 20000 }).toBe(true);
  }
}
async function images(target, selector) {
  return target.locator(selector).evaluateAll(elements => elements.map(image => {
    if (!image.complete || !image.naturalWidth) return false;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
  }));
}
try {
  await launch();
  const settings = await invoke("get_settings");
  await invoke("update_settings", { settings: { ...settings, enabled: false } });
  const snapshot = await invoke("rail_get");
  const groupId = snapshot.settings.groups[0].id;
  await invoke("rail_change", { change: { type: "enable", enabled: false } });
  // Clear only references from the isolated test config, never their files.
  for (const group of snapshot.settings.groups) for (const item of group.items)
    await invoke("rail_change", { change: { type: "remove", id: item.id } });
  await invoke("rail_add_paths", { groupId, paths, replaceId: null });
  const enabled = await invoke("rail_change", { change: { type: "enable", enabled: true } });
  for (let round = 1; round <= 3; round++) {
    await stop();
    await launch();
    await expect.poll(() => pages().some(p => p.url().includes(`window=rail&group=${groupId}`)), { timeout: 20000 }).toBe(true);
    const rail = pages().find(p => p.url().includes(`window=rail&group=${groupId}`));
    await expect.poll(() => images(page, ".rail-layer .rail-item-media img"), { timeout: 15000 }).toEqual(paths.map(() => true));
    await expect.poll(() => images(rail, ".rail-item-media img"), { timeout: 15000 }).toEqual(paths.map(() => true));
    assert.deepEqual((await invoke("rail_get")).settings, enabled.settings, "Restart changed the saved layout");
    await page.locator(".rail-layer").screenshot({ path: join(output, `preview-${round}.png`) });
    report.checks.push(`Restart ${round}: ${paths.length} visible icons in both workspace preview and desktop, saved layout preserved`);
    console.log(report.checks.at(-1));
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error);
  process.exitCode = 1;
} finally {
  try { await stop(); } catch (error) { report.errors.push(String(error)); process.exitCode = 1; }
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
