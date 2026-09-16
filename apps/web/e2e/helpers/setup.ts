import { expect, type Page } from "@playwright/test";

// Exercise the real onboarding flow; shared fixtures explicitly choose unknown body data.
export async function completeSetup(page: Page) {
  await expect(page).toHaveURL(/\/(today|settings\/setup)$/);
  if (new URL(page.url()).pathname === "/today") return;
  for (let step = 0; step < 4; step++) {
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(/^(基础资料|身体数据|目标方向|提醒)$/);
    const title = await heading.textContent();
    if (title === "身体数据") await page.getByLabel("暂时没有测量值，之后再记录").check();
    if (title === "提醒") { await page.getByRole("button", { name: "跳过提醒，完成设置" }).click(); break; }
    const oldTitle = title;
    await page.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(heading).not.toHaveText(oldTitle ?? "");
  }
  await expect(page).toHaveURL(/\/today$/);
}
