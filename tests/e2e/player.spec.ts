import { expect, test, type Page } from "@playwright/test";

/**
 * The story player (components/story/StoryPlayer.tsx), which plays every
 * explanation: bundled demos here, saved and unsaved ones in the live specs,
 * and the hand-written stories under /learn.
 */

const caption = (page: Page) => page.locator("p[aria-live]");
const continueButton = (page: Page) => page.getByRole("button", { name: /^Continue/ });

/** Translate of a drawn node, in stage pixels. */
async function nodeX(page: Page, id: string): Promise<number> {
  const transform = await page.locator(`[data-entity-id="${id}"]`).first().getAttribute("transform");
  return Number(/translate\(([-\d.]+)/.exec(transform ?? "")?.[1]);
}

/** Center of a travelling message, in stage pixels. */
async function messagePosition(page: Page) {
  return page.locator("[data-message]").first().evaluate((el) => {
    const box = (el as SVGGraphicsElement).getBBox();
    const m = (el as SVGGraphicsElement).getCTM()!;
    return { x: m.e + m.a * (box.x + box.width / 2), y: m.f + m.d * (box.y + box.height / 2) };
  });
}

/** Press → (finish, then advance) until the caption matches. */
async function advanceTo(page: Page, text: RegExp) {
  for (let i = 0; i < 80; i++) {
    if (text.test((await caption(page).textContent()) ?? "")) return;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(30);
  }
  throw new Error(`never reached a caption matching ${text}`);
}

test.describe("story player", () => {
  test("opens on a title card and steps through with Continue and the arrow keys", async ({ page }) => {
    await page.goto("/demo/raft-leader-election");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Raft leader election (simplified)");
    await expect(page.getByText("Bundled demo", { exact: true })).toBeVisible();

    await continueButton(page).click();
    await expect(caption(page)).toHaveText(/^How five Raft servers pick a single leader/);
    await continueButton(page).click();
    await expect(caption(page)).toHaveText(/^Five servers start as followers/);
    await expect(page.locator("[data-entity-id^='n-']")).toHaveCount(5);

    await page.keyboard.press("ArrowLeft"); // replays the previous step
    await expect(caption(page)).toHaveText(/^How five Raft servers/);
    await expect(page).toHaveURL(/#explanation$/);
  });

  test("opens the chapter named in the URL hash", async ({ page }) => {
    await page.goto("/learn/kafka#replication");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Replication");
    await page.getByRole("button", { name: "Chapters" }).click();
    await page.getByRole("link", { name: "Broker Failure" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Broker Failure");
    await expect(page).toHaveURL(/#failover$/);
  });

  test("stays consistent under rapid key presses and stops at the end", async ({ page }) => {
    await page.goto("/demo/dns-resolution");
    for (let i = 0; i < 120; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: "Start over" })).toBeVisible();
    await expect(caption(page)).toHaveText(/bundled with the app/);
    // The final scene has exactly the final step's nodes.
    await expect(page.locator("[data-entity-id^='n-']")).toHaveCount(6);
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How DNS finds an address");
  });

  test("glides nodes between positions instead of jumping", async ({ page }) => {
    await page.goto("/demo/binary-search");
    await advanceTo(page, /^Because the list is sorted/); // a note: the scene is still
    await expect(continueButton(page)).toBeVisible();
    const from = await nodeX(page, "n-target");
    await continueButton(page).click(); // next step: the target moves right to the new middle, index 5
    await expect(caption(page)).toHaveText(/^The new range is indices 4 to 6/);
    const samples: number[] = [];
    const deadline = Date.now() + 3500; // lead-in, then the glide, at the default (normal) speed
    while (Date.now() < deadline) {
      samples.push(await nodeX(page, "n-target"));
      await page.waitForTimeout(16);
    }
    const to = samples.at(-1)!;
    expect(to).toBeGreaterThan(from + 50);
    expect(samples.some((x) => x > from + 5 && x < to - 5), "sampled the node mid-move").toBe(true);
  });

  test("sends messages that travel between nodes", async ({ page }) => {
    await page.goto("/demo/raft-leader-election");
    await advanceTo(page, /^S3 sends RequestVote/);
    await expect(page.locator("[data-message]").first()).toBeVisible();
    const a = await messagePosition(page);
    await page.waitForTimeout(250);
    const b = await messagePosition(page);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(5);
  });

  test("plays at a calmer default speed that the reader can change", async ({ page }) => {
    /** Time from pressing Continue until the step has finished and Continue is back. */
    const stepDuration = async () => {
      const started = Date.now();
      await continueButton(page).click();
      await expect(caption(page)).toHaveText(/^S3 sends RequestVote/);
      await expect(continueButton(page)).toBeVisible({ timeout: 15_000 });
      return Date.now() - started;
    };
    await page.goto("/demo/raft-leader-election");
    const speed = page.getByRole("combobox", { name: "Animation speed" });
    await expect(speed).toHaveValue("normal");
    await advanceTo(page, /^Randomized timeouts/); // the caption just before the vote requests
    await expect(continueButton(page)).toBeVisible();
    const normal = await stepDuration();

    await page.keyboard.press("ArrowLeft"); // back to the previous caption, then replay the step faster
    await expect(continueButton(page)).toBeVisible();
    await speed.selectOption("fast");
    const fast = await stepDuration();
    expect(normal).toBeGreaterThan(fast * 1.5);

    await page.reload();
    await expect(page.getByRole("combobox", { name: "Animation speed" })).toHaveValue("fast");
  });

  test("respects reduced motion: finished scenes and still messages", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/demo/raft-leader-election");
    await advanceTo(page, /^S3 sends RequestVote/);
    await expect(continueButton(page)).toBeVisible();
    await expect(page.locator("[data-message]")).toHaveCount(4);
    const a = await messagePosition(page);
    await page.waitForTimeout(500);
    expect(await messagePosition(page)).toEqual(a);
  });

  test("keyboard users can reach Continue and see focus", async ({ page }) => {
    await page.goto("/demo/raft-leader-election");
    const button = continueButton(page);
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(caption(page)).toHaveText(/^How five Raft servers/);
    await expect(button).toBeFocused();
    expect(await button.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });

  test("lays out on a phone without horizontal scrolling @mobile", async ({ page }) => {
    await page.goto("/demo/dns-resolution");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await continueButton(page).click();
    await expect(caption(page)).toHaveText(/^Follow one lookup/);
  });
});

test.describe("demo generation", () => {
  test("opens a bundled fixture through the real streaming endpoint", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("What complex concept should we visualize today?");
    await input.fill("How does DNS resolution work?");
    await page.getByRole("button", { name: /Open demo|Visualize/ }).click();

    const loader = page.getByTestId("generation-loader");
    await expect(loader).toContainText("Local demo mode");
    await expect(loader.getByRole("link", { name: "Open demo explanation →" })).toBeVisible();
    await expect(loader).toContainText("passed the same checks");
    await loader.getByRole("link", { name: "Open demo explanation →" }).click();
    await expect(page).toHaveURL(/\/demo\/dns-resolution$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How DNS finds an address");
  });

  test("explains demo-mode limits for other topics and lets the user edit", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("What complex concept should we visualize today?").fill("Quantum error correction");
    await page.getByRole("button", { name: /Open demo|Visualize/ }).click();
    const alert = page.getByTestId("generation-loader").getByRole("alert");
    await expect(alert).toContainText("This topic doesn't fit the format");
    await alert.getByRole("button", { name: "Edit topic" }).click();
    await expect(page.getByLabel("What complex concept should we visualize today?")).toBeFocused();
  });

  test("validates the topic before sending anything", async ({ page }) => {
    let posted = false;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/generate")) posted = true;
    });
    await page.goto("/");
    await page.getByLabel("What complex concept should we visualize today?").fill("x");
    await page.getByRole("button", { name: /Open demo|Visualize/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Enter at least" })).toHaveText("Enter at least 3 characters.");
    expect(posted).toBe(false);
  });
});

test.describe("api", () => {
  test("rejects malformed requests before streaming", async ({ request }) => {
    const notJson = await request.post("/api/generate", { data: "topic=x", headers: { "Content-Type": "text/plain" } });
    expect(notJson.status()).toBe(415);
    const sneaky = await request.post("/api/generate", { data: "{}", headers: { "Content-Type": "text/plain; application/json" } });
    expect(sneaky.status()).toBe(415);
    const bad = await request.post("/api/generate", { data: { topic: "ok topic" } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_request");
    const big = await request.post("/api/generate", {
      data: { topic: "x".repeat(5000), idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01" },
    });
    expect(big.status()).toBe(413);
    const crossSite = await request.post("/api/generate", {
      data: { topic: "binary search", idempotencyKey: "6a1f2c3e-0b4d-4e5f-8a6b-1c2d3e4f5a01" },
      headers: { Origin: "https://evil.example" },
    });
    expect(crossSite.status()).toBe(403);
  });
});
