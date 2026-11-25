import { combatThreat, healingThreat } from "../combat/PartyCombat.js";
import {
  COMBAT_RANGES,
  classBasicAttackRangeMeters,
} from "../combat/CombatRanges.js";
import crypto from "node:crypto";
const uid = (p) => p + "_" + crypto.randomBytes(5).toString("hex");

class WorldCombatService {
  constructor(private readonly world: any) {}
  combatRangeNormalized(zoneId) {
    return this.world.normalizedMeters(zoneId, COMBAT_RANGES.meleeMeters);
  }
  combatStopDistanceNormalized(zoneId) {
    return this.world.normalizedMeters(zoneId, COMBAT_RANGES.stopMeters);
  }
  combatDisengageNormalized(zoneId) {
    return this.world.normalizedMeters(zoneId, COMBAT_RANGES.disengageMeters);
  }
  combatReturnDistanceNormalized(zoneId) {
    return this.world.normalizedMeters(zoneId, COMBAT_RANGES.returnMeters);
  }

  establishWorldCombat(p: any, m: any, opts: any = {}) {
    if (!p || !m || p.dead || m.state === "dead" || m.zone !== p.zone)
      return false;
    const now = Date.now();
    p.combat = p.combat || {};
    const sameTarget = p.targetMobId === m.id && p.worldCombatMobId === m.id;
    p.targetMobId = m.id;
    p.worldCombatMobId = m.id;
    p.combat.autoAttack = opts.autoAttack !== false;
    const rangeMeters =
      Number.isFinite(Number(opts.approachRangeMeters)) &&
      Number(opts.approachRangeMeters) > 0
        ? Number(opts.approachRangeMeters)
        : classBasicAttackRangeMeters(p.classId);
    p.combat.approachRangeMeters = rangeMeters;
    const rangeNorm = this.world.normalizedMeters(p.zone, rangeMeters);
    const inRange = Math.hypot(p.x - m.x, p.y - m.y) <= rangeNorm;
    p.combat.approachSatisfied = sameTarget
      ? Boolean(p.combat.approachSatisfied) || inRange
      : opts.approachSatisfied === true || inRange;
    if (opts.keepManualMove !== true && !p.combat.manualMove) {
      p.combat.autoApproach =
        opts.autoApproach !== false && !p.combat.approachSatisfied;
    } else if (p.combat.manualMove) {
      p.combat.autoApproach = false;
    }
    if (!p.combat.manualMove) {
      p.movementIntent = "combat";
      if (p.combat.autoApproach) {
        const ap = this.world.approachPoint(p, m, rangeMeters);
        p.targetX = ap.x;
        p.targetY = ap.y;
        p.movementMode = "run";
        p.moveState = "moving";
      } else {
        p.targetX = p.x;
        p.targetY = p.y;
        p.moveState = "idle";
        p.velocityX = 0;
        p.velocityY = 0;
      }
    }
    this.addMobThreat(m, p, Math.max(1, Number(opts.threat || 1)));
    const wasEngaged = m.state === "engaged" && !m.returning;
    const wasReturning = Boolean(m.returning) || m.state === "returning";
    if (!wasEngaged && !wasReturning) {
      m.leashOriginX = Number.isFinite(Number(m.leashOriginX))
        ? m.leashOriginX
        : m.homeX;
      m.leashOriginY = Number.isFinite(Number(m.leashOriginY))
        ? m.leashOriginY
        : m.homeY;
    }
    m.state = "engaged";
    m.returning = false;
    m.outOfCombatSince = 0;
    m.behavior &&
      ((m.behavior.fleeUntil = 0),
      (m.behavior.fleeStartedAt = 0),
      (m.behavior.kiteUntil = 0));
    m.velocityX = 0;
    m.velocityY = 0;
    m.wanderUntil = now + 60000;
    return true;
  }

