import { MOVEMENT_SPEEDS } from "./Movement.js";

export interface WorldTravelHost {
  zones: any[];
  byId: Record<string, any>;
  normalizedMeters: (zoneId: string, meters: number) => number;
  zoneGates: (zoneId: string) => any[];
}
export class WorldTravelService {
  constructor(private readonly world: WorldTravelHost) {}
  respawnPoints(zoneId: string): any[] {
    const zone = this.world.byId[zoneId] || {};
    const seed = String(zoneId || "zone")
      .split("")
      .reduce((n, c) => n + c.charCodeAt(0), 0);
    if (zone.respawnPoints?.length) return zone.respawnPoints;
    const sx = Number(zone.spawn?.x ?? 0.5),
      sy = Number(zone.spawn?.y ?? 0.5);
    const points = [
      { x: sx, y: sy },
      {
        x: Math.max(0.08, Math.min(0.92, sx + 0.18)),
        y: Math.max(0.08, Math.min(0.92, sy + 0.08)),
      },
      {
        x: Math.max(0.08, Math.min(0.92, sx - 0.17)),
        y: Math.max(0.08, Math.min(0.92, sy + 0.12)),
      },
      {
        x: Math.max(0.08, Math.min(0.92, sx + 0.1)),
        y: Math.max(0.08, Math.min(0.92, sy - 0.18)),
      },
      {
        x: Math.max(0.08, Math.min(0.92, sx - 0.12)),
        y: Math.max(0.08, Math.min(0.92, sy - 0.16)),
      },
    ];
    return points.map((point, i) => ({
      ...point,
      id: `${zoneId}_respawn_${i}`,
      seed,
    }));
  }
  nearestRespawnPoint(zoneId: string, x: number, y: number): any {
    const points = this.respawnPoints(zoneId);
    if (!points.length)
      return (this.world.byId[zoneId] || {}).spawn || { x: 0.5, y: 0.5 };
    return points.reduce((nearest, point) =>
      Math.hypot(point.x - x, point.y - y) <
      Math.hypot(nearest.x - x, nearest.y - y)
        ? point
        : nearest,
    );
  }
  travel(
    player: any,
    id: string,
    viaGate = false,
    entryGateId: string | null = null,
  ): [boolean, string, Record<string, unknown>?] {
    if (player.encounterId || player.worldCombatMobId)
      return [false, "Finish or escape your current fight first."];
    const zone = this.world.byId[id];
    if (!zone) return [false, "Unknown zone."];
    let spawn = { ...zone.spawn };
    if (viaGate && entryGateId) {
      const sourceGateId = String(entryGateId).replace(/_return$/, "");
      const entry = this.world
        .zoneGates(id)
        .find(
          (g) =>
            g.id === entryGateId ||
            g.id === sourceGateId ||
            g.linkId === sourceGateId ||
            g.to === player.zone,
        );
      if (entry) {
        const off = this.world.normalizedMeters(id, 8);
        const dx = entry.x < 0.5 ? off : entry.x > 0.5 ? -off : 0;
        const dy = entry.y < 0.5 ? off : entry.y > 0.5 ? -off : 0;
        spawn = {
          x: Math.max(0.02, Math.min(0.98, entry.x + dx)),
          y: Math.max(0.03, Math.min(0.97, entry.y + dy)),
        };
      }
    }
    player.zone = id;
    player.x = spawn.x;
    player.y = spawn.y;
    player.targetX = player.x;
    player.targetY = player.y;
    player.moveState = "idle";
    player.movementIntent = "none";
    player.speed = MOVEMENT_SPEEDS.walk;
    player.runSpeed = MOVEMENT_SPEEDS.run;
    player.facingX = 0;
    player.facingY = -1;
    player.targetMobId = null;
    player.mining = null;
    player.moveInput = null;
    player.activeNpcId = null;
    player.targetPlayerId = null;
    player.worldCombatMobId = null;
    player.combat.autoAttack = false;
    player.combat.autoApproach = false;
    player.combat.manualMove = false;
    player.movementIntent = "none";
    player.pendingGate = null;
    player.pendingNpc = null;
    player.pendingLoot = null;
    player.gateCooldownUntil = Date.now() + 650;
    player.homeCity = zone.city
      ? zone.id
      : player.homeCity ||
        this.world.zones.find((x) => x.city)?.id ||
        "stonehold";
    player._travelCompletedZone = id;
    return [
      true,
      `You arrive in ${zone.name}.`,
      { zoneId: id, fromGate: viaGate },
    ];
  }
}
