import { expect, test, type Page, type Locator } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { desktopPresets, scenePatch } from "../src/features/preview/desktop-scenes";
import { readFileSync } from "node:fs";

const initial = { ...structuredClone(defaults), ...scenePatch(defaults, desktopPresets[0].scene),
  enabled: false, quality: "eco" as const, opacity: 63,
  lyrics: { ...desktopPresets[1].scene.desktop!.lyrics, folder: "", offsetMs: 0, fontStyle: "modern" as const } };
const records = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("soundspectra.scene-library.v1") ?? "[]"));
async function open(page: Page) {
  await page.getByRole("button", { name: "场景收藏", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function manage(page: Page) {
  await open(page);
  await page.getByRole("button", { name: "管理收藏", exact: true }).click();
}
async function snapshotReady(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(settings => {
    if (!localStorage.getItem("soundspectra.settings.v1"))
      localStorage.setItem("soundspectra.settings.v1", JSON.stringify(settings));
  }, initial);
  await page.goto("/");
  await expect(page.locator(".startup-screen")).toHaveCount(0, { timeout: 10000 });
});

test("saving captures real effects, card and lyrics, persists on reload, and survives delete/undo", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await manage(page);
  await page.getByLabel("收藏名称").fill("窗边的金色夜晚");
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存搭配与画面缩略图", { timeout: 15000 });
  const image = page.locator("[data-thumbnail=snapshot] img");
  await snapshotReady(image);
  const stats = await image.evaluate((node: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = node.naturalWidth; canvas.height = node.naturalHeight;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(node, 0, 0);
    const count = (x: number, y: number, w: number, h: number) => {
      const pixels = ctx.getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height),
        Math.floor(w * canvas.width), Math.floor(h * canvas.height)).data;
      let visible = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 80 || pixels[i + 1] > 80 || pixels[i + 2] > 80) visible++;
      return visible;
    };
    return { width: canvas.width, height: canvas.height, effects: count(.4, .52, .55, .37),
      card: count(.04, .79, .27, .15), lyrics: count(.14, .2, .72, .32), src: node.src };
  });
  expect(stats.width).toBe(640);
  expect(stats.height).toBe(360);
  expect(stats.effects).toBeGreaterThan(20);
  expect(stats.card).toBeGreaterThan(40);
  expect(stats.lyrics).toBeGreaterThan(20);
  await image.screenshot({ path: "artifacts/scene-snapshot-content.png" });
  await page.getByRole("button", { name: "删除所选收藏" }).click();
  await expect(page.locator("[data-thumbnail=snapshot]")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await snapshotReady(image);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".startup-screen")).toHaveCount(0, { timeout: 10000 });
  await open(page);
  await snapshotReady(image);
  expect(await image.getAttribute("src")).toBe(stats.src);
  const item = (await records(page))[0];
  expect(item).not.toHaveProperty("thumbnail");
  expect(item.scene.opacity).toBe(63);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/scene-snapshot-gallery.png" });
});

test("save current captures current settings while a different scene is selected", async ({ page }) => {
  await manage(page);
  await page.getByRole("button", { name: /清浅专注/ }).click();
  await page.getByLabel("收藏名称").fill("当前的金色搭配");
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存搭配与画面缩略图", { timeout: 15000 });
  expect((await records(page))[0].scene.effect).toBe(initial.effect);
  expect((await records(page))[0].scene.opacity).toBe(63);
  await snapshotReady(page.locator("[data-thumbnail=snapshot] img"));
});

test("save as captures the selected scene while comparison displays current settings", async ({ page }) => {
  await manage(page);
  await page.getByRole("button", { name: /清浅专注/ }).click();
  await page.getByRole("button", { name: "对比当前搭配", exact: true }).click();
  await expect(page.locator(".scene-preview-compare")).toContainText("当前工作台");
  await page.getByLabel("收藏名称").fill("收藏安静时刻");
  await page.getByRole("button", { name: "另存为", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存搭配与画面缩略图", { timeout: 15000 });
  expect((await records(page))[0].scene.regionVisible).toBe(false);
  await snapshotReady(page.locator("[data-thumbnail=snapshot] img"));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("soundspectra.settings.v1")!).opacity)).toBe(63);
});

