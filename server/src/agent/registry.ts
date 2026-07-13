import type { PlayerAgent } from "./PlayerAgent.js";

export class InMemoryAgentRegistry {
  private readonly agents = new Map<string, PlayerAgent>();

  get(agentId: string): PlayerAgent | undefined {
    return this.agents.get(agentId);
  }

  register(agentId: string, agent: PlayerAgent) {
    this.agents.set(agentId, agent);
  }

  unregister(agentId: string) {
    this.agents.delete(agentId);
  }

  clear() {
    this.agents.clear();
  }

  get size() {
    return this.agents.size;
  }
}