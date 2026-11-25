import type { World } from "./World.js";
import { COMBAT_RANGES } from "../combat/CombatRanges.js";

export class WorldRegionalBehaviorService {
  constructor(private readonly world: World) {}

  regionalTraversalFor(zoneId: string) {
    const world: any = this.world;
    const profileId = world.regionTraversalProfiles?.regionProfiles?.[zoneId];
    return (
      world.regionTraversalProfiles?.profiles?.[profileId] || {
        roadAggroMultiplier: 1,
        offRoadAggroMultiplier: 1,
      }
    );
  }

  distanceToRoadFor(player: any) {
    const world: any = this.world;
    const roads = world.layoutFor(player.zone)?.roads || [];
    let best = Infinity;
    for (const road of roads) {
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1],
          b = road[i],
          dx = b[0] - a[0],
          dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((player.x - a[0]) * dx + (player.y - a[1]) * dy) /
              (dx * dx + dy * dy || 1),
          ),
        );
        best = Math.min(
          best,
          Math.hypot(player.x - (a[0] + dx * t), player.y - (a[1] + dy * t)),
        );
      }
    }
    return best;
  }

  regionalMobModifier(mob: any, now: number) {
    const world: any = this.world;
    let damage = 1,
      speed = 1;
    const baseAggro = Math.max(
      1,
      Number(
        mob.baseAggroRangeMeters ||
          mob.aggroRangeMeters ||
          COMBAT_RANGES.mobAggroMeters,
      ),
    );
    const worldState = world.worldEventState?.[mob.zone]?.worldState;
    if (worldState) {
      damage *= Number(worldState.mobDamageMultiplier || 1);
      const aggroMult = Number(worldState.mobAggroMultiplier || 1);
      mob.aggroRangeMeters = baseAggro * aggroMult;
      speed *=
        worldState.outcome === "failed"
          ? 1.03
          : worldState.outcome === "active"
            ? 1.02
            : 1;
      mob.regionalEventState = worldState.outcome;
    } else mob.aggroRangeMeters = baseAggro;
    if (mob.zone === "gloamwood") {
      const d = Math.hypot(mob.x - 0.31, mob.y - 0.77);
      if (d <= 0.055) {
        damage *= 1.18;
        speed *= 0.92;
        mob.regionalBehavior = "root-corrupted";
      } else mob.regionalBehavior = "normal";
    } else if (mob.zone === "ashen_wastes") {
      const phase = now % 180000;
      if (phase < 45000) {
        damage *= 1.1;
        speed *= 1.1;
        mob.regionalBehavior = "storm-frenzy";
      } else mob.regionalBehavior = "normal";
    } else if (mob.zone === "old_kingdom") {
      const d = Math.min(
        Math.hypot(mob.x - 0.48, mob.y - 0.48),
        Math.hypot(mob.x - 0.22, mob.y - 0.72),
      );
      if (d <= 0.07) {
        damage *= 1.08;
        mob.aggroRangeMeters = Math.max(baseAggro, 125);
        mob.regionalBehavior = "relic-haunt";
      } else mob.regionalBehavior = "normal";
    } else if (mob.zone === "eastern_reach") {
      const d = Math.abs(mob.y - 0.5);
      if (d <= 0.035) {
        mob.aggroRangeMeters = Math.max(baseAggro, 120);
        mob.regionalBehavior = "road-alert";
      } else mob.regionalBehavior = "normal";
    } else mob.regionalBehavior = "normal";
    return { damage, speed };
  }
}