for (const failure of ["capture", "storage", "write"]) {
  test(`${failure} failure saves the scene and leaves layout fallback available`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await manage(page);
    await page.evaluate(failure => {
      if (failure === "capture") {
        HTMLCanvasElement.prototype.toBlob = () => { throw Error("capture unavailable"); };
      } else if (failure === "write") {
        const original = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function(value, key) {
          if (this.name === "snapshots") throw new DOMException("quota exhausted", "QuotaExceededError");
          return original.call(this, value, key);
        };
      } else {
        const original = indexedDB.open.bind(indexedDB);
        indexedDB.open = ((name: string, version?: number) => {
          if (name === "soundspectra-scene-snapshots") throw Error("storage unavailable");
          return original(name, version);
        }) as typeof indexedDB.open;
      }
    }, failure);
    await page.getByLabel("收藏名称").fill("依然保存搭配");
    await page.getByRole("button", { name: "保存当前", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("搭配已保存，画面快照暂不可用", { timeout: 15000 });
    await expect(page.getByRole("button", { name: "保存当前", exact: true })).toBeEnabled();
    expect((await records(page))[0].scene.opacity).toBe(63);
    await page.getByRole("button", { name: "返回选景", exact: true }).click();
    await expect(page.locator("[data-thumbnail=layout]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "应用此场景", exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

test("collection write failure keeps the draft available and retry creates one scene", async ({ page }) => {
  await manage(page);
  await page.getByLabel("收藏名称").fill("保存失败后重试");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "soundspectra.scene-library.v1" && !(window as any).allowSceneWrite) throw Error("收藏写入失败");
      return original.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("收藏写入失败", { timeout: 15000 });
  expect(await records(page)).toEqual([]);
  await expect(page.getByLabel("收藏名称")).toHaveValue("保存失败后重试");
  await page.evaluate(() => { (window as any).allowSceneWrite = true; });
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存搭配与画面缩略图", { timeout: 15000 });
  expect(await records(page)).toHaveLength(1);
});

test("replacing a scene cannot display a snapshot from a different revision", async ({ page }) => {
  await manage(page);
  await page.getByLabel("收藏名称").fill("有版本的搭配");
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存搭配与画面缩略图", { timeout: 15000 });
  await snapshotReady(page.locator("[data-thumbnail=snapshot] img"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const items = JSON.parse(localStorage.getItem("soundspectra.scene-library.v1")!);
    items[0].scene.color = "#bb33ff";
    items[0].updated++;
    localStorage.setItem("soundspectra.scene-library.v1", JSON.stringify(items));
  });
  await open(page);
  await expect(page.locator("[data-thumbnail=layout]")).toHaveCount(1);
  await expect(page.locator("[data-thumbnail=snapshot]")).toHaveCount(0);
});

test("snapshots work under the desktop resource policy and fit both themes and narrow windows", async ({ page }) => {
  const policy = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app.security.csp;
  const violations: string[] = [];
  page.on("console", message => {
    if (message.type() === "error" && /Content Security Policy|violates.*directive/i.test(message.text()))
      violations.push(message.text());
  });
  await page.route("**/*", async route => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
  await page.reload();
  await expect(page.locator(".startup-screen")).toHaveCount(0, { timeout: 10000 });
  await manage(page);
  await page.getByLabel("收藏名称").fill("桌面画面快照");
  await page.getByRole("button", { name: "保存当前", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存搭配与画面缩略图", { timeout: 15000 });
  await page.getByRole("button", { name: "返回选景", exact: true }).click();
  await snapshotReady(page.locator("[data-thumbnail=snapshot] img"));
  for (const theme of ["dark", "light"]) {
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.classList.toggle("dark", theme === "dark");
    }, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 740 });
      const card = page.locator(".scene-gallery-card");
      await card.scrollIntoViewIfNeeded();
      expect(await card.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.getByRole("dialog").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await expect(page.getByRole("button", { name: "应用此场景", exact: true })).toBeInViewport();
      await page.screenshot({ path: `artifacts/scene-snapshot-${theme}-${width}.png` });
    }
  }
  expect(violations).toEqual([]);
});