  clearWorldCombat(p: any, m: any = null, opts: any = {}) {
    const mob =
      m ||
      (p?.worldCombatMobId || p?.targetMobId
        ? this.world.byIdMob(p.worldCombatMobId || p.targetMobId)
        : null);
    if (p) {
      p.combat = p.combat || {};
      p.worldCombatMobId = null;
      if (opts.clearTarget !== false) p.targetMobId = null;
      p.combat.autoAttack = false;
      p.combat.autoApproach = false;
      p.combat.queuedWorldAbility = null;
      p.combat.approachSatisfied = false;
      if (opts.clearMovementIntent !== false && p.movementIntent === "combat")
        p.movementIntent = "none";
    }
    if (mob) {
      mob.attackers = mob.attackers || {};
      if (p) delete mob.attackers[p.id];
      if (p && mob.aggroTarget === p.id) mob.aggroTarget = null;
      if (!Object.keys(mob.attackers).length && mob.state !== "dead") {
        mob.state = "returning";
        mob.returning = true;
        mob.aggroTarget = null;
        mob.velocityX = 0;
        mob.velocityY = 0;
        mob.outOfCombatSince = Date.now();
      }
    }
    return mob;
  }
  combatRangeMeters(player: any = null) {
    return classBasicAttackRangeMeters(player?.classId);
  }
  combatDisengageMeters() {
    return COMBAT_RANGES.disengageMeters;
  }
  isSafeWorldEntry(zoneId, x, y) {
    if (zoneId !== "gloamwood") return false;
    const g = this.world
      .zoneGates(zoneId)
      .find((x) => x.id === "gloam_return") || { x: 0.08, y: 0.53 };
    return (
      Math.hypot(Number(x) - Number(g.x), Number(y) - Number(g.y)) <= 0.025
    );
  }
  addMobThreat(m: any, p: any, amount: number) {
    if (!m || !p || p.dead || !p.online) return;
    this.world.mobBehavior?.recordThreat(m, p);
    m.attackers = m.attackers || {};
    const threat = Math.max(0, Number(amount) || 0);
    m.attackers[p.id] =
      Math.max(0, Number(m.attackers[p.id] || 0)) + combatThreat(p, threat);
    m.ignoredAggroPlayers = m.ignoredAggroPlayers || {};
    delete m.ignoredAggroPlayers[p.id];
    const current = m.aggroTarget ? Number(m.attackers[m.aggroTarget] || 0) : 0;
    const next = Object.entries(m.attackers)
      .map(([id, value]) => ({ id, threat: Number(value) || 0 }))
      .filter((x) => x.threat > 0)
      .sort((a, b) => b.threat - a.threat)[0];
    if (
      next &&
      (!m.aggroTarget ||
        !current ||
        next.id === m.aggroTarget ||
        next.threat >= current * 1.15)
    ) {
      m.aggroTarget = next.id;
    }
    m.threatUpdatedAt = Date.now();
  }

  addHealingThreat(target: any, healer: any, amount: number) {
    if (!target || !healer || target.dead || healer.dead || !healer.online)
      return;
    const threat = healingThreat(healer, amount);
    if (threat <= 0) return;
    for (const m of this.world.mobs.values()) {
      if (
        m.zone !== target.zone ||
        m.state === "dead" ||
        !m.attackers?.[target.id]
      )
        continue;
      this.world.addMobThreat(m, healer, threat);
    }
  }

  mobThreat(m: any) {
    return Object.entries(m?.attackers || {})
      .map(([id, value]) => ({ id, threat: Number(value) || 0 }))
      .sort((a, b) => b.threat - a.threat);
  }

  engageMobAgainstPlayer(p, m) {
    if (!m || m.state === "dead" || m.zone !== p.zone || p.dead) return false;
    const currentRange = Number(p.combat?.approachRangeMeters);
    return this.establishWorldCombat(p, m, {
      autoAttack: true,
      approachSatisfied: false,
      approachRangeMeters:
        Number.isFinite(currentRange) && currentRange > 0
          ? currentRange
          : classBasicAttackRangeMeters(p.classId),
      threat: 1,
    });
  }
  enterWorldCombat(p, m) {
    if (!m || m.state === "dead" || m.zone !== p.zone || p.dead) return false;
    const currentRange = Number(p.combat?.approachRangeMeters);
    return this.establishWorldCombat(p, m, {
      autoAttack: true,
      approachSatisfied: false,
      approachRangeMeters:
        Number.isFinite(currentRange) && currentRange > 0
          ? currentRange
          : classBasicAttackRangeMeters(p.classId),
      threat: 1,
    });
  }

