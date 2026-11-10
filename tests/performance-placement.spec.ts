import { settingsSection } from "./helpers/module-settings";
import { expect, test } from "@playwright/test";

test("score entry belongs to preview tools and mapping belongs to the selected scene appearance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "soundspectra.settings.v1",
      JSON.stringify({
        version: 1,
        effect: "tidal_knot",
        quality: "eco",
        regionVisible: false,
      }),
    ),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "演出编排", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".preview-title-actions")
      .getByRole("button", { name: "演出编排", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".inspector .performance-panel")).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "音乐映射预设" }),
  ).toHaveCount(0);
  await settingsSection(page, "外观");
  await expect(
    page.locator(".inspector").getByRole("combobox", { name: "音乐映射预设" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: "音乐映射预设" }).click();
  await page
    .getByRole("option", { name: "低频推动局部展开", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("soundspectra.performance.v1")!)
            .mappings["primary--tidal_knot"].target,
      ),
    )
    .toBe("unfold");
  await settingsSection(page, "动效");
  await page.getByRole("button", { name: "演出编排", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("时间编排怎么用？", { exact: true }).click();
  await expect(dialog.getByText("安排画面", { exact: true })).toBeVisible();
  await dialog.getByText("时间编排怎么用？", { exact: true }).click();
  await expect(
    dialog.getByRole("tab", { name: "时间编排", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "载入原创示例", exact: true })
    .click();
  await expect(dialog.getByRole("listitem")).toHaveCount(7);
  await expect(
    dialog.getByRole("button", { name: "播放预演", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("slider", { name: "预演播放头", exact: true }),
  ).toBeInViewport();
  await expect(dialog.getByRole("listitem").last()).toBeInViewport();
  await expect(
    dialog.getByRole("region", { name: "所选标记属性" }),
  ).toHaveCount(1);
  await expect(
    dialog.getByRole("button", { name: "绑定当前曲目", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "开启演出模式", exact: true })
    .locator("..")
    .hover();
  await expect(page.getByRole("tooltip")).toContainText(
    "请在播放器播放歌曲，等待应用识别",
  );
  await dialog.getByRole("heading").first().hover();
  await dialog
    .getByRole("listitem", { name: "选择标记 2：粒子散入层海", exact: true })
    .click();
  await expect(dialog.locator(".performance-preview output")).toHaveText(
    "7.0 / 36 s",
  );
  await expect(dialog.locator("canvas")).toHaveAttribute(
    "data-scene",
    "layered_tides",
  );
  await dialog
    .getByRole("combobox", { name: "标记 2 灯效", exact: true })
    .click();
  await page.getByRole("option", { name: "回声廊道", exact: true }).click();
  await expect(dialog.locator("canvas")).toHaveAttribute(
    "data-scene",
    "echo_corridor",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("soundspectra.performance.v1")!)
            .shows[0].cues[1].action.snapshot.effect,
      ),
    )
    .toBe("echo_corridor");
  for (const [width, height] of [
    [1440, 940],
    [1000, 720],
    [760, 620],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(async () => {
      const geometry = await dialog.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          f = el
            .querySelector(".performance-workspace-footer")!
            .getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          footerBottom: f.bottom,
          overflow: el.scrollWidth - el.clientWidth,
        };
      });
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.y).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.bottom).toBeLessThanOrEqual(height);
      expect(geometry.footerBottom).toBeLessThanOrEqual(height);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      if (width <= 700) {
        const sections = await dialog.evaluate((el) => ({
          listBottom: el
            .querySelector(".performance-score")!
            .getBoundingClientRect().bottom,
          previewTop: el
            .querySelector(".performance-rehearsal")!
            .getBoundingClientRect().top,
        }));
        expect(sections.previewTop).toBeGreaterThanOrEqual(
          sections.listBottom - 1,
        );
      }
    }).toPass();
  }
  await page.setViewportSize({ width: 1440, height: 940 });
  await dialog.getByRole("tab", { name: "切换转场", exact: true }).click();
  await expect(
    dialog.getByRole("group", { name: "默认转场" }).getByRole("button"),
  ).toHaveCount(3);
  await dialog.getByRole("button", { name: /镜头穿越/ }).click();
  await expect(
    dialog.getByRole("button", { name: /镜头穿越/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "关闭演出编排", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settingsSection(page, "外观");
  await expect(
    page.getByRole("combobox", { name: "音乐映射预设" }),
  ).toContainText("低频推动局部展开");
});

test("the compact score layout creates and edits markers while keeping transport reachable", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "soundspectra.settings.v1",
      JSON.stringify({ quality: "eco", regionVisible: false }),
    ),
  );
  await page.setViewportSize({ width: 1440, height: 940 });
  await page.goto("/");
  await page.getByRole("button", { name: "演出编排", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "载入原创示例", exact: true })
    .click();
  await expect(
    dialog.getByRole("spinbutton", { name: "新标记时间", exact: true }),
  ).toBeHidden();
  await dialog.getByText("添加时间标记", { exact: true }).click();
  await dialog
    .getByRole("spinbutton", { name: "新标记时间", exact: true })
    .fill("39");
  await dialog
    .getByRole("combobox", { name: "新标记动作", exact: true })
    .click();
  await page.getByRole("option", { name: "一次受控运镜", exact: true }).click();
  await dialog.getByRole("button", { name: "新增标记", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(8);
  await expect(
    dialog.getByRole("spinbutton", { name: "标记 8 时间（秒）", exact: true }),
  ).toHaveValue("39");
  await expect(
    dialog.getByRole("spinbutton", { name: "新标记时间", exact: true }),
  ).toBeHidden();
  await dialog
    .getByRole("spinbutton", { name: "标记 8 侧转角度", exact: true })
    .fill("20");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("soundspectra.performance.v1")!,
          ).shows[0].cues.at(-1).action.yaw,
      ),
    )
    .toBe(20);
  const time = dialog.getByRole("spinbutton", {
    name: "标记 8 时间（秒）",
    exact: true,
  });
  await time.fill("179.94");
  await expect(dialog.getByRole("listitem").last().locator("time")).toHaveText(
    "02:59.9",
  );
  await time.fill("179.999");
  await expect(dialog.getByRole("listitem").last().locator("time")).toHaveText(
    "03:00.0",
  );
  await expect(
    dialog.getByRole("button", { name: "播放预演", exact: true }),
  ).toBeInViewport();
  await dialog.getByRole("button", { name: "删除标记 8", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(7);
  await page.reload();
  await page.getByRole("button", { name: "演出编排", exact: true }).click();
  await expect(dialog.getByRole("listitem")).toHaveCount(7);
});
