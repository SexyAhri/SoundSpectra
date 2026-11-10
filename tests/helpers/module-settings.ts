import { expect, type Page } from "@playwright/test";

export async function openDetails(page: Page, label: string) {
  if (label === "位置与高级设置")
    await page.getByRole("tab", { name: "同步与位置", exact: true }).click();
  const details = page
    .locator("details")
    .filter({
      has: page
        .locator("summary")
        .filter({ hasText: new RegExp(`^${label}$`) }),
    })
    .last();
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator(":scope > summary").click();
}

export async function settingsSection(page: Page, section: string) {
  await page.getByRole("tab", { name: section, exact: true }).click();
  if (section === "位置") await openDetails(page, "三维视角");
  if (section === "外观") await openDetails(page, "音乐响应映射");
}

export async function chooseStyle(page: Page, module: string, name: string) {
  if (module === "灯效" || module === "歌词编排")
    await page.getByRole("tab", { name: "动效", exact: true }).click();
  await page
    .getByRole("button", { name: `更换${module}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function railSection(page: Page, section: string) {
  const close = page.getByRole("button", { name: "关闭添加挂件", exact: true });
  if (await close.count()) await close.click();
  await page
    .getByRole("tab", {
      name: section === "布局" ? "位置" : "挂件",
      exact: true,
    })
    .click();
  if (section === "添加")
    await page.getByRole("button", { name: "添加挂件", exact: true }).click();
  else if (section === "布局") {
    await openDetails(page, "精确位置");
  } else
    await page
      .getByRole("region", { name: "挂件管理", exact: true })
      .scrollIntoViewIfNeeded();
}
