const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export class MobBehaviorEngine {
  world: any;
  profiles: any;
  encounters: Map<string, any> = new Map();
  nextEncounter = 1;
  combatFleeEnabled = true;

  constructor(world: any, profiles: any = {}, options: any = {}) {
    this.world = world;
    this.profiles = profiles || {};
    this.combatFleeEnabled = options?.combatFleeEnabled !== false;
  }

  profileFor(def: any) {
    const key = String(
      def?.behaviorProfile || def?.aiBehavior || "territorial",
    );
    return {
      key,
      config: this.profiles[key] || this.profiles.territorial || {},
    };
  }

  initialize(m: any, def: any) {
    const info = this.profileFor(def),
      c = info.config;
    m.behaviorProfile = info.key;
    m.state = m.state || "idle";
    m.faction = def?.faction || c.faction || "wilds";
    m.behavior = m.behavior || {};
    m.behavior.profile = info.key;
    m.behavior.socialAssist = Boolean(c.socialAssist);
    m.behavior.assistRangeMeters = Number(
      def?.assistRangeMeters ?? c.assistRangeMeters ?? 0,
    );
    m.behavior.reinforcementCost = Number(
      def?.reinforcementCost ?? c.reinforcementCost ?? 1,
    );
    m.behavior.allowCombatFlee =
      this.combatFleeEnabled && def?.allowCombatFlee !== false;
    m.behavior.fleeAtHp = Number(def?.fleeAtHp ?? c.fleeAtHp ?? 0);
    m.behavior.maxFleeCycles = Math.max(
      0,
      Number(
        def?.maxFleeCycles ??
          c.maxFleeCycles ??
          (m.behavior.fleeAtHp > 0 ? 2 : 0),
      ),
    );
    m.behavior.fleeCount = 0;
    m.behavior.preferredRangeMeters = Number(
      def?.preferredRangeMeters ??
        (c.preferredRangeFactor
          ? m.attackRangeMeters * c.preferredRangeFactor
          : 0),
    );
    m.behavior.retreatRangeMeters = Number(
      def?.retreatRangeMeters ??
        (c.retreatRangeFactor ? m.attackRangeMeters * c.retreatRangeFactor : 0),
    );
    m.behavior.kiteEnabled = Boolean(def?.kiteEnabled ?? c.kite);
    m.behavior.maxKiteCycles = Number(def?.maxKiteCycles ?? c.kiteCycles ?? 0);
    m.behavior.kiteDurationMs = Number(
      def?.kiteDurationMs ?? c.kiteDurationMs ?? 0,
    );
    m.behavior.kiteCooldownMs = Number(
      def?.kiteCooldownMs ?? c.kiteCooldownMs ?? 0,
    );
    m.behavior.commitMs = Number(def?.commitMs ?? c.commitMs ?? 0);
    m.behavior.investigateMeters = Number(
      def?.investigateMeters ?? c.investigateMeters ?? 40,
    );
    m.behavior.alertCooldownMs = Number(
      def?.alertCooldownMs ?? c.alertCooldownMs ?? 6500,
    );
    m.behavior.assistCooldownMs = Number(
      def?.assistCooldownMs ?? c.assistCooldownMs ?? 6500,
    );
    m.behavior.lastAlertAt = 0;
    m.behavior.lastThreatX = m.x;
    m.behavior.lastThreatY = m.y;
    m.behavior.lastThreatAt = 0;
    m.behavior.fleeUntil = 0;
    m.behavior.fleeStartedAt = 0;
    m.behavior.kiteUntil = 0;
    m.behavior.kiteCooldownUntil = 0;
    m.behavior.kiteCycles = 0;
    m.behavior.commitUntil = 0;
    m.behavior.alertedUntil = 0;
    m.behavior.alertTargetId = null;
    m.behavior.encounterId = null;
    m.behavior.assistCommitted = false;
    return m;
  }

  recordThreat(m: any, p: any) {
    if (!m?.behavior || !p) return;
    m.behavior.lastThreatX = Number(p.x) || m.x;
    m.behavior.lastThreatY = Number(p.y) || m.y;
    m.behavior.lastThreatAt = Date.now();
  }

  shouldFlee(m: any, now: number) {
    const ratio = Number(m.hp || 0) / Math.max(1, Number(m.maxHp || 1));
    const threshold = Number(m.behavior?.fleeAtHp || 0);
    const maxCycles = Math.max(0, Number(m.behavior?.maxFleeCycles || 0));
    if (!threshold || maxCycles <= 0 || m.leader || m.rare || m.worldEvent)
      return false;
    if (Number(m.behavior?.fleeCount || 0) >= maxCycles) return false;
    if (ratio <= threshold) {
      m.behavior.fleeUntil = Math.max(
        Number(m.behavior.fleeUntil || 0),
        now + 6500,
      );
      return true;
    }
    return (
      Number(m.behavior?.fleeUntil || 0) > now &&
      Number(m.behavior?.fleeCount || 0) < maxCycles
    );
  }

  beginFlee(m: any, target: any, now: number) {
    m.state = "fleeing";
    m.returning = false;
    m.velocityX = 0;
    m.velocityY = 0;
    m.behavior.fleeCount = Number(m.behavior.fleeCount || 0) + 1;
    m.behavior.fleeUntil = Math.max(
      Number(m.behavior.fleeUntil || 0),
      now + 6500,
    );
    m.behavior.fleeStartedAt = now;
    const tx = target ? Number(target.x) : Number(m.homeX),
      ty = target ? Number(target.y) : Number(m.homeY);
    const dx = m.x - tx,
      dy = m.y - ty,
      d = Math.hypot(dx, dy) || 1;
    const retreatMeters = Math.max(
      18,
      Number(m.behavior?.investigateMeters || 40) * 0.55,
    );
    const retreatNorm = this.world.normalizedMeters(m.zone, retreatMeters);
    const candidates = [
      { x: m.x + (dx / d) * retreatNorm, y: m.y + (dy / d) * retreatNorm },
      { x: m.x + (-dy / d) * retreatNorm, y: m.y + (dx / d) * retreatNorm },
      { x: m.x + (dy / d) * retreatNorm, y: m.y + (-dx / d) * retreatNorm },
    ];
    let chosen = candidates[0];
    for (const c of candidates) {
      const x = clamp(c.x, 0.03, 0.97),
        y = clamp(c.y, 0.03, 0.97);
      if (!this.world.isBlocked?.(m.zone, x, y, m)) {
        chosen = { x, y };
        break;
      }
    }
    m.targetX = clamp(chosen.x, 0.03, 0.97);
    m.targetY = clamp(chosen.y, 0.03, 0.97);
  }

  encounterFor(id) {
    return id ? this.encounters.get(id) : null;
  }

  createEncounter(m, target, groupSize) {
    const id = `enc_${Date.now().toString(36)}_${this.nextEncounter++}`;
    const base = Math.max(2, Math.ceil(1 + groupSize * 0.75));
    const cap = Math.min(8, base);
    const encounter = {
      id,
      zone: m.zone,
      instanceId: m.dungeonInstanceId || null,
      targetPartyId: target?.partyId || null,
      leaderMobId: m.id,
      budget: cap,
      used: 1,
      createdAt: Date.now(),
      lastAssistAt: 0,
      mobIds: new Set([m.id]),
    };
    this.encounters.set(id, encounter);
    m.behavior.encounterId = id;
    m.behavior.assistCommitted = true;
    return encounter;
  }

  cleanupEncounters(now) {
    for (const [id, e] of this.encounters) {
      if (now - e.createdAt > 30000 || !e.mobIds.size) {
        this.encounters.delete(id);
        continue;
      }
      let live = 0;
      for (const mobId of e.mobIds) {
        const m = this.world.mobs.get(mobId);
        if (
          m &&
          m.state !== "dead" &&
          (m.aggroTarget || Object.keys(m.attackers || {}).length)
        )
          live++;
      }
      if (!live) this.encounters.delete(id);
    }
  }

  eligibleAssist(ally, caller, target, now, encounter) {
    if (
      !ally ||
      ally === caller ||
      ally.state === "dead" ||
      ally.zone !== caller.zone
    )
      return false;
    if (
      ally.dungeonId !== caller.dungeonId ||
      ally.dungeonInstanceId !== caller.dungeonInstanceId
    )
      return false;
    if (ally.faction !== caller.faction) return false;
    if (ally.state !== "idle" && ally.state !== "investigating") return false;
    if (ally.behavior?.encounterId) return false;
    if (ally.behavior?.socialAssist === false) return false;
    if (Number(ally.behavior?.assistCooldownUntil || 0) > now) return false;
    const range = Number(caller.behavior?.assistRangeMeters || 0);
    if (range <= 0) return false;
    if (
      Math.hypot(ally.x - caller.x, ally.y - caller.y) >
      this.world.normalizedMeters(caller.zone, range)
    )
      return false;
    if (ally.temper === "neutral" && !caller.aggroTarget) return false;
    return true;
  }

  alertAllies(m, target, now, zonePlayers = []) {
    const b = m.behavior;
    if (!target || !b?.socialAssist) return;
    if (b.encounterId) return;
    if (now - Number(b.lastAlertAt || 0) < Number(b.alertCooldownMs || 6500))
      return;
    const party = zonePlayers.filter(
      (p) =>
        p.online &&
        !p.dead &&
        p.zone === m.zone &&
        p.partyId &&
        p.partyId === target.partyId,
    );
    const groupSize = party.length ? party.length : 1;
    const encounter = this.createEncounter(m, target, groupSize);
    const available = Math.max(0, encounter.budget - encounter.used);
    if (available <= 0) return;
    b.lastAlertAt = now;
    encounter.lastAssistAt = now;
    const candidates = [];
    for (const ally of this.world.mobs.values()) {
      if (!this.eligibleAssist(ally, m, target, now, encounter)) continue;
      const d = Math.hypot(ally.x - m.x, ally.y - m.y),
        cost = Math.max(1, Number(ally.behavior?.reinforcementCost || 1));
      candidates.push({
        ally,
        d,
        cost,
        power: ally.elite || ally.rare || ally.leader ? 2 : 1,
      });
    }
    candidates.sort(
      (a, b) => a.cost - b.cost || a.power - b.power || a.d - b.d,
    );
    let spent = 0;
    for (const c of candidates) {
      if (spent + c.cost > available) continue;
      const ally = c.ally;
      ally.behavior.alertedUntil = Math.max(
        Number(ally.behavior.alertedUntil || 0),
        now + 8000,
      );
      ally.behavior.alertTargetId = target.id;
      ally.behavior.lastThreatX = target.x;
      ally.behavior.lastThreatY = target.y;
      ally.behavior.encounterId = encounter.id;
      ally.behavior.assistCommitted = true;
      ally.behavior.assistCooldownUntil =
        now + Number(b.assistCooldownMs || 6500);
      ally.state = "engaged";
      ally.aggroTarget = target.id;
      ally.leashOriginX = m.leashOriginX ?? m.homeX;
      ally.leashOriginY = m.leashOriginY ?? m.homeY;
      ally.attackers = ally.attackers || {};
      ally.attackers[target.id] = Math.max(
        1,
        Number(ally.attackers[target.id] || 0),
      );
      ally.wanderUntil = now + 60000;
      encounter.mobIds.add(ally.id);
      spent += c.cost;
      if (spent >= available) break;
    }
    encounter.used += spent;
  }

  prepare(m, target, zonePlayers, now) {
    if (!m.behavior) m.behavior = {};
    if (m.state === "fleeing") return { flee: true };
    if (
      this.combatFleeEnabled &&
      target &&
      m.behavior?.allowCombatFlee === true &&
      this.shouldFlee(m, now)
    ) {
      this.beginFlee(m, target, now);
      return { flee: true };
    }
    if (
      target &&
      !m.behavior.encounterId &&
      (m.behavior.socialAssist || m.leader)
    )
      this.alertAllies(m, target, now, zonePlayers);

    const preferred = Number(m.behavior.preferredRangeMeters || 0),
      retreat = Number(m.behavior.retreatRangeMeters || 0);
    if (target && preferred > 0 && m.behavior.kiteEnabled) {
      const d =
          this.world.worldMetersFor(m.zone) *
          Math.hypot(target.x - m.x, target.y - m.y),
        nowMs = now;
      let kiteActive = Number(m.behavior.kiteUntil || 0) > nowMs;
      const kiteCooldown = Number(m.behavior.kiteCooldownUntil || 0) > nowMs,
        commitActive = Number(m.behavior.commitUntil || 0) > nowMs;
      if (d >= preferred + 10) {
        m.behavior.kiteCycles = 0;
        m.behavior.commitUntil = 0;
      } else if (d < retreat && !kiteCooldown && !commitActive && !kiteActive) {
        const cycles = Number(m.behavior.kiteCycles || 0),
          maxCycles = Math.max(0, Number(m.behavior.maxKiteCycles || 0));
        if (cycles >= maxCycles) {
          m.behavior.kiteCycles = 0;
          m.behavior.commitUntil = nowMs + Number(m.behavior.commitMs || 2200);
        } else {
          m.behavior.kiteCycles = cycles + 1;
          m.behavior.kiteUntil =
            nowMs + Number(m.behavior.kiteDurationMs || 1200);
          kiteActive = true;
        }
      }
      if (kiteActive && !kiteCooldown && !commitActive) {
        const dx = m.x - target.x,
          dy = m.y - target.y,
          len = Math.hypot(dx, dy) || 1;
        const desired = Math.min(
          Number(m.attackRangeMeters || 45) * 0.86,
          Math.max(retreat + 3, preferred),
        );
        const n = this.world.normalizedMeters(m.zone, desired);
        m.targetX = clamp(m.x + (dx / len) * n, 0.03, 0.97);
        m.targetY = clamp(m.y + (dy / len) * n, 0.03, 0.97);
        m.behavior.kiting = true;
      } else {
        m.behavior.kiting = false;
        if (
          Number(m.behavior.kiteUntil || 0) > 0 &&
          nowMs >= Number(m.behavior.kiteUntil || 0)
        ) {
          m.behavior.kiteUntil = 0;
          m.behavior.kiteCooldownUntil =
            nowMs + Number(m.behavior.kiteCooldownMs || 1600);
        }
        if (
          Number(m.behavior.commitUntil || 0) > 0 &&
          nowMs >= Number(m.behavior.commitUntil || 0)
        )
          m.behavior.commitUntil = 0;
      }
    } else m.behavior.kiting = false;

    if (
      !target &&
      Number(m.behavior.alertedUntil || 0) > now &&
      m.state === "idle"
    ) {
      m.state = "investigating";
      m.behavior.lastInvestigateAt = now;
      m.targetX = clamp(Number(m.behavior.lastThreatX || m.x), 0.03, 0.97);
      m.targetY = clamp(Number(m.behavior.lastThreatY || m.y), 0.03, 0.97);
    }
    return { flee: false };
  }

  updateFlee(m, dt, now) {
    if (m.state !== "fleeing") return false;
    const d = Math.hypot(m.targetX - m.x, m.targetY - m.y);
    if (d > 0.002) {
      const step =
        ((Math.max(12, Number(m.speedMeters || 5.5)) * 1.22) /
          this.world.worldMetersFor(m.zone)) *
        dt;
      const r = this.world.resolveWalkableStep(
        m.zone,
        m.x,
        m.y,
        m.x + ((m.targetX - m.x) / d) * step,
        m.y + ((m.targetY - m.y) / d) * step,
        m,
      );
      m.velocityX = (r.x - m.x) / Math.max(dt, 0.001);
      m.velocityY = (r.y - m.y) / Math.max(dt, 0.001);
      m.x = r.x;
      m.y = r.y;
    }
    if (now >= Number(m.behavior.fleeUntil || 0) || d <= 0.002) {
      m.state = "returning";
      m.returning = true;
      m.velocityX = 0;
      m.velocityY = 0;
      m.behavior.fleeUntil = 0;
      m.behavior.encounterId = null;
      m.behavior.assistCommitted = false;
      m.outOfCombatSince = 0;
    }
    return true;
  }

  updateInvestigating(m, dt, now) {
    if (m.state !== "investigating") return false;
    const d = Math.hypot(m.targetX - m.x, m.targetY - m.y);
    if (d > 0.003) {
      const step =
        ((Math.max(4, Number(m.speedMeters || 5.5)) * 0.72) /
          this.world.worldMetersFor(m.zone)) *
        dt;
      const r = this.world.resolveWalkableStep(
        m.zone,
        m.x,
        m.y,
        m.x + ((m.targetX - m.x) / d) * step,
        m.y + ((m.targetY - m.y) / d) * step,
        m,
      );
      m.velocityX = (r.x - m.x) / Math.max(dt, 0.001);
      m.velocityY = (r.y - m.y) / Math.max(dt, 0.001);
      m.x = r.x;
      m.y = r.y;
      return true;
    }
    m.velocityX = 0;
    m.velocityY = 0;
    m.state = "idle";
    m.wanderUntil = now + 1800 + Math.random() * 2500;
    m.behavior.alertedUntil = 0;
    m.behavior.encounterId = null;
    m.behavior.assistCommitted = false;
    return true;
  }
}
