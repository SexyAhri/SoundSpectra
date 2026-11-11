import { expect, test, type Page } from "@playwright/test";
import { musicWorkspace } from "./helpers/music-workspace";

test.setTimeout(120000);

async function queueWorkspace(page: Page, { count = 24, current = 6, theme = "dark" } = {}) {
  await musicWorkspace(page, theme);
  await page.evaluate(({ count, current }) => {
    const app = window as any;
    const playback = app.__music.playback;
    playback.queue = Array.from({ length: count }, (_, i) => ({
      ...app.__tracks[i % app.__tracks.length], id: `queue-${i}`,
      title: `队列歌曲 ${i + 1}`, artist: i === current + 1 ? "这是一段很长的歌手名称，用于检查省略和操作按钮" : `歌手 ${i + 1}`,
    }));
    Object.assign(playback, { entryIds: playback.queue.map((_: unknown, i: number) => `entry-${i}`), index: current, queueRevision: 2 });
    const original = app.__TAURI_INTERNALS__.invoke;
    app.__TAURI_INTERNALS__.invoke = async (command: string, args: any = {}) => {
      if (command === "music_control" && ["queue-jump", "clear"].includes(args.action)) {
        app.__commands.push({ command, ...args });
        if (args.action === "queue-jump") playback.index = args.value;
        else Object.assign(playback, { queue: [], entryIds: [], index: 0, playing: false, phase: "idle", queueRevision: playback.queueRevision + 1 });
        return;
      }
      if (command !== "music_queue_edit") return original(command, args);
      app.__commands.push({ command, ...args });
      if (app.__queueEditError) throw new Error("队列修改失败，请重试");
      const active = playback.entryIds[playback.index];
      const rows = new Map(playback.entryIds.map((id: string, i: number) => [id, playback.queue[i]]));
      const edit = args.edit;
      const next = edit.action === "reorder" ? edit.entries : edit.action === "clear-played"
        ? playback.entryIds.slice(playback.index)
        : playback.entryIds.filter((id: string) => id === active || !edit.entries.includes(id));
      Object.assign(playback, { entryIds: next, queue: next.map((id: string) => rows.get(id)), index: next.indexOf(active), queueRevision: playback.queueRevision + 1 });
    };
  }, { count, current });
  await expect(page.locator(".library-player").getByText(`队列歌曲 ${current + 1}`, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "播放队列面板" });
  await expect(panel).toBeVisible();
  return panel;
}

for (const theme of ["dark", "light"]) test(`queue prioritizes songs and keeps management reachable in ${theme}`, async ({ page }) => {
  const panel = await queueWorkspace(page, { theme });
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "清空", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: /^上移 / })).toHaveCount(0);
  await expect(panel.locator("[aria-current=true]")).toContainText("当前");
  await expect(panel.locator("[data-row-index='7']")).toContainText("下一首");
  for (const [width, height] of [[1280, 840], [900, 620], [390, 740]]) {
    await page.setViewportSize({ width, height });
    await expect(panel.getByRole("button", { name: "管理播放队列" })).toBeInViewport();
    await expect(panel.getByRole("button", { name: "定位当前歌曲" })).toBeInViewport();
    await panel.getByRole("button", { name: "定位当前歌曲" }).click();
    await expect(panel.locator("[aria-current=true]")).toBeInViewport();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `artifacts/music-queue-${theme}-${width}.png` });
    await panel.getByRole("button", { name: "管理播放队列" }).click();
    await expect(panel.getByRole("button", { name: "清空", exact: true })).toBeInViewport();
    await expect(panel.getByRole("checkbox", { name: "选择 队列歌曲 7", exact: true })).toBeDisabled();
    const geometry = await panel.evaluate((node) => ({
      panelOverflow: node.scrollWidth - node.clientWidth,
      pageOverflowX: document.documentElement.scrollWidth - innerWidth,
      pageOverflowY: document.documentElement.scrollHeight - innerHeight,
    }));
    expect(geometry).toEqual({ panelOverflow: 0, pageOverflowX: 0, pageOverflowY: 0 });
    await page.screenshot({ path: `artifacts/music-queue-manage-${theme}-${width}.png` });
    await panel.getByRole("button", { name: "管理播放队列" }).click();
  }
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("button", { name: "播放队列", exact: true })).toBeFocused();
});

