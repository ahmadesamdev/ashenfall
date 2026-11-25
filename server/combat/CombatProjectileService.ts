import { runtimeId } from "../shared/Ids.js";
import { pushFx } from "./CombatEffects.js";
export class CombatProjectileService {
  world: any;
  projectiles: Map<string, any>;
  onImpact: (projectile: any, target: any, n: number) => any;
  constructor({
    world,
    onImpact,
  }: {
    world: any;
    onImpact: (projectile: any, target: any, n: number) => any;
  }) {
    this.world = world;
    this.projectiles = new Map();
    this.onImpact = onImpact;
  }
  launch(
    p: any,
    a: any,
    target: any,
    damage: number,
    crit: boolean,
    n: number,
    meta: any = {},
  ) {
    const id = runtimeId("proj");
    const worldMeters = Number(this.world?.worldMetersFor?.(p.zone) || 10000);
    const distance = Math.max(
      1,
      Math.hypot(
        Number(target.x) - Number(p.x),
        Number(target.y) - Number(p.y),
      ) * worldMeters,
    );
    const authoredTravel = Number(a?.combatFeel?.projectileTravelMs || 0);
    const speedMetersPerSecond = Math.max(
      55,
      Number(
        a?.combatFeel?.projectileSpeedMetersPerSecond ||
          (authoredTravel > 0 ? distance / (authoredTravel / 1000) : 110),
      ),
    );
    const travelMs = Math.max(
      90,
      Math.min(
        900,
        authoredTravel > 0
          ? authoredTravel
          : Math.round((distance / speedMetersPerSecond) * 1000),
      ),
    );
    const projectile = {
      id,
      playerId: p.id,
      targetId: target.id,
      abilityId: a.id,
      ability: a,
      zone: p.zone,
      launchedAt: n,
      impactAt: n + travelMs,
      travelMs,
      speedMetersPerSecond,
      startX: Number(p.x),
      startY: Number(p.y),
      launchTargetX: Number(target.x),
      launchTargetY: Number(target.y),
      damage,
      crit,
      homing: a?.combatFeel?.projectileHoming !== false,
      avoidable: Boolean(a?.combatFeel?.projectileAvoidable),
      collisionRadiusMeters: Math.max(
        0.35,
        Number(a?.combatFeel?.projectileCollisionRadiusMeters || 1.25),
      ),
      school: a.scaling === "spell" ? "spell" : "weapon",
      impactFamily: a?.combatFeel?.impactFamily || "ranged",
      lastX: Number(p.x),
      lastY: Number(p.y),
      distanceTravelledMeters: 0,
    };
    this.projectiles.set(id, projectile);
    pushFx(p, "projectile", p.id, target.id, a.id, {
      projectileId: id,
      startX: projectile.startX,
      startY: projectile.startY,
      targetX: projectile.launchTargetX,
      targetY: projectile.launchTargetY,
      durationMs: travelMs,
      projectileKind:
        a?.combatFeel?.projectileKind ||
        (a.scaling === "spell" ? "orb" : "arrow"),
      projectileHoming: projectile.homing,
      trail: a?.combatFeel?.projectileTrail !== false,
      impactFamily: projectile.impactFamily,
      speedMetersPerSecond,
    });
    return projectile;
  }
  impact(projectile: any, target: any, n: number) {
    return this.onImpact(projectile, target, n);
  }
  tick(n = Date.now()) {
    const results: Array<{ projectile: any; r: any }> = [];
    for (const [id, projectile] of this.projectiles) {
      const target = this.world?.mobs?.get
        ? this.world.mobs.get(projectile.targetId)
        : (this.world?.mobs || []).find(
            (x: any) => x.id === projectile.targetId,
          );
      const player = (this.world?.players || []).find(
        (x: any) => x.id === projectile.playerId,
      );
      if (
        !player ||
        !target ||
        target.state === "dead" ||
        player.zone !== projectile.zone ||
        target.zone !== projectile.zone
      ) {
        this.projectiles.delete(id);
        continue;
      }
      const worldMeters = Number(
        this.world?.worldMetersFor?.(projectile.zone) || 10000,
      );
      const dt = Math.max(
        0,
        (n - Number(projectile.lastTickAt || projectile.launchedAt)) / 1000,
      );
      projectile.lastTickAt = n;
      const targetX = projectile.homing
          ? Number(target.x)
          : Number(projectile.launchTargetX),
        targetY = projectile.homing
          ? Number(target.y)
          : Number(projectile.launchTargetY);
      const dx = targetX - Number(projectile.lastX),
        dy = targetY - Number(projectile.lastY),
        dist = Math.hypot(dx, dy) * worldMeters;
      const step = Math.min(
        Math.max(0, dist),
        Number(projectile.speedMetersPerSecond || 100) * dt,
      );
      const norm = Math.hypot(dx, dy) || 1;
      projectile.lastX =
        Number(projectile.lastX) + (dx / norm) * (step / worldMeters);
      projectile.lastY =
        Number(projectile.lastY) + (dy / norm) * (step / worldMeters);
      projectile.distanceTravelledMeters =
        Number(projectile.distanceTravelledMeters || 0) + step;
      const elapsed = n - projectile.launchedAt;
      const timedOut = elapsed >= Number(projectile.travelMs || 900) + 120;
      const hitDistance =
        Math.hypot(
          Number(target.x) - projectile.lastX,
          Number(target.y) - projectile.lastY,
        ) * worldMeters;
      const reachedTarget =
        hitDistance <= Number(projectile.collisionRadiusMeters || 1.25);
      if (
        reachedTarget ||
        (!projectile.homing && elapsed >= Number(projectile.travelMs || 900))
      ) {
        const r = this.impact(projectile, target, n);
        this.projectiles.delete(id);
        results.push({ projectile, r });
        continue;
      }
      if (timedOut) {
        const r = this.impact(projectile, target, n);
        this.projectiles.delete(id);
        results.push({ projectile, r });
      }
    }
    return results;
  }
}
