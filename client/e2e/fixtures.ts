import { test as base, expect } from "@playwright/test";

/**
 * Most multiplayer specs create one isolated browser context per player.
 * Playwright only owns the built-in context fixture, so those manually
 * created contexts otherwise survive until the worker exits and their
 * reconnecting sockets can leak into the next test's singleton room.
 */
export const test = base.extend<{ closeManualContexts: void }>({
  closeManualContexts: [
    async ({ browser }, use) => {
      const contextsAtStart = new Set(browser.contexts());
      await use();
      await Promise.all(
        browser
          .contexts()
          .filter((context) => !contextsAtStart.has(context))
          .map((context) => context.close()),
      );
    },
    { auto: true },
  ],
});

export { expect };
