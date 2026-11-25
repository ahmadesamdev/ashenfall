import {
  COMBAT_RANGES,
  classBasicAttackRangeMeters,
  normalizeGameDistance,
} from "../combat/CombatRanges.js";
import { MOVEMENT_SPEEDS } from "./Movement.js";
import { finiteNumber } from "../shared/Hardening.js";

export interface WorldMovementHost {
  zoneConfig(zoneId: string): any;
  isBlocked(zoneId: string, x: number, y: number, player?: any): boolean;
  resolveWalkableStep(
    zoneId: string,
    x: number,
    y: number,
    nx: number,
    ny: number,
    player?: any,
  ): { x: number; y: number; blocked: boolean };
  normalizedMeters(zoneId: string, meters: number): number;
  worldMetersFor(zoneId: string): number;
  zoneGates(zoneId: string): any[];
  zoneNpcs(zoneId: string): any[];
  travel(
    player: any,
    id: string,
    viaGate?: boolean,
    entryGateId?: string | null,
  ): [boolean, string, any?];
  approachPoint(
    player: any,
    target: any,
    stopDistanceMeters?: number,
  ): { x: number; y: number };
}

function cancelCastOnMove(player: any, moving: boolean): void {
  const c = player?.combat?.casting;
  if (!c || !moving || c.completing) return;
  const now = Date.now();
  player.combat.casting = null;
  player.combat.castEventAt = now;
  player.worldCombatLog = player.worldCombatLog || [];
  player.worldCombatLog.push({
    t: new Date().toLocaleTimeString(),
    msg: `✖️ ${c.name || "Cast"}: You moved.`,
  });
  player.worldCombatLog = player.worldCombatLog.slice(-80);
}

function isStunnedNow(player: any, now = Date.now()): boolean {
  return (player?.statuses || []).some(
    (s: any) =>
      s === "stunned" || (s?.id === "stunned" && Number(s.until || 0) > now),
  );
}

export class WorldMovementService {
  constructor(private readonly world: WorldMovementHost) {}

  move(player: any, x: number, y: number, mode: string): [boolean, string] {
    if (player.dead) return [false, "You are dead."];
    if (isStunnedNow(player)) return [false, "You are stunned."];
    cancelCastOnMove(player, true);
    player.mining = null;
    player.pendingOre = null;
    const rawX = finiteNumber(x),
      rawY = finiteNumber(y);
    if (rawX === undefined || rawY === undefined)
      return [false, "Invalid movement coordinates."];
    let nx = Math.max(0.01, Math.min(0.99, rawX));
    let ny = Math.max(0.01, Math.min(0.99, rawY));
    const zone = this.world.zoneConfig(player.zone) || {};
    if (player.dungeon && zone.dungeonBounds) {
      nx = Math.max(
        zone.dungeonBounds.minX,
        Math.min(zone.dungeonBounds.maxX, nx),
      );
      ny = Math.max(
        zone.dungeonBounds.minY,
        Math.min(zone.dungeonBounds.maxY, ny),
      );
    }
    if (this.world.isBlocked(player.zone, nx, ny, player))
      return [false, "That path is blocked."];
    player.moveInput = null;
    player.combat = player.combat || {};
    player.combat.manualMove = true;
    player.combat.autoApproach = false;
    player.combat.queuedWorldAbility = null;
    player.combat.approachSatisfied = false;
    player.movementIntent = "manual";
    player.targetX = nx;
    player.targetY = ny;
    player.movementMode = mode === "run" ? "run" : "walk";
    player.moveState = "moving";
    player.velocityX = 0;
    player.velocityY = 0;
    const dx = nx - player.x,
      dy = ny - player.y,
      distance = Math.hypot(dx, dy);
    if (distance > 0.00001) {
      player.facingX = dx / distance;
      player.facingY = dy / distance;
    }
    return [true, "Moving."];
  }

  stop(player: any): [boolean, string] {
    if (player.mining) {
      player.mining = null;
      player.pendingOre = null;
      return [true, "Mining cancelled."];
    }
    player.moveInput = null;
    player.combat = player.combat || {};
    player.combat.manualMove = true;
    player.combat.autoApproach = false;
    player.combat.queuedWorldAbility = null;
    player.combat.approachSatisfied = false;
    player.movementIntent = "manual";
    player.targetX = player.x;
    player.targetY = player.y;
    player.moveState = "idle";
    player.velocityX = 0;
    player.velocityY = 0;
    return [true, "Stopped."];
  }

