import { test, expect } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (settings) =>
      localStorage.setItem(
        "soundspectra.settings.v1",
        JSON.stringify(settings),
      ),
    { ...defaults, regionVisible: false, quality: "eco" },
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("inspector resizes with the keyboard and remembers collapse and width", async ({
  page,
}) => {
  await page.goto("/#scene");
  // Keyboard input cannot reach the workspace while the startup cover owns it.
  await expect(page.locator(".app-shell")).not.toHaveAttribute("inert", "", {
    timeout: 15000,
  });
  const handle = page.getByRole("separator", { name: "属性栏宽度" });
  await handle.focus();
  await handle.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await page.getByRole("button", { name: "收起属性栏" }).click();
  await expect(
    page.getByRole("complementary", { name: "对象属性" }),
  ).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "展开属性栏" }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  await handle.dblclick();
  await expect(handle).toHaveAttribute("aria-valuenow", "380");
});

test("precise values round to the step, clamp, cancel and reset once", async ({
  page,
}) => {
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {Parameter} from '/src/components/ui/parameter.tsx';
    window.commits=[];
    function Probe(){const [value,setValue]=React.useState(.25); return React.createElement(Parameter,{label:'精度',value,min:-1,max:1,step:.05,unit:' s',defaultValue:.25,onChange:setValue,onCommit:v=>window.commits.push(v)})}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Probe));
  `,
    }),
  );
  await page.goto("/#scene");
  const edit = page.getByRole("button", { name: "编辑精度数值" });
  const input = page.getByRole("spinbutton", { name: "精度精确值" });
  await edit.click();
  await input.fill("-0.23");
  await input.press("Enter");
  await expect(page.getByRole("slider")).toHaveAttribute(
    "aria-valuenow",
    "-0.25",
  );
  await edit.click();
  await input.fill("8");
  await input.press("Enter");
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", "1");
  await edit.click();
  await input.fill("0");
  await input.press("Escape");
  await expect(edit).toBeFocused();
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", "1");
  await edit.click();
  await input.fill("");
  await input.press("Enter");
  await expect(page.getByRole("slider")).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "还原精度" }).click();
  expect(await page.evaluate(() => (window as any).commits)).toEqual([
    -0.25, 1, 0.25,
  ]);
});

test("preview position locks block keyboard movement and restore after reload", async ({
  page,
}) => {
  await page.goto("/#scene");
  await page.getByRole("button", { name: "布置", exact: true }).click();
  await page.getByText("对象与图层", { exact: false }).click();
  const firstLock = page.getByRole("button", {
    name: "锁定主区域位置",
    exact: true,
  });
  await expect(firstLock).toBeVisible();
  const name = (await firstLock.getAttribute("aria-label"))!;
  await firstLock.click();
  const region = page.locator('[data-preview-object="effect:primary"]');
  const before = await page.evaluate(
    () => JSON.parse(localStorage.getItem("soundspectra.settings.v1")!).bounds,
  );
  await region.focus();
  await region.press("ArrowRight");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("soundspectra.settings.v1")!).bounds,
    ),
  ).toEqual(before);
  await page
    .getByRole("button", { name: name.replace("锁定", "解锁"), exact: true })
    .click();
  await region.focus();
  await region.press("ArrowRight");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("soundspectra.settings.v1")!).bounds
            .x,
      ),
    )
    .not.toBe(before.x);
  await page.getByRole("button", { name, exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "布置", exact: true }).click();
  await page.getByText("对象与图层", { exact: false }).click();
  await expect(
    page.getByRole("button", {
      name: name.replace("锁定", "解锁"),
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("wallpaper guides can be removed for a clean composition preview", async ({
  page,
}) => {
  await page.goto("/#wallpaper");
  await expect(page.getByLabel("壁纸构图辅助")).toBeVisible();
  await page.getByRole("button", { name: "完成构图", exact: true }).click();
  await expect(page.getByLabel("壁纸构图辅助")).toHaveCount(0);
  await page.getByRole("button", { name: "显示构图辅助", exact: true }).click();
  await expect(page.getByLabel("壁纸构图辅助")).toBeVisible();
});

test("preview actions remain visible as borderless icons with hover and keyboard hints", async ({ page }) => {
  await page.goto("/#wallpaper");
  const toolbar = page.locator(".preview-section > .section-toolbar");
  const before = await toolbar.boundingBox();
  for (const name of ["自动搭配", "场景收藏", "演出编排", "完成构图", "布置", "遮罩", "放大预览"]) {
    const button = toolbar.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toHaveText("");
    await expect(button).toHaveCSS("border-top-width", "0px");
    await button.hover();
    await expect(page.getByRole("tooltip")).toContainText(name);
  }
  const simulation = toolbar.getByRole("switch", { name: "模拟预览" });
  await simulation.click();
  await expect(simulation).toBeChecked();
  await expect(toolbar).not.toContainText(/模拟预览|自动搭配|播放中/);
  expect(await toolbar.boundingBox()).toEqual(before);
  await page.mouse.move(0, 0);
  await page.keyboard.press("Tab");
  const guides = toolbar.getByRole("button", { name: "完成构图", exact: true });
  await expect(guides).toBeFocused();
  await expect(page.getByRole("tooltip")).toContainText("完成构图");
});

test("interface fades preserve modal closing under both system motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#wallpaper");
  await expect(page.locator(".global-inspector-scroll")).toHaveCSS("animation-name", "ui-fade-in");
  await page.getByRole("button", { name: "使用指南", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCSS("animation-name", "ui-fade-in");
  await page.getByRole("button", { name: "关闭工作台工具", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "使用指南", exact: true })).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "使用指南", exact: true }).click();
  await expect(dialog).toHaveCSS("animation-name", "ui-fade-in");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("rapid module navigation keeps the final destination after fading", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#scene");
  await page.getByRole("button", { name: "音乐库", exact: true }).click();
  await page.getByRole("button", { name: "歌词", exact: true }).click();
  await expect(page.getByRole("heading", { name: "歌词动效", exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/#lyrics$/);
  await expect(page.locator(".workspace-inspector-container")).toHaveCSS("opacity", "1");
  await expect(page.locator(".workspace-body")).toHaveCSS("opacity", "1");
});

test("module scrolling and expanded groups survive page switches", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/#lyrics");
  await page.getByRole("tab", { name: "同步与位置", exact: true }).click();
  await page.getByText("位置与高级设置", { exact: true }).click();
  await page
    .getByRole("button", { name: "恢复歌词位置", exact: true })
    .scrollIntoViewIfNeeded();
  const pane = page.locator(".inspector-scroll:visible");
  const tabs = page.getByRole("tablist", { name: "歌词设置分类" });
  const tabTop = (await tabs.boundingBox())!.y;
  // Verify both an interior position and the exact bottom; restoring expanded
  // details used to clamp the latter ten pixels before layout settled.
  for (const target of [80, "bottom"] as const) {
    await pane.evaluate((node, target) => {
      node.scrollTop = target === "bottom" ? node.scrollHeight : target;
    }, target);
    const before = await pane.evaluate((node) => node.scrollTop);
    expect(before).toBeGreaterThan(0);
    expect((await tabs.boundingBox())!.y).toBe(tabTop);
    await page.getByRole("tab", { name: "外观", exact: true }).click();
    await expect(page.getByRole("tab", { name: "外观", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: "同步与位置", exact: true }).click();
    await expect(page.getByRole("tab", { name: "同步与位置", exact: true }))
      .toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => pane.evaluate((node) => node.scrollTop))
      .toBe(before);
    await page.getByRole("button", { name: "音乐卡片", exact: true }).click();
    await expect(page.getByRole("button", { name: "更换卡片样式", exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "歌词", exact: true }).click();
    await expect(
      page.getByRole("tab", { name: "同步与位置", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() => pane.evaluate((node) => node.scrollTop))
      .toBe(before);
  }
  await expect(
    page
      .locator("details")
      .filter({ has: page.getByText("位置与高级设置", { exact: true }) }),
  ).toHaveAttribute("open", "");
});

test("music provider shares one polling loop across consumers and navigation", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => Object.assign(window, { isTauri: true }));
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {MusicProvider,useMusic} from '/src/features/music/use-music.ts';
    import {emptySnapshot} from '/src/features/music/types.ts';
    window.reads=0; window.__TAURI_INTERNALS__={invoke:async command=>{if(command==='music_snapshot'){window.reads++;return structuredClone(emptySnapshot)}}};
    function Consumer(){const {snapshot}=useMusic();return React.createElement('output',null,snapshot.playback.phase)}
    function Probe(){const [full,setFull]=React.useState(true);return React.createElement(React.Fragment,null,React.createElement('button',{onClick:()=>setFull(!full)},'切页'),full?React.createElement('div',null,React.createElement(Consumer),React.createElement(Consumer)):React.createElement(Consumer))}
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(MusicProvider,null,React.createElement(Probe)));
  `,
    }),
  );
  await page.goto("/#scene");
  await expect(page.locator("output")).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).reads)).toBe(1);
  await page.clock.runFor(1301);
  expect(await page.evaluate(() => (window as any).reads)).toBe(3);
  await page.getByRole("button", { name: "切页" }).click();
  await expect(page.locator("output")).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).reads)).toBe(3);
  await page.clock.runFor(650);
  expect(await page.evaluate(() => (window as any).reads)).toBe(4);
});

