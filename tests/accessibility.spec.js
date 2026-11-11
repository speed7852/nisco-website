import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("homepage has no critical or serious WCAG 2A/AA violations", async ({ page }) => {
  await page.goto("/");
  // Reveal-on-scroll elements are intentionally animated into view. Make all
  // content visible so axe measures the real foreground/background contrast,
  // rather than treating transparent pre-animation content as rendered text.
  await page.evaluate(() => {
    document.querySelectorAll(".reveal").forEach(element => element.classList.add("is-visible"));
  });
  await page.waitForTimeout(900);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter(v => ["critical", "serious"].includes(v.impact));
  expect(blocking.map(v => ({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
});
