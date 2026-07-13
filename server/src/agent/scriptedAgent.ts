import type { PlayerAgent } from "./PlayerAgent.js";

export const createScriptedAgent = (): PlayerAgent => ({
  async decidePlacement(view) {
    const card = view.hand[0];
    if (!card) throw new Error("Agent has no card to place");

    const segmentLoads = view.room.placements.map((segment, index) => ({ index, count: segment.length }));
    segmentLoads.sort((left, right) => left.count - right.count || left.index - right.index);

    return {
      cardId: card.id,
      segment: segmentLoads[0]?.index ?? 0
    };
  },

  async decideHint() {
    return "no";
  },

  async decideDiscussion() {
    return null;
  }
});