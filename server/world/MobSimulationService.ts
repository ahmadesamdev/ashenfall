import { threatOvertakeFactor } from "../combat/CombatTable.js";
import { mitigationMultiplier } from "../combat/CombatFormula.js";
import { applyIncomingPartyDamage } from "../combat/PartyCombat.js";
import { COMBAT_RANGES } from "../combat/CombatRanges.js";

export class MobSimulationService {
  private readonly world: any;
  constructor(world: any) {
    this.world = world;
  }

  update(dt: number, players: any[]) {
    const now = Date.now();
    this.world.mobBehavior?.cleanupEncounters(now);
    const activePlayersByZone = new Map<string, any[]>();
    for (const pl of players) {
      if (!pl?.online || pl.dead) continue;
      const list = activePlayersByZone.get(pl.zone) || [];
      list.push(pl);
      activePlayersByZone.set(pl.zone, list);
    }
    const activeZones = new Set(activePlayersByZone.keys());
    for (const o of this.world.ores.values()) {
      if (o.state === "depleted" && now >= o.respawnAt) {
        o.state = "ready";
        o.claimedBy = null;
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (o.spawnRadius || 0.03);
        o.x = Math.max(
          0.05,
          Math.min(0.95, (o.spawnX ?? o.x) + Math.cos(angle) * radius),
        );
        o.y = Math.max(
          0.06,
          Math.min(0.94, (o.spawnY ?? o.y) + Math.sin(angle) * radius),
        );
      }
    }
    for (const m of this.world.mobs.values()) {
      if (m.state === "dead") {
        if (m.dungeonId) continue;
        if (now >= m.deadUntil) {
          const a = m.spawnArea || { x: m.homeX, y: m.homeY, r: 0.02 };
          const ang = Math.random() * Math.PI * 2,
            rr =
              Math.sqrt(Math.random()) *
              Math.max(0.01, Number(a.r || 0.02)) *
              0.72;
          m.hp = m.maxHp;
          m.x = Math.max(
            0.02,
            Math.min(0.98, Number(a.x || m.homeX) + Math.cos(ang) * rr),
          );
          m.y = Math.max(
            0.03,
            Math.min(0.97, Number(a.y || m.homeY) + Math.sin(ang) * rr),
          );
          m.targetX = m.x;
          m.targetY = m.y;
          m.state = "idle";
          m.aggroTarget = null;
          m.attackers = {};
          m.stunnedUntil = 0;
          m.returning = false;
          m.statuses = [];
          m.velocityX = 0;
          m.velocityY = 0;
          m.behavior &&
            ((m.behavior.encounterId = null),
            (m.behavior.assistCommitted = false),
            (m.behavior.alertedUntil = 0));
          m.wanderUntil = now + 1000 + Math.random() * 2000;
        }
        continue;
      }
      if (!activeZones.has(m.zone)) {
        m.velocityX = 0;
        m.velocityY = 0;
        continue;
      }
      const zonePlayers = activePlayersByZone.get(m.zone) || [];
      if (
        !m.aggroTarget &&
        !(m.attackers && Object.keys(m.attackers).length) &&
        !["engaged", "returning", "fleeing", "investigating"].includes(
          String(m.state || ""),
        )
      ) {
        const simRadius = this.world.normalizedMeters(m.zone, 800);
        const nearActivePlayer = zonePlayers.some(
          (pl: any) => Math.hypot(pl.x - m.x, pl.y - m.y) <= simRadius,
        );
        if (!nearActivePlayer) {
          m.velocityX = 0;
          m.velocityY = 0;
          continue;
        }
      }
      m.ignoredAggroPlayers = m.ignoredAggroPlayers || {};
      const ignoredPlayer = (id) =>
        Number(m.ignoredAggroPlayers[id] || 0) > now;
      let target = m.aggroTarget
        ? players.find((p) => p.id === m.aggroTarget)
        : null;
      if (target && ignoredPlayer(target.id)) {
        m.aggroTarget = null;
        target = null;
      }
      const leashOriginX = Number.isFinite(m.leashOriginX)
        ? m.leashOriginX
        : m.homeX;
      const leashOriginY = Number.isFinite(m.leashOriginY)
        ? m.leashOriginY
        : m.homeY;
      const configuredLeashMeters = Number(m.leashRadius || 0);
      const leashMeters = Math.max(
        90,
        configuredLeashMeters > 1
          ? configuredLeashMeters
          : COMBAT_RANGES.disengageMeters,
      );
      const leashNorm = this.world.normalizedMeters(m.zone, leashMeters);
      const mobBeyondLeash =
        Math.hypot(m.x - leashOriginX, m.y - leashOriginY) > leashNorm;
      const clearLeashCombat = (attacker: any) => {
        if (!attacker) return;
        const wasFightingMob =
          attacker.worldCombatMobId === m.id || attacker.targetMobId === m.id;
        if (attacker.worldCombatMobId === m.id)
          attacker.worldCombatMobId = null;
        if (wasFightingMob) {
          attacker.combat.manualMove = true;
          attacker.combat.autoAttack = false;
          attacker.combat.autoApproach = false;
          attacker.combat.queuedWorldAbility = null;
          attacker.combat.approachSatisfied = false;
          if (attacker.movementIntent === "combat")
            attacker.movementIntent =
              attacker.moveInput || attacker.combat.manualMove
                ? "manual"
                : "none";
        }
      };
      if (mobBeyondLeash) {
        for (const attackerId of Object.keys(m.attackers || {})) {
          const attacker = players.find((x: any) => x.id === attackerId);
          if (attacker) m.ignoredAggroPlayers[attackerId] = now + 8000;
          clearLeashCombat(attacker);
        }
        m.attackers = {};
        m.aggroTarget = null;
        m.state = "returning";
        m.returning = true;
        m.velocityX = 0;
        m.velocityY = 0;
        target = null;
      } else {
        for (const attackerId of Object.keys(m.attackers || {})) {
          const attacker = players.find((x: any) => x.id === attackerId);
          const invalid =
            !attacker ||
            !attacker.online ||
            attacker.dead ||
            attacker.hp <= 0 ||
            attacker.zone !== m.zone ||
            ignoredPlayer(attackerId);
          const beyondPlayerLeash =
            !!attacker &&
            Math.hypot(attacker.x - leashOriginX, attacker.y - leashOriginY) >
              leashNorm;
          if (invalid || beyondPlayerLeash) {
            delete m.attackers[attackerId];
            if (beyondPlayerLeash)
              m.ignoredAggroPlayers[attackerId] = now + 8000;
            clearLeashCombat(attacker);
            if (m.aggroTarget === attackerId) m.aggroTarget = null;
            if (target?.id === attackerId) target = null;
          }
        }
      }
      if (target && !m.attackers?.[target.id]) target = null;
      if (
        !target ||
        !target.online ||
        target.zone !== m.zone ||
        target.hp <= 0 ||
        target.dead
      ) {
        const leashCleanupMeters = Math.max(
          90,
          Number(m.leashRadius || 0) > 1
            ? Number(m.leashRadius)
            : COMBAT_RANGES.disengageMeters,
        );
        const leashCleanupNorm = this.world.normalizedMeters(
          m.zone,
          leashCleanupMeters,
        );
        for (const candidate of zonePlayers) {
          if (candidate.targetMobId !== m.id) continue;
          if (
            candidate.combat?.autoApproach &&
            !candidate.combat?.manualMove &&
            !candidate.worldCombatMobId
          )
            continue;
          const fromHome = Math.hypot(
            candidate.x - m.homeX,
            candidate.y - m.homeY,
          );
          if (
            fromHome > leashCleanupNorm ||
            Math.hypot(candidate.x - m.x, candidate.y - m.y) > leashCleanupNorm
          ) {
            candidate.worldCombatMobId = null;
            candidate.combat.manualMove = true;
            candidate.combat.autoAttack = false;
            candidate.combat.autoApproach = false;
            candidate.combat.queuedWorldAbility = null;
            candidate.combat.approachSatisfied = false;
            if (candidate.movementIntent === "combat")
              candidate.movementIntent =
                candidate.moveInput || candidate.combat.manualMove
                  ? "manual"
                  : "none";
          }
        }
        for (const id of Object.keys(m.attackers || {})) {
          const threatPlayer = players.find((x: any) => x.id === id);
          if (
            !threatPlayer ||
            !threatPlayer.online ||
            threatPlayer.dead ||
            threatPlayer.hp <= 0 ||
            threatPlayer.zone !== m.zone ||
            ignoredPlayer(id)
          )
            delete m.attackers[id];
        }
        const cand: any[] = Object.entries(m.attackers || {})
          .map(([id, v]) => ({
            p: zonePlayers.find((x: any) => x.id === id),
            threat: Number(v) || 0,
          }))
          .filter(
            (x) =>
              x.p &&
              x.p.online &&
              x.p.zone === m.zone &&
              !x.p.dead &&
              !ignoredPlayer(x.p.id) &&
              this.world.sameDungeonInstance(m, x.p),
          );
        cand.sort((a, b) => b.threat - a.threat);
        const best = cand[0];
        const currentEntry = cand.find((x) => x.p.id === m.aggroTarget);
        if (best) {
          const challengerInMelee =
            Math.hypot(best.p.x - m.x, best.p.y - m.y) <=
            this.world.normalizedMeters(m.zone, COMBAT_RANGES.meleeMeters);
          target =
            currentEntry &&
            currentEntry.threat > 0 &&
            best.p.id !== currentEntry.p.id &&
            best.threat <
              currentEntry.threat * threatOvertakeFactor(challengerInMelee)
              ? currentEntry.p
              : best.p;
          m.aggroTarget = target.id;
        } else {
          target = null;
          m.aggroTarget = null;
        }
      }
      const regional = this.world.regionalMobModifier(m, now);
      if (
        !target &&
        m.temper === "aggressive" &&
        !this.world.isSafeWorldEntry(m.zone, m.x, m.y)
      ) {
        const traversal = this.world.regionalTraversalFor(m.zone);
        const nearby = zonePlayers
          .filter(
            (p: any) =>
              !ignoredPlayer(p.id) && this.world.sameDungeonInstance(m, p),
          )
          .map((p) => {
            const roadDistance = this.world.distanceToRoadFor(p);
            const onRoad =
              roadDistance <= this.world.normalizedMeters(p.zone, 18);
            const multiplier = Number(
              onRoad
                ? traversal.roadAggroMultiplier
                : traversal.offRoadAggroMultiplier,
            );
            const aggroMeters = Math.max(
              1,
              Number(m.aggroRangeMeters || COMBAT_RANGES.mobAggroMeters) *
                multiplier,
            );
            return { p, d: Math.hypot(p.x - m.x, p.y - m.y), aggroMeters };
          })
          .filter(
            (x) => x.d <= this.world.normalizedMeters(m.zone, x.aggroMeters),
          )
          .sort((a, b) => a.d - b.d);
        const c = nearby[0];
        if (c) {
          target = c.p;
          this.world.addMobThreat(m, c.p, 1);
          const wasReturning = !!m.returning || m.state === "returning";
          m.state = "engaged";
          m.returning = false;
          m.wanderUntil = now + 60000;
          if (!wasReturning) {
            m.leashOriginX = m.x;
            m.leashOriginY = m.y;
          }
        }
      }
      const behaviorDecision = this.world.mobBehavior?.prepare(
        m,
        target,
        zonePlayers,
        now,
      ) || { flee: false };
      if (behaviorDecision.flee || m.state === "fleeing") {
        this.world.mobBehavior.updateFlee(m, dt, now);
        continue;
      }
      if (!target && m.state === "investigating") {
        this.world.mobBehavior.updateInvestigating(m, dt, now);
        continue;
      }
      if (!target && m.state === "engaged") {
        m.state = "returning";
        m.returning = true;
        m.aggroTarget = null;
        m.velocityX = 0;
        m.velocityY = 0;
        m.attackers = {};
        m.outOfCombatSince = Number(m.outOfCombatSince || now);
      }
      if (target) {
        m.state = "engaged";
        m.returning = false;
        m.outOfCombatSince = 0;
        m.runtimeDamageMultiplier =
          Number(m.baseRuntimeDamageMultiplier || 1) * regional.damage;
        m.runtimeSpeedMultiplier =
          Number(m.baseRuntimeSpeedMultiplier || 1) * regional.speed;
        if (m.rare) {
          const hpRatio = Number(m.hp || 0) / Math.max(1, Number(m.maxHp || 1));
          const enraged = hpRatio <= 0.3;
          m.enraged = enraged;
          m.runtimeDamageMultiplier *= enraged ? 1.35 : 1;
          m.runtimeSpeedMultiplier *= enraged ? 1.18 : 1;
        }
        if (now < m.stunnedUntil) continue;
        const originX = Number.isFinite(m.leashOriginX)
          ? m.leashOriginX
          : m.homeX;
        const originY = Number.isFinite(m.leashOriginY)
          ? m.leashOriginY
          : m.homeY;
        const playerFromPull = Math.hypot(
          target.x - originX,
          target.y - originY,
        );
        const mobFromPull = Math.hypot(m.x - originX, m.y - originY);
        const configuredLeashMeters = Number(m.leashRadius || 0);
        const leashMeters = Math.max(
          90,
          configuredLeashMeters > 1
            ? configuredLeashMeters
            : COMBAT_RANGES.disengageMeters,
        );
        const leashNorm = this.world.normalizedMeters(m.zone, leashMeters);
        if (playerFromPull > leashNorm || mobFromPull > leashNorm) {
          m.ignoredAggroPlayers = m.ignoredAggroPlayers || {};
          const ignoredUntil = now + 8000;
          if (mobFromPull > leashNorm) {
            for (const attackerId of Object.keys(m.attackers || {})) {
              const attacker = players.find((x: any) => x.id === attackerId);
              if (attacker) m.ignoredAggroPlayers[attacker.id] = ignoredUntil;
            }
            m.attackers = {};
            m.state = "returning";
            m.returning = true;
            m.aggroTarget = null;
            m.velocityX = 0;
            m.velocityY = 0;
          } else {
            delete m.attackers[target.id];
            m.ignoredAggroPlayers[target.id] = ignoredUntil;
            if (m.aggroTarget === target.id) m.aggroTarget = null;
          }
          if (target.worldCombatMobId === m.id || target.targetMobId === m.id) {
            target.worldCombatMobId = null;
            target.combat.manualMove = true;
            target.combat.autoAttack = false;
            target.combat.autoApproach = false;
            target.combat.queuedWorldAbility = null;
            target.combat.approachSatisfied = false;
            target.movementIntent =
              target.moveInput || target.combat.manualMove ? "manual" : "none";
          }
          if (Object.keys(m.attackers || {}).length) {
            const remaining = Object.entries(m.attackers)
              .map(([id, v]) => ({
                p: zonePlayers.find((x: any) => x.id === id),
                threat: Number(v) || 0,
              }))
              .filter(
                (x: any) =>
                  x.p &&
                  !x.p.dead &&
                  x.p.online &&
                  x.p.zone === m.zone &&
                  !ignoredPlayer(x.p.id) &&
                  this.world.sameDungeonInstance(m, x.p),
              )
              .sort((a: any, b: any) => b.threat - a.threat);
            const next = remaining[0]?.p;
            if (next) {
              this.world.engageMobAgainstPlayer?.(next, m);
              m.aggroTarget = next.id;
              target = next;
              m.state = "engaged";
              m.returning = false;
              m.outOfCombatSince = 0;
            } else {
              m.attackers = {};
              m.aggroTarget = null;
              m.state = "returning";
              m.returning = true;
              m.outOfCombatSince = now;
            }
          } else if (mobFromPull <= leashNorm) {
            m.aggroTarget = null;
            m.state = "returning";
            m.returning = true;
            m.outOfCombatSince = now;
          }
        } else {
          let d = Math.hypot(target.x - m.x, target.y - m.y);
          const attackRange = this.world.normalizedMeters(
            m.zone,
            Number(m.attackRangeMeters || COMBAT_RANGES.meleeMeters),
          );
          const attackRangeEpsilon = this.world.normalizedMeters(m.zone, 0.1);
          if (m.behavior?.kiting) {
            const kd = Math.hypot(m.targetX - m.x, m.targetY - m.y);
            if (kd > 0.002) {
              const baseKiteSpeed = Math.max(8, Number(m.speedMeters || 5.5));
              const effectiveKiteSpeed =
                baseKiteSpeed * Number(m.runtimeSpeedMultiplier || 1);
              const kstep =
                (effectiveKiteSpeed * dt) / this.world.worldMetersFor(m.zone);
              const kr = this.world.resolveWalkableStep(
                m.zone,
                m.x,
                m.y,
                m.x + ((m.targetX - m.x) / kd) * kstep,
                m.y + ((m.targetY - m.y) / kd) * kstep,
                m,
              );
              m.velocityX = (kr.x - m.x) / Math.max(dt, 0.001);
              m.velocityY = (kr.y - m.y) / Math.max(dt, 0.001);
              m.x = kr.x;
              m.y = kr.y;
              d = Math.hypot(target.x - m.x, target.y - m.y);
            }
          }
          if (!m.behavior?.kiting && d > attackRange + attackRangeEpsilon) {
            const baseSpeed =
              Number(m.speedMeters || 5.5) *
              Number(m.runtimeSpeedMultiplier || 1);
            const effectiveSpeed =
              Math.max(m.temper === "aggressive" ? 18 : 10, baseSpeed) /
              this.world.worldMetersFor(m.zone);
            const step = Math.min(
              effectiveSpeed * Math.max(0, dt),
              Math.max(0, d - attackRange),
            );
            const nx = (target.x - m.x) / Math.max(d, 0.001),
              ny = (target.y - m.y) / Math.max(d, 0.001);
            const next = this.world.resolveWalkableStep(
              m.zone,
              m.x,
              m.y,
              m.x + nx * step,
              m.y + ny * step,
              m,
            );
            m.velocityX = dt > 0 ? (next.x - m.x) / dt : 0;
            m.velocityY = dt > 0 ? (next.y - m.y) / dt : 0;
            m.x = next.x;
            m.y = next.y;
            d = Math.hypot(target.x - m.x, target.y - m.y);
          }
          if (d <= attackRange + attackRangeEpsilon) {
            d = Math.hypot(target.x - m.x, target.y - m.y);
            m.targetX = m.x;
            m.targetY = m.y;
            m.velocityX = 0;
            m.velocityY = 0;
            if (now - (m.lastAttack || 0) > 1800) {
              m.lastAttack = now;
              const guard = target.combat?.guardUntil > now ? 0.7 : 1;
              const shieldWall =
                target.combat?.shieldWallUntil > now ? 0.55 : 1;
              const barrier = target.combat?.barrierUntil > now ? 0.55 : 1;
              const rawDmg = Math.max(
                1,
                Math.round(
                  m.attack *
                    Number(m.runtimeDamageMultiplier || 1) *
                    mitigationMultiplier(
                      target.armor,
                      Number(m.level || target.level || 1),
                    ) *
                    guard *
                    shieldWall *
                    barrier,
                ),
              );
              const incoming = applyIncomingPartyDamage(
                target,
                rawDmg,
                now,
                Math.random,
                {
                  avoidable: true,
                  attackerLevel: Number(m.level || target.level || 1),
                },
              );
              const dmg = incoming.damage;
              target._lastDamageAt = now;
              target._hpRegenAt = now;
              target.hp = Math.max(0, target.hp - dmg);
              if (incoming.blocked) {
                target.worldCombatLog = target.worldCombatLog || [];
                target.worldCombatLog.push({
                  t: new Date().toLocaleTimeString(),
                  msg: `🛡️ You block ${m.name}'s attack.`,
                });
              }
              if (incoming.avoided) {
                target.combatFx = target.combatFx || [];
                target.combatFx.push({
                  id: `fx_${Date.now()}_${Math.random()}`,
                  type: "avoid",
                  outcome: incoming.avoided,
                  source: m.id,
                  target: target.id,
                  at: Date.now(),
                  expiresAt: Date.now() + 900,
                  abilityName: m.name,
                });
                if (target.combatFx.length > 16) target.combatFx.shift();
                target.worldCombatLog = target.worldCombatLog || [];
                target.worldCombatLog.push({
                  t: new Date().toLocaleTimeString(),
                  msg:
                    incoming.avoided === "dodge"
                      ? `💨 You dodge ${m.name}'s attack.`
                      : `💨 ${m.name} misses you.`,
                });
                target.worldCombatLog = target.worldCombatLog.slice(-80);
              } else {
                target.combatFx = target.combatFx || [];
                target.combatFx.push({
                  id: `fx_${Date.now()}_${Math.random()}`,
                  type: "hit",
                  source: m.id,
                  target: target.id,
                  at: Date.now(),
                  expiresAt: Date.now() + 520,
                  amount: dmg,
                  abilityName: m.name,
                  blocked: !!incoming.blocked,
                });
                target.combatFx.push({
                  id: `fx_${Date.now()}_${Math.random()}`,
                  type: "damage",
                  source: m.id,
                  target: target.id,
                  at: Date.now(),
                  expiresAt: Date.now() + 900,
                  amount: dmg,
                  abilityName: m.name,
                  blocked: !!incoming.blocked,
                });
                if (target.combatFx.length > 16) target.combatFx.shift();
                target.worldCombatLog = target.worldCombatLog || [];
                target.worldCombatLog.push({
                  t: new Date().toLocaleTimeString(),
                  msg: `👹 ${m.name} hits you for ${dmg}.`,
                });
                target.worldCombatLog = target.worldCombatLog.slice(-80);
              }
              if (target.hp <= 0) {
                target.dead = true;
                target.respawnAt = Date.now() + 5000;
                target.respawnReady = false;
                target.respawnMessage = `You were slain by ${m.name}.`;
                target.worldCombatMobId = null;
                target.targetMobId = null;
                target.targetPlayerId = null;
                target.moveInput = null;
                target.targetX = target.x;
                target.targetY = target.y;
                target.velocityX = 0;
                target.velocityY = 0;
                target.moveState = "idle";
                target.combat.autoAttack = false;
                target.combat.autoApproach = false;
                target.combat.manualMove = false;
                target.combat.queuedWorldAbility = null;
                target.combat.queuedAbility = null;
              }
            }
          }
        }
      } else if (m.state === "engaged") {
        m.state = "returning";
        m.returning = true;
        m.aggroTarget = null;
        m.velocityX = 0;
        m.velocityY = 0;
      }
      if (m.state === "returning") {
        const d = Math.hypot(m.homeX - m.x, m.homeY - m.y);
        if (d > 0.001) {
          const step =
            (Math.max(8, Number(m.speedMeters || 5.5)) /
              this.world.worldMetersFor(m.zone)) *
            0.65 *
            dt;
          const nx = (m.homeX - m.x) / Math.max(d, 0.001),
            ny = (m.homeY - m.y) / Math.max(d, 0.001);
          const next = this.world.resolveWalkableStep(
            m.zone,
            m.x,
            m.y,
            m.x + nx * step,
            m.y + ny * step,
            m,
          );
          m.velocityX = dt > 0 ? (next.x - m.x) / dt : 0;
          m.velocityY = dt > 0 ? (next.y - m.y) / dt : 0;
          m.x = next.x;
          m.y = next.y;
        }
        const homeDistance = this.world.combatReturnDistanceNormalized(m.zone);
        if (!m.aggroTarget && Object.keys(m.attackers || {}).length === 0) {
          m.outOfCombatSince = Number(m.outOfCombatSince || now);
          const elapsed = Math.max(0, now - m.outOfCombatSince);
          if (elapsed >= 1200) {
            const regenPerSecond = Math.max(1, Number(m.maxHp || 1) * 0.22);
            m.hp = Math.min(m.maxHp, Number(m.hp || 0) + regenPerSecond * dt);
          }
        } else m.outOfCombatSince = 0;
        if (d <= homeDistance) {
          m.x = m.homeX;
          m.y = m.homeY;
          m.velocityX = 0;
          m.velocityY = 0;
          if (
            !m.aggroTarget &&
            Object.keys(m.attackers || {}).length === 0 &&
            Number(m.hp || 0) >= Number(m.maxHp || 1)
          ) {
            m.hp = m.maxHp;
            m.state = "idle";
            m.returning = false;
            m.outOfCombatSince = 0;
            m.statuses = [];
            m.attackers = {};
            m.aggroTarget = null;
            m.ignoredAggroPlayers = {};
            m.leashOriginX = m.homeX;
            m.leashOriginY = m.homeY;
            m.behavior &&
              ((m.behavior.encounterId = null),
              (m.behavior.assistCommitted = false),
              (m.behavior.alertedUntil = 0));
          }
        }
      }
      if (m.state === "idle" && !m.roaming && now > m.wanderUntil) {
        const a = m.spawnArea || { x: 0.5, y: 0.5, r: 0.2 };
        m.targetX = Math.max(
          0.04,
          Math.min(0.96, a.x + (Math.random() - 0.5) * 2 * a.r),
        );
        m.targetY = Math.max(
          0.05,
          Math.min(0.95, a.y + (Math.random() - 0.5) * 2 * a.r),
        );
        m.wanderUntil = now + 1800 + Math.random() * 3500;
      }
      if (m.state === "idle" && !m.roaming) {
        const d = Math.hypot(m.targetX - m.x, m.targetY - m.y);
        if (d > 0.003) {
          const step =
            (Math.max(3.5, Number(m.speedMeters || 5.5)) /
              this.world.worldMetersFor(m.zone)) *
            0.7 *
            dt;
          const nx = (m.targetX - m.x) / d,
            ny = (m.targetY - m.y) / d;
          const next = this.world.resolveWalkableStep(
            m.zone,
            m.x,
            m.y,
            m.x + nx * step,
            m.y + ny * step,
            m,
          );
          m.velocityX = dt > 0 ? (next.x - m.x) / dt : 0;
          m.velocityY = dt > 0 ? (next.y - m.y) / dt : 0;
          m.x = next.x;
          m.y = next.y;
        }
      }
    }
    const cellSize = 0.012;
    const grids = new Map();
    for (const m of this.world.mobs.values()) {
      if (m.state === "dead" || !activeZones.has(m.zone)) continue;
      const key = `${m.zone}:${Math.floor(m.x / cellSize)}:${Math.floor(m.y / cellSize)}`;
      let bucket = grids.get(key);
      if (!bucket) {
        bucket = [];
        grids.set(key, bucket);
      }
      bucket.push(m);
    }
    for (const [key, bucket] of grids) {
      const [zone, cxRaw, cyRaw] = key.split(":");
      const cx = Number(cxRaw),
        cy = Number(cyRaw);
      const candidates: any[] = [];
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          const b = grids.get(`${zone}:${cx + ox}:${cy + oy}`);
          if (b) candidates.push(...b);
        }
      for (const a of bucket) {
        for (const b of candidates) {
          if (a.id >= b.id) continue;
          if (a.state === "engaged" || b.state === "engaged") continue;
          const dx = b.x - a.x,
            dy = b.y - a.y,
            d = Math.hypot(dx, dy) || 0.0001;
          const min = Math.max(
            0.0012,
            (a.radius || 0.018) * 0.045 + (b.radius || 0.018) * 0.045 + 0.00035,
          );
          if (d < min) {
            const push = Math.min((min - d) / 2, 0.0007),
              ux = dx / d,
              uy = dy / d;
            a.x = Math.max(0.01, Math.min(0.99, a.x - ux * push));
            a.y = Math.max(0.01, Math.min(0.99, a.y - uy * push));
            b.x = Math.max(0.01, Math.min(0.99, b.x + ux * push));
            b.y = Math.max(0.01, Math.min(0.99, b.y + uy * push));
            const avx = Number(a.velocityX || 0),
              avy = Number(a.velocityY || 0),
              ain = avx * ux + avy * uy;
            if (ain > 0) {
              a.velocityX = avx - ux * ain;
              a.velocityY = avy - uy * ain;
            }
            const bvx = Number(b.velocityX || 0),
              bvy = Number(b.velocityY || 0),
              bin = bvx * ux + bvy * uy;
            if (bin < 0) {
              b.velocityX = bvx - ux * bin;
              b.velocityY = bvy - uy * bin;
            }
          }
        }
      }
    }
  }
}
