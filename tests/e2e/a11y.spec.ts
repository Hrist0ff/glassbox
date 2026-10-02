import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/", "/demo/raft-leader-election?step=4", "/demo/binary-search?step=5", "/learn", "/learn/http", "/learn/kafka#replication"]) {
  test(`no automatically detectable WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForTimeout(1200); // let entry animations settle
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`);
    expect(summary).toEqual([]);
  });
}