  selectNextAggroTarget(p: any, excludeMobId: any = null) {
    if (!p || p.dead || !this.world?.zoneMobs) return null;
    const candidates = this.world
      .zoneMobs(p.zone, p)
      .filter(
        (m: any) =>
          m &&
          m.state !== "dead" &&
          m.id !== excludeMobId &&
          m.attackers?.[p.id] &&
          this.world.sameDungeonInstance(m, p),
      );
    candidates.sort(
      (a: any, b: any) =>
        Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
    );
    return candidates[0] || null;
  }

  finalizeMobDeath(p: any, m: any) {
    if (!m || m.state === "dead")
      return [false, "That creature is already dead."];
    m.hp = 0;
    m.state = "dead";
    m.deadUntil =
      m.worldEvent || m.dungeonEvent || m.dungeonPatrol || m.dungeonId
        ? Infinity
        : Date.now() +
          Math.max(
            10,
            Number.isFinite(Number(m.respawn)) && Number(m.respawn) > 0
              ? Number(m.respawn)
              : 30,
          ) *
            1000;
    const eligible = Object.keys(m.attackers || {});
    const pile = {
      id: uid("loot"),
      zone: m.zone,
      x: m.x,
      y: m.y,
      icon: "👜",
      name: `${m.name} loot`,
      sourceMobType: m.type,
      skinnable: (m.drops || []).some((d: any) =>
        String(d.item || "").includes("wolf_fang"),
      ),
      gold: m.gold,
      items: (m.drops || [])
        .filter((d: any) => Math.random() < Number(d.chance ?? 1))
        .map((d: any) => ({ itemId: d.item, qty: d.qty || 1 })),
      eligible,
      createdAt: Date.now(),
      expiresAt: Date.now() + 120000,
    };
    this.world.lootPiles.set(pile.id, pile);
    m.aggroTarget = null;
    m.returning = false;
    let nextTarget = null;
    if (p) {
      p.combat = p.combat || {};
      nextTarget = this.selectNextAggroTarget(p, m.id);
      if (nextTarget) {
        const manualOwner = Boolean(
          p.combat?.manualMove || p.moveInput || p.movementIntent === "manual",
        );
        const promotedRangeNorm = this.world.normalizedMeters(
          p.zone,
          classBasicAttackRangeMeters(p.classId),
        );
        const promotedInRange =
          Math.hypot(p.x - nextTarget.x, p.y - nextTarget.y) <=
          promotedRangeNorm;
        this.establishWorldCombat(p, nextTarget, {
          autoAttack: true,
          approachRangeMeters: classBasicAttackRangeMeters(p.classId),
          approachSatisfied: promotedInRange,
          threat: 0,
          keepManualMove: manualOwner,
        });
        if (manualOwner) {
          p.combat.manualMove = true;
          p.combat.autoApproach = false;
          p.movementIntent = "manual";
        } else if (promotedInRange) {
          p.combat.autoApproach = false;
          p.movementIntent = "combat";
          p.targetX = p.x;
          p.targetY = p.y;
          p.moveState = "idle";
        } else {
          p.combat.autoApproach = true;
          p.movementIntent = "combat";
          p.movementMode = "run";
          const ap = this.world.approachPoint(
            p,
            nextTarget,
            classBasicAttackRangeMeters(p.classId),
          );
          p.targetX = ap.x;
          p.targetY = ap.y;
          p.moveState = "moving";
        }
      } else {
        p.worldCombatMobId = null;
        p.targetMobId = null;
        p.combat.autoAttack = false;
        p.combat.autoApproach = false;
        p.combat.queuedWorldAbility = null;
        p.combat.approachSatisfied = false;
      }
    }
    return [
      true,
      {
        killed: true,
        enemyId: m.type,
        mobId: m.id,
        x: m.x,
        y: m.y,
        xp: m.xp,
        gold: m.gold,
        lootPile: pile,
        participants: eligible,
        nextTargetId: nextTarget?.id || null,
      },
    ];
  }