test("long queue locates current song on opening without interrupting manual browsing", async ({ page }) => {
  const panel = await queueWorkspace(page, { count: 480, current: 350 });
  const list = panel.locator(".library-queue-list");
  await expect(panel.getByRole("button", { name: /351 队列歌曲 351/ })).toBeInViewport();
  expect(await panel.locator(".library-queue-row").count()).toBeLessThan(60);
  await list.evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
  await expect(panel.getByRole("button", { name: /^1 队列歌曲 1 / })).toBeInViewport();
  await page.evaluate(() => { (window as any).__music.playback.index = 351; });
  await expect(page.locator(".library-player").getByText("队列歌曲 352", { exact: true })).toBeVisible();
  expect(await list.evaluate((node) => node.scrollTop)).toBe(0);
  await panel.getByRole("button", { name: "定位当前歌曲" }).click();
  await expect(panel.locator("[aria-current=true]")).toBeInViewport();
  await panel.locator("[aria-current=true]").focus();
  await page.keyboard.press("End");
  await expect(panel.getByRole("button", { name: /480 队列歌曲 480/ })).toBeFocused();
  await panel.getByRole("button", { name: "收起面板", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "播放队列", exact: true }).click();
  await expect(panel.getByRole("button", { name: /352 队列歌曲 352/ })).toBeInViewport();
});

test("queue management preserves current entry, ordering, selection and removal failures", async ({ page }) => {
  const panel = await queueWorkspace(page, { count: 12, current: 2 });
  const manage = panel.getByRole("button", { name: "管理播放队列" });
  await manage.click();
  await panel.getByRole("checkbox", { name: "选择 队列歌曲 4", exact: true }).check();
  await panel.getByRole("button", { name: "上移 队列歌曲 4", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__music.playback.entryIds.slice(0, 4))).toEqual(["entry-0", "entry-1", "entry-3", "entry-2"]);
  await expect(panel.getByRole("checkbox", { name: "选择 队列歌曲 4", exact: true })).toBeChecked();
  await page.evaluate(() => { (window as any).__queueEditError = true; });
  await panel.getByRole("button", { name: "移除所选 (1)", exact: true }).click();
  await expect(page.getByText("队列修改失败，请重试", { exact: true }).first()).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "选择 队列歌曲 4", exact: true })).toBeChecked();
  await page.evaluate(() => { (window as any).__queueEditError = false; });
  await panel.getByRole("button", { name: "移除所选 (1)", exact: true }).click();
  await expect(panel.getByRole("checkbox", { name: "选择 队列歌曲 4", exact: true })).toHaveCount(0);
  await expect(panel.locator("[aria-current=true]")).toContainText("队列歌曲 3");
  await panel.getByRole("button", { name: "清除已播放", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__music.playback.index)).toBe(0);
  await expect(panel.getByRole("button", { name: "清除已播放", exact: true })).toBeDisabled();
  await panel.getByRole("checkbox", { name: "选择 队列歌曲 5", exact: true }).check();
  await manage.click();
  await manage.click();
  await expect(panel.getByRole("button", { name: "移除所选 (0)", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "清空", exact: true }).click();
  await expect(panel.getByText("队列为空，选择歌曲开始播放", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "清空", exact: true })).toBeDisabled();
  await manage.click();
  await expect(manage).toBeDisabled();
});

test("song focus reveals removal and shuffled playback does not label an arbitrary next song", async ({ page }) => {
  const panel = await queueWorkspace(page, { current: 1 });
  const song = panel.getByRole("button", { name: /3 队列歌曲 3/ });
  await song.focus();
  const remove = panel.getByRole("button", { name: "从队列移除 队列歌曲 3", exact: true });
  await expect(remove).toHaveCSS("opacity", "1");
  await remove.click();
  await expect(song).toHaveCount(0);
  await page.evaluate(() => { (window as any).__music.playback.mode = "shuffle"; });
  await expect(panel.getByText("下一首", { exact: true })).toHaveCount(0);
  await panel.getByRole("button", { name: /^2 队列歌曲 2 / }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__commands.some((c: any) => c.command === "music_control" && c.action === "queue-jump" && c.value === 1))).toBe(true);
});

test("home uses the same quiet queue and keeps its controls inside the window", async ({ page }) => {
  const panel = await queueWorkspace(page);
  await panel.getByRole("button", { name: "收起面板", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "返回氛围", exact: true }).click();
  for (const [width, height] of [[900, 620], [390, 740]]) {
    await page.setViewportSize({ width, height });
    await page.getByRole("button", { name: "播放队列", exact: true }).click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("checkbox")).toHaveCount(0);
    await expect(panel.locator("[aria-current=true]")).toBeInViewport();
    await panel.getByRole("button", { name: "管理播放队列" }).click();
    await expect(panel.getByRole("button", { name: "清空", exact: true })).toBeInViewport();
    await expect(panel.getByRole("button", { name: "收起面板", exact: true })).toBeInViewport();
    await page.screenshot({ path: `artifacts/music-queue-home-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
});
