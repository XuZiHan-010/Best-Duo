import { test, expect } from "./fixtures.js";
import { join, ready, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

test("seat/host state stays in sync, two players can start, and a fifth join is rejected", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "Alice");
  await join(pageB, "Bob");

  // First to ready becomes host — verify the badge lands on seat A for both ends.
  await ready(pageA);
  await expect(pageA.locator(".topbar__seat-dot--host")).toHaveCount(1);
  await expect(pageB.locator(".topbar__seat-dot--host")).toHaveCount(1);
  await expect(pageB.locator(".player-seat--ready")).toHaveCount(1);

  await ready(pageB);
  await expect(pageA.locator(".player-seat--ready")).toHaveCount(2);
  await expect(pageA.locator(".lobby__start")).toBeVisible();
  await expect(pageB.locator(".lobby__start")).toHaveCount(0);

  const contextC = await browser.newContext();
  const contextD = await browser.newContext();
  const pageC = await contextC.newPage();
  const pageD = await contextD.newPage();

  await join(pageC, "Carol");
  await expect(pageA.locator(".player-seat__nick", { hasText: "Carol" })).toBeVisible();

  await join(pageD, "Dave");
  await expect(pageA.locator(".player-seat__nick", { hasText: "Dave" })).toBeVisible();
  await expect(pageA.locator(".player-seat__nick--empty")).toHaveCount(0);

  const contextE = await browser.newContext();
  const pageE = await contextE.newPage();
  await join(pageE, "Erin");
  await expect(pageE.getByRole("alert")).toBeVisible();
  await expect(pageA.locator(".player-seat__nick", { hasText: "Erin" })).toHaveCount(0);
  await Promise.all([contextA, contextB, contextC, contextD, contextE].map((context) => context.close()));
});
