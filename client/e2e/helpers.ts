import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { io as ioClient } from "socket.io-client";

// Keep in sync with the `port` constant in playwright.config.ts.
const SERVER_URL = "http://127.0.0.1:3100";

interface ResetProbeState {
  phase: string;
  seats: { nick: string | null }[];
}

// The app is one global, server-side singleton room — every spec must start
// from a clean "waiting" phase, so call this in a test.beforeEach.
//
// The previous test can leave a hint/turn timer ticking server-side after
// it ends (e.g. race-concurrency never resolves its hint window). That
// timer's own room:state broadcast can arrive interleaved with — and even
// after — the one triggered by our "room:reset" emit below. Resolving on
// the *first* room:state seen is therefore unreliable; we wait for one that
// actually reflects the reset (empty seats, "waiting" phase).
export async function resetRoom(): Promise<void> {
  const socket = ioClient(SERVER_URL, { transports: ["websocket"] });
  try {
    await new Promise<void>((resolve, reject) => {
      const giveUp = setTimeout(
        () => reject(new Error("resetRoom: timed out waiting for a clean room:state")),
        10_000
      );
      socket.on("connect", () => socket.emit("room:reset"));
      socket.on("room:state", (state: ResetProbeState) => {
        if (state.phase === "waiting" && state.seats.every((seat) => seat.nick === null)) {
          clearTimeout(giveUp);
          resolve();
        }
      });
      socket.on("connect_error", reject);
    });
  } finally {
    socket.disconnect();
  }
}

export async function join(page: Page, nick: string) {
  await page.goto("/");
  const input = page.getByLabel("昵称");
  await expect(input).toBeEnabled();
  await input.fill(nick);
  await page.getByLabel("房间密码").fill("1234");
  await page.getByRole("button", { name: "进入房间" }).click();
}

export async function ready(page: Page) {
  await page.getByRole("button", { name: "准备", exact: true }).click();
  await expect(page.getByText("已准备 ✓")).toBeVisible();
}

export async function joinAndReady(page: Page, nick: string) {
  await join(page, nick);
  await ready(page);
}

// Host (page A, first to ready) drives level select + discussion skip; both
// pages must dismiss their own local LevelRulesIntro before placing starts.
export async function startGameToPlacing(pageA: Page, pageB: Page) {
  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await expect(pageA.locator(".level-select")).toBeVisible();
  await pageA.locator(".level-select__card").first().click();

  await pageA.getByRole("button", { name: "已了解，开始讨论 →" }).click();
  await pageB.getByRole("button", { name: "已了解，开始讨论 →" }).click();

  await pageA.getByRole("button", { name: "▶ 提前开始出牌" }).click();
  await expect(pageA.locator(".placing")).toBeVisible();
  await expect(pageB.locator(".placing")).toBeVisible();
}

export interface TwoPlayerSetup {
  contextA: BrowserContext;
  contextB: BrowserContext;
  pageA: Page;
  pageB: Page;
}

export async function setupTwoPlayersInPlacing(browser: Browser): Promise<TwoPlayerSetup> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await startGameToPlacing(pageA, pageB);

  return { contextA, contextB, pageA, pageB };
}

export async function placeFirstHandCard(page: Page, segment: number) {
  await page.locator(".hand-rail .hand-card").first().click();
  await page.locator(`[data-segment="${segment}"]`).click();
  await expect(page.locator(`[data-segment="${segment}"] .placed-card`)).toHaveCount(1);
  await expect(page.locator(".toast--error")).toHaveCount(0);
}

// Places all 12 cards (alternating A/B, starting with A since the opening
// turn is "race") and resolves every self hint-decision with "no", driving
// the room into the reveal phase. Segment choice is irrelevant — reveal
// triggers once all 12 cards are down, regardless of pass/fail. The host
// (pageA) then clicks "继续" to advance into the result phase.
export async function placeAllCardsAndReachResult(pageA: Page, pageB: Page) {
  let turn: "A" | "B" = "A";
  for (let i = 0; i < 12; i++) {
    const page = turn === "A" ? pageA : pageB;
    await page.locator(".hand-rail .hand-card").first().click();
    await page.locator(`[data-segment="${i % 6}"]`).click();
    await page.getByRole("button", { name: "不翻开" }).click();
    turn = turn === "A" ? "B" : "A";
  }
  await expect(pageA.locator(".reveal")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.locator(".reveal")).toBeVisible({ timeout: 10_000 });
  await pageA.getByRole("button", { name: "继续 →" }).click();
  await expect(pageA.locator(".result")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.locator(".result")).toBeVisible({ timeout: 10_000 });
}