  setMoveInput(
    player: any,
    dx: number,
    dy: number,
    mode: string,
  ): [boolean, string] {
    if (player.dead) return [false, "You are dead."];
    if (isStunnedNow(player)) return [false, "You are stunned."];
    cancelCastOnMove(player, Math.hypot(Number(dx) || 0, Number(dy) || 0) > 0);
    if (player.mining) player.mining = null;
    player.pendingOre = null;
    const x = finiteNumber(dx, 0),
      y = finiteNumber(dy, 0),
      length = Math.hypot(x, y);
    if (length < 0.001) return this.stop(player);
    player.moveInput = { x: x / length, y: y / length };
    player.combat = player.combat || {};
    player.combat.manualMove = true;
    player.combat.autoApproach = false;
    player.combat.queuedWorldAbility = null;
    player.combat.approachSatisfied = false;
    player.movementIntent = "manual";
    player.movementMode = mode === "run" ? "run" : "walk";
    player.moveState = "moving";
    player.targetX = player.x + player.moveInput.x * 0.05;
    player.targetY = player.y + player.moveInput.y * 0.05;
    player.velocityX = 0;
    player.velocityY = 0;
    player.facingX = player.moveInput.x;
    player.facingY = player.moveInput.y;
    return [true, "Moving."];
  }

  approachPoint(
    player: any,
    target: any,
    stopDistanceMeters: number = COMBAT_RANGES.stopMeters,
  ): { x: number; y: number } {
    const stopDistance = normalizeGameDistance(
      stopDistanceMeters,
      this.world.worldMetersFor(player.zone),
      this.world.normalizedMeters(player.zone, COMBAT_RANGES.stopMeters),
    );
    const dx = player.x - target.x,
      dy = player.y - target.y,
      distance = Math.hypot(dx, dy);
    if (distance <= stopDistance || distance < 0.001)
      return { x: player.x, y: player.y };
    return {
      x: Math.max(
        0.01,
        Math.min(0.99, target.x + (dx / distance) * stopDistance),
      ),
      y: Math.max(
        0.01,
        Math.min(0.99, target.y + (dy / distance) * stopDistance),
      ),
    };
  }

