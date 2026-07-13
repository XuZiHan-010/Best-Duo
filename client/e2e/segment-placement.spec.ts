import { test, expect } from "./fixtures.js";
import { placeFirstHandCard, resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

test("clicking S1 and S6 places cards into the matching visual segment", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  // Turn starts as "race": Alice places into S1 (segment index 0).
  await placeFirstHandCard(pageA, 0);

  // Placing opens a self hint-decision window for the placer before the
  // turn hands off to the other seat.
  await pageA.getByRole("button", { name: "不翻开" }).click();

  // Turn alternates to Bob, who places into S6 (segment index 5).
  await placeFirstHandCard(pageB, 5);
});