test("card style previews show the supplied timeline and recover from a broken cover", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-10T00:00:00Z"));
  await page.route("**/src/main.tsx*", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import {CardStylePreview} from '/src/features/desktop-card/card-style-preview.tsx';
    import {emptyNowPlaying} from '/src/features/desktop-card/use-now-playing.ts';
    function Probe(){
      const [info,setInfo]=React.useState({...emptyNowPlaying,title:'当前歌曲',artist:'当前歌手',source:'播放器',duration:260,position:61,timelineAvailable:true,updated:Date.now(),cover:'data:image/png;base64,broken'});
      window.changePreview=patch=>setInfo(old=>({...old,...patch,updated:Date.now()}));
      return React.createElement(CardStylePreview,{variant:'compact',info});
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Probe));
    `,
    }),
  );
  await page.goto("/#scene");
  await expect(page.locator(".mc-title")).toHaveText("当前歌曲");
  await expect(page.locator(".mc-kicker")).toContainText("已暂停");
  await expect(page.locator(".mc-time")).toHaveText("1:01 / 4:20");
  await expect(page.locator(".mc-original-cover")).toBeVisible();
  await expect(page.locator(".mc-artwork img")).toHaveCount(0);
  await page.evaluate(() =>
    (window as any).changePreview({ position: 125, playing: true }),
  );
  await expect(page.locator(".mc-kicker")).toContainText("播放中");
  await expect(page.locator(".mc-time")).toHaveText("2:05 / 4:20");
  await page.evaluate(() =>
    (window as any).changePreview({ timelineAvailable: false }),
  );
  await expect(page.locator(".mc-time")).toHaveText("—");
  await expect(page.locator(".mc")).toHaveAttribute(
    "data-timeline",
    "unavailable",
  );
});

test("module style panels stay inside their page without blocking preview or moving layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/#scene");
  for (const [module, label] of [
    ["灯效", "灯效"],
    ["歌词", "歌词编排"],
    ["音乐卡片", "卡片样式"],
    ["拾光绳", "拾光绳皮肤"],
    ["壁纸", "壁纸来源"],
  ]) {
    await page
      .locator(".sidebar")
      .getByRole("button", { name: module, exact: true })
      .click();
    if (module === "拾光绳")
      await page.getByRole("tab", { name: "外观", exact: true }).click();
    const trigger = page.getByRole("button", {
      name: `更换${label}`,
      exact: true,
    });
    await trigger.scrollIntoViewIfNeeded();
    const preview = page.locator(".main-pane");
    const before = await preview.boundingBox();
    const footer = await page
      .getByRole("contentinfo", { name: "播放与桌面控制" })
      .boundingBox();
    await trigger.click();
    const panel = page.getByRole("dialog", {
      name: `选择${label}`,
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(panel).not.toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".dialog-backdrop")).toHaveCount(0);
    expect(await preview.boundingBox()).toEqual(before);
    const area = (await page.locator(".workspace-body").boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(area.y);
    expect(box.y + box.height).toBeLessThanOrEqual(footer!.y);
    expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width);
    const inspector = (await page
      .locator(".workspace-inspector-container")
      .boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(inspector.width);
    expect(box.x).toBeGreaterThanOrEqual(inspector.x);
    if (module === "灯效") {
      const candidate = panel.locator(".module-live-candidate");
      expect((await candidate.boundingBox())!.height).toBeLessThanOrEqual(128);
      const categories = panel.getByRole("group", {
        name: "灯效分类",
        exact: true,
      });
      const categoryBox = (await categories.boundingBox())!;
      expect(
        (await candidate.boundingBox())!.y - categoryBox.y - categoryBox.height,
      ).toBeGreaterThanOrEqual(8);
      await expect(panel.locator(".module-option-badges")).toHaveCount(0);
      const card = panel.locator(".module-style-option").first();
      const cardHeight = (await card.boundingBox())!.height;
      const imageHeight = (await card
        .locator(".module-option-preview")
        .boundingBox())!.height;
      expect(cardHeight - imageHeight).toBeLessThanOrEqual(imageHeight);
      const imageBox = (await card
        .locator(".module-option-preview")
        .boundingBox())!;
      const copyBox = (await card
        .locator(".module-option-copy")
        .boundingBox())!;
      expect(copyBox.x).toBeGreaterThan(imageBox.x + imageBox.width);
      expect(copyBox.y).toBeLessThan(imageBox.y + imageBox.height);
      expect(cardHeight).toBeLessThanOrEqual(70);
      await panel
        .getByRole("button", { name: "灯效说明", exact: true })
        .hover();
      await expect(page.getByRole("tooltip")).toContainText(
        "实际负载随粒子数量变化",
      );
      await page.mouse.move(0, 0);
      await expect(page.getByRole("tooltip")).toHaveCount(0);
      const resizer = page.getByRole("separator", { name: "属性栏宽度" });
      await resizer.focus();
      await resizer.press("ArrowRight");
      await expect
        .poll(async () => (await panel.boundingBox())!.width)
        .toBe(336);
    }
    expect(
      await panel.evaluate((node) => node.closest(".workspace-body") !== null),
    ).toBe(true);
    const search = panel.getByRole("searchbox");
    if (await search.count()) {
      await search.focus();
      await expect(search).toHaveCSS("outline-style", "none");
      await expect(search).toHaveCSS("border-width", "0px");
    }
    await preview.click({ position: { x: 5, y: 5 } });
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
  }
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "灯效", exact: true })
    .click();
  await page.getByRole("button", { name: "更换灯效", exact: true }).click();
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "音乐卡片", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "选择灯效", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "更换卡片样式", exact: true }).click();
  const narrow = page.getByRole("dialog", {
    name: "选择卡片样式",
    exact: true,
  });
  await expect(narrow).toBeInViewport({ ratio: 1 });
  await narrow
    .getByRole("button", { name: "关闭卡片样式选择", exact: true })
    .click();
  await expect(narrow).toHaveCount(0);
});
