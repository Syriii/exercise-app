import { expect, test, type Page } from "@playwright/test";

const applicationRoutes = ["/today", "/training", "/nutrition", "/history", "/settings", "/settings/profile", "/settings/measurement", "/settings/strategy", "/settings/reminders", "/settings/data", "/feedback", "/admin"] as const;
const viewportWidths = [320, 375, 414, 768, 960, 1440] as const;

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("desktop_admin");
  await page.getByLabel("密码").fill("operations test password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL(/\/today$/);
}

async function expectStableLayout(page: Page, route: string, width: number) {
  const result = await page.evaluate(() => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const rectangle = (selector: string) => document.querySelector<HTMLElement>(selector)?.getBoundingClientRect() ?? null;
    const main = rectangle(".app-main");
    const dock = rectangle(".mobile-dock");
    const siblingPanels = Array.from(document.querySelectorAll(".view-stack > section")).filter(visible);
    const panelOverlap = siblingPanels.some((element, index) => {
      const first = element.getBoundingClientRect();
      return siblingPanels.slice(index + 1).some((candidate) => {
        const second = candidate.getBoundingClientRect();
        return first.left < second.right - 1 && first.right > second.left + 1 && first.top < second.bottom - 1 && first.bottom > second.top + 1;
      });
    });
    const undersizedControls = Array.from(document.querySelectorAll("button, input, select, textarea"))
      .filter(visible)
      .filter((element) => !(element instanceof HTMLInputElement && ["checkbox", "radio", "file", "hidden"].includes(element.type)))
      .map((element) => ({
        label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? element.tagName,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      }))
      .filter((control) => control.height < 43.5 || control.width < 43.5);
    const undersizedText = Array.from(document.querySelectorAll("p, small, label, dt, .status-chip, .dock-button strong, .nav-button small"))
      .filter(visible)
      .map((element) => ({ text: element.textContent?.trim().slice(0, 40) ?? "", size: Number.parseFloat(getComputedStyle(element).fontSize) }))
      .filter((item) => item.size < 13.9);

    return {
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      dockOverlapsMain: main !== null && dock !== null && getComputedStyle(document.querySelector<HTMLElement>(".mobile-dock")!).display !== "none"
        ? main.bottom > dock.top + 1
        : false,
      dockOutsideViewport: dock !== null && dock.bottom > window.innerHeight + 1,
      panelOverlap,
      undersizedControls,
      undersizedText,
    };
  });

  expect(result.horizontalOverflow, `${route} @ ${width}px has horizontal overflow`).toBeLessThanOrEqual(1);
  expect(result.dockOverlapsMain, `${route} @ ${width}px mobile navigation covers main`).toBe(false);
  expect(result.dockOutsideViewport, `${route} @ ${width}px mobile navigation leaves viewport`).toBe(false);
  expect(result.panelOverlap, `${route} @ ${width}px sibling panels overlap`).toBe(false);
  expect(result.undersizedControls, `${route} @ ${width}px has controls below 44px`).toEqual([]);
  expect(result.undersizedText, `${route} @ ${width}px has text below 14px`).toEqual([]);
}

test("main pages stay readable and non-overlapping across supported widths", async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestFailures: string[] = [];
  const serverFailures: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.method()} ${request.url()}`));
  page.on("response", (response) => { if (response.status() >= 500) serverFailures.push(`${response.status()} ${response.url()}`); });

  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.locator("h1").first()).toBeVisible();
    await expectStableLayout(page, "/login", width);
  }
  await login(page);
  // The anonymous /auth/me probe intentionally returns 401 on the login page;
  // authenticated application pages must remain free of console errors.
  consoleErrors.splice(0);
  for (const width of viewportWidths) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of applicationRoutes) {
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectStableLayout(page, route, width);
    }
  }

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(requestFailures).toEqual([]);
  expect(serverFailures).toEqual([]);
});
