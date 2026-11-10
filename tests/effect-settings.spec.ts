import { test, expect, type Page } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";
import { musicEffects } from "../src/features/spectrum/music-engine/catalog";
import {
  chooseStyle,
  openDetails,
  settingsSection,
} from "./helpers/module-settings";

const stored = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("soundspectra.settings.v1")!),
  );
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    (settings) => {
      if (!localStorage.getItem("soundspectra.settings.v1"))
        localStorage.setItem(
          "soundspectra.settings.v1",
          JSON.stringify(settings),
        );
    },
    { ...defaults, regionVisible: false, quality: "eco" },
  );
  await page.goto("/");
  await expect(
    page.getByText("已保存到此浏览器", { exact: true }),
  ).toBeVisible();
});

test("style search and cancellation preserve settings; selection applies and returns focus", async ({
  page,
}) => {
  const before = await stored(page);
  const trigger = page.getByRole("button", { name: "更换灯效", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await trigger.click();
  const options = page.getByRole("group", { name: "灯效选项", exact: true });
  await expect(options.getByRole("button")).toHaveCount(musicEffects.length);
  await page
    .getByRole("group", { name: "灯效分类", exact: true })
    .getByRole("button", { name: "星空与穿行", exact: true })
    .click();
  await expect(options.getByRole("button")).toHaveCount(6);
  await page
    .getByRole("searchbox", { name: "搜索灯效", exact: true })
    .fill("极光");
  await expect(options.getByRole("button")).toHaveCount(1);
  expect(await stored(page)).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await page.getByRole("searchbox").fill("不存在的样式");
  await expect(
    page.getByText("没有找到匹配的样式", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看全部样式", exact: true }).click();
  await expect(options.getByRole("button")).toHaveCount(musicEffects.length);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "极光流域", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect
    .poll(async () => (await stored(page)).effect)
    .toBe("aurora_flow");
  expect((await stored(page)).bounds).toEqual(before.bounds);
  await settingsSection(page, "外观");
  await page
    .getByRole("slider", { name: "不透明度", exact: true })
    .press("ArrowRight");
  await expect
    .poll(async () => (await stored(page)).opacity)
    .toBe(before.opacity + 1);
  await page.reload();
  await expect(
    page.getByRole("slider", { name: "不透明度", exact: true }),
  ).toHaveAttribute("aria-valuenow", String(before.opacity + 1));
  await settingsSection(page, "动效");
  await expect(
    page.getByRole("group", { name: "当前灯效", exact: true }),
  ).toContainText("极光流域");
});

test("a shared settings flow isolates effects and layout for each region", async ({
  page,
}) => {
  await chooseStyle(page, "灯效", "极光流域");
  await page.getByRole("button", { name: "添加装饰区域", exact: true }).click();
  await chooseStyle(page, "灯效", "雪花飘舞");
  await expect
    .poll(async () => (await stored(page)).regions[0].effect)
    .toBe("ripple");
  expect((await stored(page)).effect).toBe("aurora_flow");
  await page.getByRole("tab", { name: "位置", exact: true }).click();
  await page.getByRole("button", { name: "应用居中布局", exact: true }).click();
  await expect
    .poll(async () => (await stored(page)).regions[0].bounds.width)
    .toBe(0.6);
  expect((await stored(page)).bounds).toEqual(defaults.bounds);
  await expect(
    page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: /^三维视角$/ }) }),
  ).not.toHaveAttribute("open");
  await openDetails(page, "三维视角");
  await expect(
    page.getByRole("button", { name: "默认朝向", exact: true }),
  ).toBeVisible();
});