  attackMob(p, mobId, damage, rangeMeters = COMBAT_RANGES.meleeMeters) {
    const m = this.world.byIdMob(mobId);
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !this.world.sameDungeonInstance(m, p)
    )
      return [false, "That creature is not here."];
    const allowedRange = this.world.normalizedMeters(
      p.zone,
      Math.max(0, Number(rangeMeters) || COMBAT_RANGES.meleeMeters),
    );
    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    if (dist > allowedRange)
      return [
        false,
        Number(rangeMeters) > COMBAT_RANGES.meleeMeters
          ? "Out of ability range."
          : "Out of melee range.",
      ];
    this.world.enterWorldCombat(p, m);
    this.world.addMobThreat(m, p, Math.max(1, damage));
    m.state = "engaged";
    m.returning = false;
    m.hp = Math.max(0, m.hp - damage);
    if (m.hp <= 0) return this.world.finalizeMobDeath(p, m);
    return [true, { killed: false, mob: { id: m.id, hp: m.hp } }];
  }

  provokeMob(p, m) {
    if (
      !m ||
      m.state === "dead" ||
      m.zone !== p.zone ||
      !this.world.sameDungeonInstance(m, p)
    )
      return false;
    this.world.enterWorldCombat(p, m);
    this.world.addMobThreat(m, p, 1);
    m.state = "engaged";
    m.returning = false;
    return true;
  }

  disengagePlayer(p) {
    const id = p.worldCombatMobId || p.targetMobId;
    if (!id) return [false, "Not fighting a world mob."];
    const m = this.world.byIdMob(id);
    this.clearWorldCombat(p, m, {
      clearTarget: false,
      clearMovementIntent: true,
    });
    if (m) {
      m.ignoredAggroPlayers = m.ignoredAggroPlayers || {};
      m.ignoredAggroPlayers[p.id] = Date.now() + 8000;
    }
    return [true, "You broke away from the creature."];
  }

  pickupLoot(p, pileId) {
    const pile = this.world.lootPiles.get(pileId);
    if (!pile || pile.zone !== p.zone) return [false, "That loot is gone."];
    if (Date.now() > pile.expiresAt) {
      this.world.lootPiles.delete(pileId);
      return [false, "The loot has vanished."];
    }
    if (!pile.eligible.includes(p.id))
      return [false, "You did not participate in that kill."];
    if (p.worldCombatMobId || p.targetMobId) {
      const combatMob = this.world.byIdMob(p.worldCombatMobId || p.targetMobId);
      if (combatMob) {
        combatMob.attackers = combatMob.attackers || {};
        delete combatMob.attackers[p.id];
        if (combatMob.aggroTarget === p.id) combatMob.aggroTarget = null;
        if (
          !Object.keys(combatMob.attackers || {}).length &&
          combatMob.state !== "dead"
        ) {
          combatMob.state = "returning";
          combatMob.returning = true;
          combatMob.velocityX = 0;
          combatMob.velocityY = 0;
        }
      }
      p.worldCombatMobId = null;
      p.targetMobId = null;
      p.combat.autoAttack = false;
      p.combat.autoApproach = false;
      p.combat.queuedWorldAbility = null;
    }
    if (
      Math.hypot(p.x - pile.x, p.y - pile.y) >
      this.world.normalizedMeters(p.zone, 10)
    ) {
      p.pendingLoot = pile.id;
      p.movementIntent = "interaction";
      p.targetX = pile.x;
      p.targetY = pile.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [true, { approaching: true, message: "Moving to loot." }];
    }
    this.world.lootPiles.delete(pile.id);
    let items = [...(pile.items || [])];
    if (p.professions?.includes("skinning") && pile.skinnable) {
      const extra = Math.random() < 0.2 ? 2 : 1;
      const existing = items.find((x: any) => x.itemId === "wolf_fang");
      if (existing) existing.qty += extra;
      else items.push({ itemId: "wolf_fang", qty: extra });
    }
    return [true, { gold: pile.gold, items }];
  }
}
export { WorldCombatService };
