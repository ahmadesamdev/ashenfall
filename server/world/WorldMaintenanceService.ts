import type { World } from "./World.js";

export class WorldMaintenanceService {
  constructor(private readonly world: World) {}

  cleanup(now = Date.now()) {
    const world: any = this.world;
    for (const [id, pile] of world.lootPiles) {
      if (Number(pile.expiresAt || 0) > 0 && pile.expiresAt <= now)
        world.lootPiles.delete(id);
    }
    for (const [id, mob] of world.mobs) {
      if (
        !mob ||
        !mob.type ||
        !Number.isFinite(Number(mob.x)) ||
        !Number.isFinite(Number(mob.y)) ||
        !Number.isFinite(Number(mob.hp)) ||
        Number(mob.hp) <= 0 ||
        !Number.isFinite(Number(mob.maxHp)) ||
        Number(mob.maxHp) <= 0 ||
        !world.mobDefs.some((d: any) => d?.type === mob.type)
      ) {
        world.mobs.delete(id);
        continue;
      }
      if (mob.attackers && typeof mob.attackers === "object") {
        for (const playerId of Object.keys(mob.attackers)) {
          const player = world.players.find((x: any) => x.id === playerId);
          if (
            !player ||
            !player.online ||
            player.zone !== mob.zone ||
            player.dead
          )
            delete mob.attackers[playerId];
        }
      }
      if (
        mob.ignoredAggroPlayers &&
        typeof mob.ignoredAggroPlayers === "object"
      ) {
        for (const playerId of Object.keys(mob.ignoredAggroPlayers)) {
          if (
            Number(mob.ignoredAggroPlayers[playerId]) > 0 &&
            Number(mob.ignoredAggroPlayers[playerId]) < now
          )
            delete mob.ignoredAggroPlayers[playerId];
        }
      }
    }
  }

  updateNpcs(dt = 0.05, now = Date.now()) {
    const world: any = this.world;
    for (const npc of world.npcs) {
      if (!npc?.scheduleProfile) continue;
      try {
        const eventState = world.worldEventState?.[npc.zone]?.worldState;
        if (eventState) {
          npc.eventWorldState = {
            outcome: eventState.outcome,
            phase: eventState.phase || null,
            settlementState: eventState.settlementState,
            npcAlert: !!eventState.npcAlert,
            eventId: eventState.eventId,
          };
        } else npc.eventWorldState = null;
        world.npcSchedule.apply(npc, now, dt, world);
        if (eventState && npc.scheduleState)
          npc.scheduleState = {
            ...npc.scheduleState,
            eventAlert: !!eventState.npcAlert,
            worldEventOutcome: eventState.outcome,
            settlementState: eventState.settlementState,
          };
      } catch (error) {
        console.warn(
          "npc schedule",
          npc.id,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  updatePlayers(dt: any) {
    const world: any = this.world;
    for (const player of world.players) {
      if (!player || player.dead) continue;
      if (world.playerMutations?.isLocked?.(player.id)) continue;
      world.movementService.updatePlayerMovement(player, dt);
      if (player.pendingGate && player.moveState === "idle") {
        const gate = world
          .zoneGates(player.zone)
          .find((x: any) => x.id === player.pendingGate);
        if (
          gate &&
          Math.hypot(player.x - gate.x, player.y - gate.y) <=
            world.normalizedMeters(player.zone, 13)
        ) {
          player.pendingGate = null;
          const traveled = world.travel(
            player,
            gate.to,
            true,
            `${gate.id}_return`,
          );
          if (traveled[0]) player._travelCompletedZone = gate.to;
          continue;
        }
        if (!gate) player.pendingGate = null;
      }
      if (player.activeNpcId) {
        const npc = world
          .zoneNpcs(player.zone)
          .find((x: any) => x.id === player.activeNpcId);
        if (
          !npc ||
          Math.hypot(player.x - npc.x, player.y - npc.y) >
            world.normalizedMeters(player.zone, 30)
        ) {
          player.activeNpcId = null;
          player._npcInteractionExpired = Date.now();
        }
      }
      if (player.pendingNpc) {
        const npc = world
          .zoneNpcs(player.zone)
          .find((x: any) => x.id === player.pendingNpc);
        if (npc) {
          const distance = Math.hypot(player.x - npc.x, player.y - npc.y);
          if (distance <= world.normalizedMeters(player.zone, 5)) {
            player.pendingNpc = null;
            player.movementIntent = "none";
            player.targetX = player.x;
            player.targetY = player.y;
            player.moveState = "idle";
            player.velocityX = 0;
            player.velocityY = 0;
            player.activeNpcId = npc.id;
            player._npcArrived = npc.id;
          }
        } else player.pendingNpc = null;
      }
      if (player.pendingOre && player.moveState === "idle") {
        const ore = world.ores.get(player.pendingOre);
        player.pendingOre = null;
        player.movementIntent = "none";
        if (
          ore &&
          ore.zone === player.zone &&
          ore.state !== "depleted" &&
          Math.hypot(player.x - ore.x, player.y - ore.y) <
            world.normalizedMeters(player.zone, 8)
        )
          player._oreArrived = ore.id;
      }
      if (player.pendingLoot && player.moveState === "idle") {
        const loot = world.lootPiles.get(player.pendingLoot);
        if (
          loot &&
          loot.zone === player.zone &&
          Math.hypot(player.x - loot.x, player.y - loot.y) <
            world.normalizedMeters(player.zone, 10)
        ) {
          player._lootArrived = loot.id;
          player.pendingLoot = null;
          player.movementIntent = "none";
        }
      }
    }
  }
}
