import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("homepage has no critical or serious WCAG 2A/AA violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter(v => ["critical", "serious"].includes(v.impact));
  expect(blocking.map(v => ({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
});
