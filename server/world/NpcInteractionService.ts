import type { PlayerRecord } from "../persistence/Repository.js";

export interface NpcInteractionWorld {
  zoneNpcs(zoneId: string): Array<{ id: string; x: number; y: number }>;
  normalizedMeters(zoneId: string, meters: number): number;
}

export class NpcInteractionService {
  constructor(private readonly world: NpcInteractionWorld) {}

  isActiveNpcNearby(player: PlayerRecord, maxMeters = 30): boolean {
    const activeNpcId = String(player.activeNpcId || "");
    if (!activeNpcId) return true;

    const npc = this.world
      .zoneNpcs(String(player.zone || ""))
      .find((candidate) => candidate.id === activeNpcId);
    if (!npc) {
      player.activeNpcId = null;
      return false;
    }

    const distance = Math.hypot(
      Number(player.x || 0) - npc.x,
      Number(player.y || 0) - npc.y,
    );
    if (
      distance >
      this.world.normalizedMeters(String(player.zone || ""), maxMeters)
    ) {
      player.activeNpcId = null;
      return false;
    }
    return true;
  }
}