test("lyrics and card share a compact chooser and can be configured while output is off", async ({
  page,
}) => {
  const before = await stored(page);
  for (const [panel, module, style, key, value] of [
    ["歌词", "歌词编排", "折幕字场", "lyrics", "folded"],
    ["音乐卡片", "卡片样式", "简约", "desktopCard", "compact"],
  ]) {
    await page.getByRole("button", { name: panel, exact: true }).click();
    await chooseStyle(page, module, style);
    await expect(
      page.getByRole("group", { name: `当前${module}`, exact: true }),
    ).toContainText(style);
    await expect
      .poll(
        async () =>
          (await stored(page))[key][key === "lyrics" ? "motion" : "variant"],
      )
      .toBe(value);
    expect((await stored(page))[key].enabled).toBe(before[key].enabled);
  }
  await page.getByRole("button", { name: "壁纸", exact: true }).click();
  await page.getByRole("button", { name: "更换壁纸来源", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "自选图片", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect((await stored(page)).wallpaperDepth).toEqual(before.wallpaperDepth);
});

for (const theme of ["light", "dark"])
  test(`${theme} modules and chooser fit short and narrow windows with hidden scrollbars`, async ({
    page,
  }) => {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    for (const [width, height] of [
      [900, 620],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      for (const [panel, module] of [
        ["灯效", "灯效"],
        ["歌词", "歌词编排"],
        ["音乐卡片", "卡片样式"],
        ["壁纸", "壁纸来源"],
        ["拾光绳", "拾光绳皮肤"],
      ]) {
        await page.getByRole("button", { name: panel, exact: true }).click();
        if (panel === "拾光绳")
          await page.getByRole("tab", { name: "外观", exact: true }).click();
        const pane = page.getByRole("complementary", {
          name: "对象属性",
          exact: true,
        });
        const trigger = pane.getByRole("button", {
          name: `更换${module}`,
          exact: true,
        });
        await trigger.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeInViewport({ ratio: 1 });
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        const drawer = (await dialog.boundingBox())!;
        const inspector = (await page
          .locator(".workspace-inspector-container")
          .boundingBox())!;
        expect(drawer.x + drawer.width).toBeCloseTo(width - 12, 0);
        expect(drawer.y).toBeGreaterThanOrEqual(12);
        expect(drawer.y + drawer.height).toBeLessThanOrEqual(height - 12);
        expect(drawer.width).toBeLessThanOrEqual(inspector.width);
        expect(drawer.x).toBeGreaterThanOrEqual(inspector.x);
        await expect(dialog).not.toHaveAttribute("aria-modal", "true");
        await expect(page.locator(".drawer-backdrop")).toHaveCount(0);
        const preview = dialog.locator(".module-option-preview").first();
        const rect = (await preview.boundingBox())!;
        expect(rect.height).toBeGreaterThan(rect.width / 2);
        const options = dialog.locator(".module-style-options"),
          header = dialog.locator("header");
        expect(
          await options.evaluate((el) => getComputedStyle(el).scrollbarWidth),
        ).toBe("none");
        const headerTop = (await header.boundingBox())!.y;
        await options.getByRole("button").last().scrollIntoViewIfNeeded();
        expect((await header.boundingBox())!.y).toBe(headerTop);
        await expect(
          dialog.getByRole("button", {
            name: `关闭${module}选择`,
            exact: true,
          }),
        ).toBeInViewport();
        if (theme === "dark")
          await page.screenshot({
            path: `artifacts/style-drawers/${panel}-${width}.png`,
          });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(trigger).toBeFocused();
        expect(
          await page
            .locator(".inspector-scroll")
            .evaluate((el) => getComputedStyle(el).scrollbarWidth),
        ).toBe("none");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (width > 760) {
          await expect(pane.locator(".inspector-heading")).toBeInViewport();
          await expect(page.locator(".workspace-footer")).toBeInViewport();
        }
      }
    }
  });

test("motion, appearance and position tabs expose distinct controls and support arrow keys", async ({
  page,
}) => {
  const motion = page.getByRole("tab", { name: "动效", exact: true });
  await motion.click();
  await expect(
    page.getByRole("button", { name: "更换灯效", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "造型与光感", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "不透明度", exact: true }),
  ).toHaveCount(0);
  await motion.focus();
  await expect(motion).toHaveCSS("outline-style", "none");
  await expect(motion).toHaveCSS("box-shadow", "none");
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "外观", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("slider", { name: "不透明度", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "更换灯效", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "位置", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("button", { name: "应用居中布局", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("slider", { name: "不透明度", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "位置", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("lyrics card and rail preview hovered and keyboard candidates without applying them", async ({
  page,
}) => {
  for (const [panel, module, option, selector] of [
    ["歌词", "歌词编排", "弧形流转", ".lyric-style-preview-stardust"],
    ["音乐卡片", "卡片样式", "浮签", ".mc-floating"],
    [
      "拾光绳",
      "拾光绳皮肤",
      "秋枝来信",
      '.rail-skin-preview[data-rail-skin="autumn"]',
    ],
  ]) {
    await page.getByRole("button", { name: panel, exact: true }).click();
    if (panel === "拾光绳")
      await page.getByRole("tab", { name: "外观", exact: true }).click();
    await page
      .getByRole("button", { name: `更换${module}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: `选择${module}`,
      exact: true,
    });
    const candidate = dialog.locator(".module-live-candidate");
    await expect(candidate).toBeVisible();
    expect((await candidate.boundingBox())!.height).toBeLessThanOrEqual(128);
    const before = await stored(page);
    const railBefore = await page.evaluate(() =>
      localStorage.getItem("soundspectra.rail.v1"),
    );
    const target = dialog.getByRole("button", { name: option, exact: true });
    await target.hover();
    await expect(candidate.locator(selector)).toBeVisible();
    await target.focus();
    await expect(candidate.locator(selector)).toBeVisible();
    await expect(candidate).toContainText(option);
    expect(await stored(page)).toEqual(before);
    expect(
      await page.evaluate(() => localStorage.getItem("soundspectra.rail.v1")),
    ).toBe(railBefore);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".module-read-preview")).toHaveCount(0);
  }
});

for (const width of [1280, 390]) {
  test(`lyric tabs group controls, support keyboard navigation and remember selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 });
    await page
      .locator(width < 761 ? ".workspace-mobile-nav" : ".sidebar")
      .getByRole("button", { name: "歌词", exact: true })
      .click();
    const tabs = page.getByRole("tablist", { name: "歌词设置分类" });
    await expect(tabs.getByRole("tab")).toHaveCount(3);
    expect(
      (await page.locator(".lyric-controls-status").boundingBox())!.width,
    ).toBe(await page.locator(".module-inspector").evaluate(node => node.clientWidth));
    const motion = tabs.getByRole("tab", { name: "动效", exact: true });
    await expect(motion).toHaveAttribute("aria-selected", "true");
    const before = await stored(page);
    await expect(
      page.getByRole("button", { name: "更换歌词编排" }),
    ).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "歌词字号", exact: true }),
    ).toHaveCount(0);
    await motion.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      tabs.getByRole("tab", { name: "外观", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("slider", { name: "歌词字号", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "更换歌词编排" }),
    ).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(
      tabs.getByRole("tab", { name: "同步与位置", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("slider", { name: "歌词同步偏移", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("slider", { name: "歌词字号", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("switch", { name: "显示桌面歌词", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      tabs.getByRole("tab", { name: "同步与位置", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    expect((await stored(page)).lyrics).toEqual(before.lyrics);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await motion.click();
    await page
      .getByRole("button", { name: "更换歌词编排", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "选择歌词编排" }),
    ).toBeVisible();
    await tabs.getByRole("tab", { name: "外观", exact: true }).press("Enter");
    await expect(
      page.getByRole("dialog", { name: "选择歌词编排" }),
    ).toHaveCount(0);
    expect((await stored(page)).lyrics).toEqual(before.lyrics);
  });
}
