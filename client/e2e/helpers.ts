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

// 所有 E2E 账号共用一个满足 schema v2 最低长度的个人密码；邮箱由昵称稳定派生，
// 账号库在整次 E2E 运行内持久，因此 helper 会先注册，遇到已注册邮箱再走登录。
export const E2E_ACCOUNT_PASSWORD = "e2e-password";

export const accountEmailFor = (nick: string) =>
  `${nick.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.example`;

const knownE2EAccounts = new Set<string>();

async function waitForAuthResult(page: Page): Promise<"joined" | "error"> {
  return Promise.race([
    page.locator(".lobby").waitFor().then(() => "joined" as const),
    page.locator("#auth-error").waitFor().then(() => "error" as const),
  ]);
}

async function loginWithEmail(page: Page, email: string, password: string) {
  await page.goto(SERVER_URL + "/");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("个人密码").fill(password);
  await page.getByLabel("房间密码").fill("1234");
  await page.getByRole("button", { name: "登录并进入房间" }).click();
  return waitForAuthResult(page);
}

export async function join(page: Page, nick: string, accountPassword = E2E_ACCOUNT_PASSWORD) {
  // Absolute URL on purpose: helpers drive pages from manually created
  // browser.newContext() contexts, which do not inherit the config baseURL
  // (same trap as viewport — see setupTwoPlayersInPlacing).
  const email = accountEmailFor(nick);

  if (accountPassword !== E2E_ACCOUNT_PASSWORD) {
    await loginWithEmail(page, email, accountPassword);
    return;
  }

  if (knownE2EAccounts.has(email)) {
    await loginWithEmail(page, email, accountPassword);
    return;
  }

  await page.goto(SERVER_URL + "/account/register");
  await expect(page.getByLabel("邮箱")).toBeEnabled();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("个人密码", { exact: true }).fill(accountPassword);
  await page.getByLabel("确认密码").fill(accountPassword);
  await page.getByLabel("游戏昵称").fill(nick);
  await page.getByLabel("房间密码").fill("1234");
  await page.getByRole("button", { name: "创建账号并进入大厅" }).click();

  const registrationResult = await waitForAuthResult(page);
  if (registrationResult === "joined") {
    knownE2EAccounts.add(email);
    return;
  }
  const error = await page.locator("#auth-error").textContent();
  // The store may report either unique field first; for this helper both are
  // deterministically derived from the same nick, so either means the E2E
  // account already exists and should use the explicit login path.
  if (!error?.includes("该邮箱已注册") && !error?.includes("该昵称不可用")) return;

  knownE2EAccounts.add(email);
  await page.getByRole("link", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "登录并进入房间" }).click();
  await waitForAuthResult(page);
}

export async function ready(page: Page) {
  await page.getByRole("button", { name: "准备", exact: true }).click();
  await expect(page.locator(".player-seat--me.player-seat--ready")).toBeVisible();
}

export async function joinAndReady(page: Page, nick: string) {
  await join(page, nick);
  await ready(page);
}

// Host (page A, first to ready) drives level select; both pages must dismiss
// their own local LevelRulesIntro to land in the Discussion phase.
export async function startGameToDiscussion(pageA: Page, pageB: Page) {
  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await expect(pageA.locator(".level-select")).toBeVisible();
  await pageA.locator(".level-select__card").first().click();

  await pageA.getByRole("button", { name: "已了解，开始讨论 →" }).click();
  await pageB.getByRole("button", { name: "已了解，开始讨论 →" }).click();

  await expect(pageA.locator(".discussion")).toBeVisible();
  await expect(pageB.locator(".discussion")).toBeVisible();
}

// Continues from Discussion into Placing via the host's early-start button.
export async function startGameToPlacing(pageA: Page, pageB: Page) {
  await startGameToDiscussion(pageA, pageB);

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

export interface MultiplayerSetup {
  contexts: BrowserContext[];
  pages: Page[];
}

export async function setupHumanPlayersInPlacing(
  browser: Browser,
  nicks: string[],
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<MultiplayerSetup> {
  if (nicks.length < 2 || nicks.length > 4) {
    throw new Error(`Expected 2-4 human players, received ${nicks.length}`);
  }

  const contexts = await Promise.all(nicks.map(() => browser.newContext(contextOptions)));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));

  for (let index = 0; index < pages.length; index += 1) {
    await joinAndReady(pages[index], nicks[index]);
  }

  const hostPage = pages[0];
  await hostPage.getByRole("button", { name: "开始游戏" }).click();
  await expect(hostPage.locator(".level-select")).toBeVisible();
  await hostPage.locator(".level-select__card").first().click();

  for (const page of pages) {
    await page.getByRole("button", { name: "已了解，开始讨论 →" }).click();
    await expect(page.locator(".discussion")).toBeVisible();
  }

  await hostPage.getByRole("button", { name: "▶ 提前开始出牌" }).click();
  for (const page of pages) {
    await expect(page.locator(".placing")).toBeVisible();
  }

  return { contexts, pages };
}

export async function placeAllHumanCardsAndReachReveal(pages: Page[]) {
  for (let playIndex = 0; playIndex < 12; playIndex += 1) {
    const page = pages[playIndex % pages.length];
    await expect(page.locator(".hand-rail .hand-card").first()).toBeEnabled();
    await page.locator(".hand-rail .hand-card").first().click();
    await page.locator(`[data-segment="${playIndex % 6}"]`).click();
    await page.getByRole("button", { name: "不翻开" }).click();
  }

  for (const page of pages) {
    await expect(page.locator(".reveal")).toBeVisible({ timeout: 10_000 });
  }
}

// contextOptions is forwarded to browser.newContext() for BOTH players — this
// is how specs set a real viewport. Note: Playwright's test.use({ viewport })
// only affects the built-in `page`/`context` fixtures, NOT contexts created
// manually via browser.newContext(), so mobile specs must pass it here.
export async function setupTwoPlayersInPlacing(
  browser: Browser,
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<TwoPlayerSetup> {
  const contextA = await browser.newContext(contextOptions);
  const contextB = await browser.newContext(contextOptions);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await startGameToPlacing(pageA, pageB);

  return { contextA, contextB, pageA, pageB };
}

// Like setupTwoPlayersInPlacing but stops in the Discussion phase. pageA is the
// host (sees the early-start button); pageB is the non-host (sees the waiting
// status). contextOptions is forwarded to both browser.newContext() calls.
export async function setupTwoPlayersInDiscussion(
  browser: Browser,
  contextOptions?: Parameters<Browser["newContext"]>[0],
): Promise<TwoPlayerSetup> {
  const contextA = await browser.newContext(contextOptions);
  const contextB = await browser.newContext(contextOptions);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await startGameToDiscussion(pageA, pageB);

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
// triggers once all 12 cards are down, regardless of pass/fail.
export async function placeAllCardsAndReachReveal(pageA: Page, pageB: Page) {
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
}

// Continues from Reveal into the result phase via the host's "继续" button.
export async function placeAllCardsAndReachResult(pageA: Page, pageB: Page) {
  await placeAllCardsAndReachReveal(pageA, pageB);
  await pageA.getByRole("button", { name: "继续 →" }).click();
  await expect(pageA.locator(".result")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.locator(".result")).toBeVisible({ timeout: 10_000 });
}
