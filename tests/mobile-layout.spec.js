import { test, expect } from "@playwright/test";

const widths = [320, 360, 375, 390, 412, 430, 768, 1024, 1366];

for (const width of widths) {
  test(`layout fits viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });
    await page.screenshot({ path: `artifacts/viewport-${width}.png`, fullPage: true });
    const metrics = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll("body *")]
        .map(el => ({ tag: el.tagName, id: el.id, className: typeof el.className === "string" ? el.className : "", right: Math.round(el.getBoundingClientRect().right), left: Math.round(el.getBoundingClientRect().left), width: Math.round(el.getBoundingClientRect().width) }))
        .filter(x => x.right > viewport + 1 || x.left < -1)
        .sort((a, b) => b.right - a.right)
        .slice(0, 12);
      return { viewport, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, offenders };
    });
    expect(metrics.documentWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(width);
    expect(metrics.bodyWidth, JSON.stringify(metrics, null, 2)).toBeLessThanOrEqual(width);
  });
}

test("mobile navigation opens and closes without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  const toggle = page.locator(".menu-toggle");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".main-nav")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