  updatePlayerMovement(player: any, dt: number): void {
    if (!player) return;
    if (player.dead) {
      player.moveInput = null;
      player.velocityX = 0;
      player.velocityY = 0;
      player.targetX = player.x;
      player.targetY = player.y;
      if (player.moveState === "moving") player.moveState = "idle";
      return;
    }
    if (isStunnedNow(player)) {
      player.moveInput = null;
      player.velocityX = 0;
      player.velocityY = 0;
      player.targetX = player.x;
      player.targetY = player.y;
      if (player.moveState === "moving") player.moveState = "idle";
      return;
    }
    const zone = this.world.zoneConfig(player.zone) || {};
    const worldMeters = Math.max(1, Number(zone.worldMeters || 10000));
    const combatTargetId = player.targetMobId || player.worldCombatMobId;
    const ownsCombatPursuit = Boolean(
      player.combat?.autoApproach ||
      (player.worldCombatMobId && player.combat?.autoAttack),
    );
    if (
      !player.pvp &&
      combatTargetId &&
      ownsCombatPursuit &&
      !player.combat?.manualMove &&
      (!player.movementIntent || player.movementIntent === "combat")
    ) {
      const targetMob = (this.world as any).byIdMob?.(combatTargetId);
      if (
        targetMob &&
        targetMob.zone === player.zone &&
        targetMob.state !== "dead"
      ) {
        const configuredRange = Number(player.combat.approachRangeMeters);
        const standMeters =
          Number.isFinite(configuredRange) && configuredRange > 0
            ? configuredRange
            : classBasicAttackRangeMeters(player.classId);
        const rangeNorm = this.world.normalizedMeters(player.zone, standMeters);
        const distanceToMob = Math.hypot(
          player.x - targetMob.x,
          player.y - targetMob.y,
        );
        const wasSatisfied = Boolean(player.combat.approachSatisfied);
        const exitRangeNorm =
          rangeNorm + this.world.normalizedMeters(player.zone, 3);
        if (
          distanceToMob <= rangeNorm ||
          (wasSatisfied && distanceToMob <= exitRangeNorm)
        ) {
          player.combat.approachSatisfied = true;
          player.combat.autoApproach = false;
          player.moveState = "idle";
          player.velocityX = 0;
          player.velocityY = 0;
          player.targetX = player.x;
          player.targetY = player.y;
        } else {
          player.combat.approachSatisfied = false;
          player.combat.autoApproach = true;
          player.movementIntent = "combat";
          const ap = this.approachPoint(player, targetMob, standMeters);
          player.targetX = ap.x;
          player.targetY = ap.y;
          if (player.moveState !== "moving") {
            player.moveState = "moving";
            player.movementMode = "run";
          }
        }
      }
    }
    const baseMetersPerSecond =
      player.movementMode === "run"
        ? Number(player.runSpeed || MOVEMENT_SPEEDS.run)
        : Number(player.speed || MOVEMENT_SPEEDS.walk);
    const regionalMultiplier = Math.max(
      0.1,
      Number(player.regionRuntime?.speedMultiplier || 1),
    );
    const metersPerSecond = baseMetersPerSecond * regionalMultiplier;
    const speed = metersPerSecond / worldMeters;
    if (player.moveInput) {
      const dx = Number(player.moveInput.x) || 0,
        dy = Number(player.moveInput.y) || 0,
        step = speed * dt;
      const nx = player.x + dx * step,
        ny = player.y + dy * step;
      player.facingX = dx;
      player.facingY = dy;
      const r = this.world.resolveWalkableStep(
        player.zone,
        player.x,
        player.y,
        nx,
        ny,
        player,
      );
      player.x = r.x;
      player.y = r.y;
      player.velocityX = r.blocked ? 0 : (dx * step) / dt;
      player.velocityY = r.blocked ? 0 : (dy * step) / dt;
      player.targetX = player.x + dx * 0.05;
      player.targetY = player.y + dy * 0.05;
      if (r.blocked) {
        player.velocityX = 0;
        player.velocityY = 0;
        player.moveState = "moving";
      }
    } else if (player.moveState === "moving") {
      const dx = player.targetX - player.x,
        dy = player.targetY - player.y,
        dist = Math.hypot(dx, dy),
        step = speed * dt;
      if (dist > 0.00001) {
        player.facingX = dx / dist;
        player.facingY = dy / dist;
      }
      if (dist <= step || dist < 0.0005) {
        const r = this.world.resolveWalkableStep(
          player.zone,
          player.x,
          player.y,
          player.targetX,
          player.targetY,
          player,
        );
        player.x = r.x;
        player.y = r.y;
        player.velocityX = 0;
        player.velocityY = 0;
        player.moveState = "idle";
        if (r.blocked) {
          player.targetX = player.x;
          player.targetY = player.y;
        } else {
          if (
            player.movementIntent === "manual" &&
            !(player.targetMobId || player.worldCombatMobId)
          ) {
            player.movementIntent = "none";
            player.combat && (player.combat.manualMove = false);
          } else if (player.movementIntent === "combat") {
            player.combat && (player.combat.manualMove = false);
          }
        }
      } else {
        const nx = player.x + (dx / dist) * step,
          ny = player.y + (dy / dist) * step;
        const r = this.world.resolveWalkableStep(
          player.zone,
          player.x,
          player.y,
          nx,
          ny,
          player,
        );
        if (!r.blocked) {
          player.x = r.x;
          player.y = r.y;
          player.velocityX = ((dx / dist) * step) / dt;
          player.velocityY = ((dy / dist) * step) / dt;
        } else if (player.movementIntent === "combat" && player.targetMobId) {
          const side = Number(player.combatApproachSide || 1);
          const px = -dy / dist,
            py = dx / dist;
          const detourStep = step * 1.35;
          const a = this.world.resolveWalkableStep(
            player.zone,
            player.x,
            player.y,
            player.x + px * detourStep * side,
            player.y + py * detourStep * side,
            player,
          );
          const chosenSide = a.blocked ? -side : side;
          const b = a.blocked
            ? this.world.resolveWalkableStep(
                player.zone,
                player.x,
                player.y,
                player.x - px * detourStep * side,
                player.y - py * detourStep * side,
                player,
              )
            : a;
          if (!b.blocked) {
            player.x = b.x;
            player.y = b.y;
            player.velocityX = (px * detourStep * chosenSide) / dt;
            player.velocityY = (py * detourStep * chosenSide) / dt;
            player.combatApproachSide = chosenSide;
          } else {
            player.combatApproachSide = -side;
            player.velocityX = 0;
            player.velocityY = 0;
          }
        } else {
          player.velocityX = 0;
          player.velocityY = 0;
        }
        if (r.blocked && player.movementIntent !== "combat") {
          player.targetX = player.x;
          player.targetY = player.y;
          player.moveState = "idle";
        } else if (r.blocked) {
          player.moveState = "moving";
          player.movementMode = "run";
        }
      }
    }
    player.x = Math.max(0.01, Math.min(0.99, player.x));
    player.y = Math.max(0.01, Math.min(0.99, player.y));
  }
}
