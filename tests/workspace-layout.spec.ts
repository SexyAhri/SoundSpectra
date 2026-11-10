import { openDetails, settingsSection } from "./helpers/module-settings";
import { expect, test } from "@playwright/test";
import { defaults } from "../src/features/spectrum/model";

const stored = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("soundspectra.settings.v1")!),
  );

test("global editors have their own scope and preserve the selected effect region", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/");
  await page.getByLabel("添加装饰区域", { exact: true }).click();
  await settingsSection(page, "外观");
  const before = await stored(page);
  await page.getByRole("button", { name: "歌词", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "当前装饰区域" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "显示桌面音乐卡片" }),
  ).toHaveCount(0);
  await page.getByRole("switch", { name: "显示桌面歌词" }).click();
  await expect(
    page.getByText("已保存到此浏览器", { exact: true }),
  ).toBeVisible();
  expect((await stored(page)).regions).toEqual(before.regions);
  await page.getByRole("button", { name: "音乐卡片", exact: true }).click();
  await expect(page.getByRole("switch", { name: "显示桌面歌词" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("switch", { name: "显示桌面音乐卡片" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "壁纸", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: "局部音乐微光", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "当前装饰区域" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "灯效", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "当前装饰区域" }),
  ).toContainText("区域 2");
  await expect(
    page.getByRole("region", { name: "画面与配色", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "歌词", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "歌词", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("switch", { name: "显示桌面歌词" }),
  ).toBeChecked();
});

test("preview and transport stay visible while each inspector scrolls independently", async ({
  page,
}) => {
  // Layout assertions do not need a 60 fps high-resolution scene. Keep a real
  // renderer while avoiding software-GPU saturation during repeated CI resizes.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    (settings) =>
      localStorage.setItem(
        "soundspectra.settings.v1",
        JSON.stringify(settings),
      ),
    {
      ...defaults,
      effect: "dream_stars",
      quality: "eco",
      sceneMode: "immersive",
      opacity: 100,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      lyrics: { ...defaults.lyrics, enabled: true },
    },
  );
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/");
  await expect
    .poll(() =>
      page
        .locator(".three-scene-surface canvas")
        .first()
        .getAttribute("data-frames"),
    )
    .not.toBeNull();
  // Check layout with an idle preview after verifying the real renderer starts.
  // Continuous animation and screenshots have their own rendering/capture suites.
  await page.getByRole("switch", { name: "模拟预览", exact: true }).uncheck();
  await expect(
    page.locator(".three-scene-surface canvas").first(),
  ).toHaveAttribute("data-rms", "0.0000");
  for (const [width, height] of [
    [1440, 940],
    [1000, 620],
    [900, 620],
  ]) {
    await page.setViewportSize({ width, height });
    for (const name of ["灯效", "歌词", "音乐卡片", "壁纸"]) {
      await page.getByRole("button", { name, exact: true }).click();
      if (name === "歌词") {
        await openDetails(page, "位置与高级设置");
        await page
          .getByRole("button", { name: "恢复歌词位置" })
          .scrollIntoViewIfNeeded();
      }
      if (name === "音乐卡片") {
        await openDetails(page, "精确位置");
        await page
          .getByRole("button", { name: "恢复卡片位置" })
          .scrollIntoViewIfNeeded();
      }
      // Changing wallpaper controls can change the footer height. Wait for the
      // ResizeObserver measurement and React layout to agree before asserting.
      await expect(async () => {
        const geometry = await page.evaluate(() => {
          const main = document.querySelector(".main-pane")!,
            footer = document
              .querySelector(".workspace-footer")!
              .getBoundingClientRect();
          const preview = document
            .querySelector(".desktop-preview")!
            .getBoundingClientRect();
          const holder = document
            .querySelector(".preview-stage-holder")!
            .getBoundingClientRect();
          return {
            documentHeight: document.documentElement.scrollHeight,
            documentWidth: document.documentElement.scrollWidth,
            mainHeight: main.clientHeight,
            mainScroll: main.scrollHeight,
            footerBottom: footer.bottom,
            previewTop: preview.top,
            previewBottom: preview.bottom,
            previewWidth: preview.width,
            previewHeight: preview.height,
            holderWidth: holder.width,
            holderHeight: holder.height,
          };
        });
        expect(geometry.documentHeight).toBeLessThanOrEqual(height);
        expect(geometry.documentWidth).toBeLessThanOrEqual(width);
        expect(geometry.mainScroll).toBeLessThanOrEqual(geometry.mainHeight);
        expect(geometry.footerBottom).toBeLessThanOrEqual(height);
        expect(geometry.previewBottom).toBeLessThanOrEqual(height - 60);
        expect(geometry.previewTop).toBeGreaterThan(54);
        // Wrapped toolbars and transport can make height the limiting dimension.
        // The preview should use the available holder without overflowing it.
        expect(geometry.previewWidth).toBeGreaterThan(300);
        expect(geometry.previewWidth).toBeLessThanOrEqual(
          geometry.holderWidth + 1,
        );
        expect(geometry.previewHeight).toBeLessThanOrEqual(
          geometry.holderHeight + 1,
        );
        expect(
          Math.min(
            Math.abs(geometry.holderWidth - geometry.previewWidth),
            Math.abs(geometry.holderHeight - geometry.previewHeight),
          ),
        ).toBeLessThan(2);
      }).toPass({ timeout: 5000 });
    }
  }
  await page.getByRole("button", { name: "歌词", exact: true }).click();
  expect(
    await page.locator(".inspector-scroll").evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(0);
  await expect(
    page
      .locator("details")
      .filter({
        has: page
          .locator("summary")
          .getByText("位置与高级设置", { exact: true }),
      }),
  ).toHaveAttribute("open", "");
});
