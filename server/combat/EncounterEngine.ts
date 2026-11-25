import { rollDamage } from "./CombatFormula.js";
import { shuffled } from "../shared/Random.js";
import {
  COMBAT_TABLE,
  isBossLike,
  threatOvertakeFactor,
} from "./CombatTable.js";
import { RANGED_CLASSES } from "./CombatRanges.js";
import {
  combatThreat,
  applyIncomingPartyDamage,
  partyRole,
} from "./PartyCombat.js";

class EncounterEngine {
  host: any;
  constructor(host: any) {
    this.host = host;
  }

  syncPartyExecution(e: any) {
    if (!e?.partyExecution) return [];
    const members = this.partyCombatants(
      e,
      (this.host.world?.players || []).find(
        (x: any) => x?.encounterId === e.id,
      ) || {},
    );
    for (const member of members) {
      if (!e.partyExecution.expectedMemberIds.includes(member.id))
        e.partyExecution.expectedMemberIds.push(member.id);
      if (!e.partyExecution.members[member.id])
        e.partyExecution.members[member.id] = {
          id: member.id,
          name: member.name,
          classId: member.classId,
          role: partyRole(member),
          damageDone: 0,
          healingDone: 0,
          damageTaken: 0,
          deaths: 0,
          revives: 0,
          interrupts: 0,
          cleanses: 0,
          mechanicsHit: 0,
          mechanicsAvoided: 0,
          resourceMin: Number(member.resolve || 0),
          resourceMax: Number(member.resolve || 0),
        };
    }
    return members;
  }
  recordPartyTimeline(e, type, data = {}) {
    if (!e?.partyExecution) return;
    e.partyExecution.timeline.push({ at: Date.now(), type, ...data });
    if (e.partyExecution.timeline.length > 160)
      e.partyExecution.timeline.shift();
  }
  recordPartyMetric(e, p, type, amount = 0) {
    if (!e?.partyExecution || !p) return;
    const m =
      e.partyExecution.members[p.id] ||
      (e.partyExecution.members[p.id] = {
        id: p.id,
        name: p.name,
        classId: p.classId,
        role: partyRole(p),
        damageDone: 0,
        healingDone: 0,
        damageTaken: 0,
        deaths: 0,
        revives: 0,
        interrupts: 0,
        cleanses: 0,
        mechanicsHit: 0,
        mechanicsAvoided: 0,
        resourceMin: Number(p.resolve || 0),
        resourceMax: Number(p.resolve || 0),
      });
    if (type === "damageDone") {
      m.damageDone += Math.max(0, amount);
      e.partyExecution.metrics.damageDone += Math.max(0, amount);
    }
    if (type === "healingDone") {
      m.healingDone += Math.max(0, amount);
      e.partyExecution.metrics.healingDone += Math.max(0, amount);
    }
    if (type === "damageTaken") {
      m.damageTaken += Math.max(0, amount);
      e.partyExecution.metrics.damageTaken += Math.max(0, amount);
    }
    if (type === "death") {
      m.deaths++;
      e.partyExecution.metrics.deaths++;
    }
    if (type === "revive") {
      m.revives++;
      e.partyExecution.metrics.revives++;
    }
    if (type === "interrupt") {
      m.interrupts++;
      e.partyExecution.metrics.mechanicsInterrupted++;
    }
    if (type === "cleanse") {
      m.cleanses++;
      e.partyExecution.metrics.cleanses++;
    }
    if (type === "mechanicHit") m.mechanicsHit++;
    m.online = !!p.online;
    if (type === "mechanicAvoided") {
      m.mechanicsAvoided++;
      e.partyExecution.metrics.mechanicsAvoided++;
    }
    const r = Number(p.resolve || 0);
    m.resourceMin = Math.min(Number(m.resourceMin ?? r), r);
    m.resourceMax = Math.max(Number(m.resourceMax ?? r), r);
  }
  partyCombatants(e, p) {
    const partyId = p.partyId;
    return (this.host.world?.players || []).filter(
      (x: any) =>
        x &&
        x.online &&
        !x.dead &&
        x.zone === p.zone &&
        x.encounterId === e.id &&
        (partyId ? x.partyId === partyId : true),
    );
  }
  threatTarget(e, players) {
    const forced = e.forcedTarget;
    if (forced && Number(forced.until || 0) > Date.now()) {
      const target = players.find((x: any) => x.id === forced.id);
      if (target) return target;
    }
    if (forced) e.forcedTarget = null;
    const ranked = players
      .slice()
      .sort(
        (a: any, b: any) =>
          Number(e.threat[b.id] || 0) - Number(e.threat[a.id] || 0),
      );
    const best = ranked[0] || players[0];
    const current = e.currentThreatTarget
      ? players.find((x: any) => x.id === e.currentThreatTarget)
      : null;
    if (current && best && current.id !== best.id) {
      const currentThreat = Number(e.threat[current.id] || 0),
        bestThreat = Number(e.threat[best.id] || 0);
      const challengerMelee = !RANGED_CLASSES.has(String(best.classId || ""));
      if (
        currentThreat > 0 &&
        bestThreat < currentThreat * threatOvertakeFactor(challengerMelee)
      )
        return current;
    }
    return best;
  }
  roleTarget(e, players, role) {
    const candidates = players.filter((x: any) => partyRole(x) === role);
    return candidates.length ? this.threatTarget(e, candidates) : null;
  }
  nonTankTarget(e, players) {
    const nonTanks = players.filter((x: any) => partyRole(x) !== "Tank");
    return nonTanks.length
      ? nonTanks[Math.floor(Math.random() * nonTanks.length)]
      : this.threatTarget(e, players);
  }
  mechanicTargets(e, players, scripted) {
    const target = this.threatTarget(e, players);
    const mode = String(scripted?.target || "threat");
    if (mode === "non_tank") return this.nonTankTarget(e, players);
    if (mode === "healer") {
      const healers = players.filter((x: any) => partyRole(x) === "Healer");
      return healers.length
        ? healers[Math.floor(Math.random() * healers.length)]
        : target;
    }
    if (mode === "support") {
      const supports = players.filter((x: any) => partyRole(x) === "Support");
      return supports.length
        ? supports[Math.floor(Math.random() * supports.length)]
        : target;
    }
    if (mode === "tank") return this.roleTarget(e, players, "Tank") || target;
    return target;
  }
  encounterMechanicByName(e, name) {
    return (
      (e.enemy?.encounterMechanics || []).find(
        (m: any) => String(m.name) === String(name),
      ) || null
    );
  }
  bossAIState(e, players, n = Date.now()) {
    if (!e || e.enemy?.ai !== "boss") return "NORMAL";
    if (e.enraged) return "ENRAGED";
    if (e.phaseTransitionUntil && n < e.phaseTransitionUntil)
      return "PHASE_TRANSITION";
    if (!players.length) return "RECOVERY";
    const alive = players.filter((x: any) => !x.dead && x.online);
    const tanks = alive.filter((x: any) => partyRole(x) === "Tank");
    const healers = alive.filter((x: any) => partyRole(x) === "Healer");
    const avgHp = alive.length
      ? alive.reduce(
          (sum: number, x: any) =>
            sum + Number(x.hp || 0) / Math.max(1, Number(x.maxHp || 1)),
          0,
        ) / alive.length
      : 0;
    const lowestHp = alive.length
      ? Math.min(
          ...alive.map(
            (x: any) => Number(x.hp || 0) / Math.max(1, Number(x.maxHp || 1)),
          ),
        )
      : 0;
    if (!tanks.length || !healers.length) return "ROLE_PRESSURE";
    if (lowestHp < 0.32 || avgHp < 0.58) return "PARTY_PRESSURE";
    if (Number(e.mechanicFailures || 0) > 0) return "PUNISH_FAILURE";
    if (Array.isArray(e.activeOverlapCasts) && e.activeOverlapCasts.length)
      return "OVERLAP";
    return "NORMAL";
  }
  encounterDirector(e, players, pattern, n = Date.now()) {
    const ai = (e.bossAI = e.bossAI || {});
    const cfg = e.enemy?.bossAI || {};
    const d = (ai.director = ai.director || {
      version: "4.5",
      phaseBudget: 0,
      overlapBudget: 0,
      addBudget: 0,
      pressureBudget: 0,
      recoveryWindow: false,
      lastBudgetAt: 0,
      lastPlan: null,
      planCount: 0,
    });
    const phaseKey = String(e.phase || 1);
    const phaseCfg =
      (e.enemy?.phases || [])[Math.max(0, (Number(e.phase) || 1) - 2)] || {};
    const now = n;
    const tickMs = Math.max(500, Number(cfg.directorTickMs || 2000));
    if (
      now - Number(d.lastBudgetAt || 0) >= tickMs ||
      d.lastPlan?.phase !== phaseKey
    ) {
      const alive = players.filter((x: any) => !x.dead && x.online);
      const avgHp = alive.length
        ? alive.reduce(
            (sum: number, x: any) =>
              sum + Number(x.hp || 0) / Math.max(1, Number(x.maxHp || 1)),
            0,
          ) / alive.length
        : 0;
      const critical = Number(cfg.criticalPartyHpThreshold || 0.32);
      const low = Number(cfg.lowPartyHpThreshold || 0.58);
      const recovery =
        avgHp >= low && Number(e.mechanicFailures || 0) === 0 && !e.enraged;
      const pressure =
        avgHp < low ||
        Number(e.mechanicFailures || 0) > 0 ||
        !alive.some((x: any) => partyRole(x) === "Healer");
      const activeOverlaps = Array.isArray(e.activeOverlapCasts)
        ? e.activeOverlapCasts.length
        : 0;
      const activeAdds = (
        this.host.world?.zoneMobs?.(players[0]?.zone, players[0]) || []
      ).filter(
        (m: any) =>
          m &&
          m.state !== "dead" &&
          m.dungeonId === e.dungeonId &&
          m.id !== e.enemy.id,
      ).length;
      const maxOverlap = Math.max(0, Number(cfg.maxConcurrentOverlaps ?? 2));
      const maxAdds = Math.max(0, Number(cfg.maxActiveAdds ?? 3));
      d.phaseBudget = Number(
        phaseCfg.mechanicBudget ?? cfg.mechanicBudget ?? 3,
      );
      d.overlapBudget = Math.max(0, maxOverlap - activeOverlaps);
      d.addBudget = Math.max(0, maxAdds - activeAdds);
      d.pressureBudget = pressure ? (critical > avgHp ? 2 : 1) : 0;
      d.recoveryWindow = recovery;
      d.lastBudgetAt = now;
      d.planCount = Number(d.planCount || 0) + 1;
      d.lastPlan = {
        at: now,
        phase: phaseKey,
        avgPartyHp: Number(avgHp.toFixed(3)),
        activeOverlaps,
        activeAdds,
        budget: {
          phase: d.phaseBudget,
          overlap: d.overlapBudget,
          adds: d.addBudget,
          pressure: d.pressureBudget,
        },
        recoveryWindow: d.recoveryWindow,
      };
      ai.history = [
        ...(ai.history || []),
        { at: now, type: "director_plan", ...d.lastPlan },
      ].slice(-24);
      if (e.partyExecution)
        this.recordPartyTimeline(e, "encounter_director_plan", {
          phase: e.phase,
          plan: d.lastPlan,
          planCount: d.planCount,
        });
    }
    return d;
  }
  directorMechanicScore(e, players, m, director, state, n) {
    const kind = String(m?.kind || "single");
    let v = 0;
    if (director.recoveryWindow) {
      if (kind === "single" || kind === "tank_buster") v -= 5;
      if (["ground", "movement", "spread", "interrupt"].includes(kind)) v -= 3;
      if (kind === "summon") v -= 8;
    }
    if (director.pressureBudget > 0) {
      if (kind === "tank_buster") v += 4;
      if (["ground", "movement", "spread"].includes(kind)) v += 4;
      if (kind === "summon" && director.addBudget > 0) v += 3;
    }
    if (
      director.overlapBudget <= 0 &&
      Array.isArray(m?.overlap) &&
      m.overlap.length
    )
      v -= 12;
    if (kind === "summon" && director.addBudget <= 0) v -= 20;
    if (
      state === "ROLE_PRESSURE" &&
      kind === "tank_buster" &&
      !players.some((x: any) => partyRole(x) === "Tank" && !x.dead)
    )
      v -= 50;
    return v;
  }
  chooseBossMechanic(e, players, pattern, n = Date.now()) {
    const list = Array.isArray(pattern) ? pattern : [];
    if (!list.length) return null;
    const state = this.bossAIState(e, players, n);
    const director = this.encounterDirector(e, players, list, n);
    const ai = (e.bossAI = e.bossAI || {
      state: "IDLE",
      lastState: "IDLE",
      lastDecisionAt: 0,
      decisionCount: 0,
      reason: null,
      selectedMechanic: null,
      mechanicCooldowns: {},
      history: [],
    });
    ai.lastState = ai.state;
    ai.state = state;
    ai.lastDecisionAt = n;
    ai.decisionCount = Number(ai.decisionCount || 0) + 1;
    const alive = players.filter((x: any) => !x.dead && x.online);
    const tanks = alive.filter((x: any) => partyRole(x) === "Tank");
    const healers = alive.filter((x: any) => partyRole(x) === "Healer");
    const avgHp = alive.length
      ? alive.reduce(
          (sum: number, x: any) =>
            sum + Number(x.hp || 0) / Math.max(1, Number(x.maxHp || 1)),
          0,
        ) / alive.length
      : 1;
    const addPressure = (
      this.host.world?.zoneMobs?.(players[0]?.zone, players[0]) || []
    ).filter(
      (m: any) =>
        m &&
        m.state !== "dead" &&
        m.dungeonId === e.dungeonId &&
        m.id !== e.enemy.id,
    ).length;
    const score = (m: any, i: number) => {
      let v = 0;
      const kind = String(m?.kind || "single");
      if (kind === "tank_buster")
        v +=
          state === "NORMAL"
            ? 8
            : state === "PARTY_PRESSURE"
              ? 1
              : state === "PUNISH_FAILURE"
                ? 5
                : 3;
      if (kind === "ground" || kind === "movement" || kind === "spread")
        v += state === "PARTY_PRESSURE" ? 8 : state === "OVERLAP" ? 6 : 4;
      if (kind === "interrupt") v += state === "PUNISH_FAILURE" ? 7 : 5;
      if (kind === "cleanse") v += healers.length ? 5 : 2;
      if (kind === "summon") v += addPressure < 3 ? 6 : -8;
      if (kind === "single") v += state === "ROLE_PRESSURE" ? 7 : 3;
      if (state === "ROLE_PRESSURE" && kind === "tank_buster" && !tanks.length)
        v -= 20;
      if (state === "PARTY_PRESSURE" && kind === "single") v -= 3;
      if (
        state === "OVERLAP" &&
        ["ground", "movement", "spread"].includes(kind)
      )
        v -= 4;
      if (m?.interruptible !== false && state === "PUNISH_FAILURE") v += 2;
      v += this.directorMechanicScore(e, players, m, director, state, n);
      const cooldownUntil = Number(ai.mechanicCooldowns?.[m.name] || 0);
      if (cooldownUntil > n) v -= 25;
      v -= Math.min(4, i * 0.05);
      return v;
    };
    let best: any = null,
      bestScore = -Infinity;
    list.forEach((m: any, i: number) => {
      const v = score(m, i);
      if (v > bestScore) {
        bestScore = v;
        best = m;
      }
    });
    if (!best) best = list[0];
    ai.selectedMechanic = best.name;
    ai.reason = `${state}:${best.kind || "single"}`;
    ai.history = [
      ...(ai.history || []),
      { at: n, state, mechanic: best.name, reason: ai.reason },
    ].slice(-12);
    ai.mechanicCooldowns[best.name] =
      n +
      Math.max(
        3500,
        Number(
          best.cooldownMs ||
            e.enemy?.bossAI?.avoidRepeatedMechanicMs ||
            e.enemy?.bossAICooldownMs ||
            9000,
        ),
      );
    if (e.partyExecution)
      this.recordPartyTimeline(e, "boss_ai_decision", {
        state,
        mechanic: best.name,
        reason: ai.reason,
        decisionCount: ai.decisionCount,
      });
    return best;
  }
  encounterWorldMeters(e, player) {
    return Math.max(
      1,
      Number(
        this.host.world?.byId?.[player?.zone]?.worldMeters ||
          this.host.world?.worldMetersFor?.(player?.zone) ||
          10000,
      ),
    );
  }
  encounterDistanceMeters(e, a, b) {
    if (!a || !b) return Infinity;
    return (
      Math.hypot(
        Number(a.x || 0) - Number(b.x || 0),
        Number(a.y || 0) - Number(b.y || 0),
      ) * this.encounterWorldMeters(e, a)
    );
  }
  choreographyMechanic(e, pattern, n = Date.now()) {
    const plans = e.enemy?.encounterChoreography;
    if (!Array.isArray(plans) || !plans.length) return null;
    const phasePlan =
      plans.find((x: any) => Number(x.phase || 1) === Number(e.phase)) ||
      plans.find((x: any) => x.default);
    const sequence = phasePlan?.sequence;
    if (!Array.isArray(sequence) || !sequence.length) return null;
    e.choreography = e.choreography || {
      phase: e.phase,
      step: 0,
      patternId: null,
      lastMechanic: null,
      history: [],
    };
    if (Number(e.choreography.phase) !== Number(e.phase)) {
      e.choreography.phase = e.phase;
      e.choreography.step = 0;
      e.choreography.lastMechanic = null;
    }
    const entry = sequence[Number(e.choreography.step) % sequence.length];
    const name = typeof entry === "string" ? entry : entry?.name;
    const mechanic = pattern.find((x: any) => String(x?.name) === String(name));
    if (!mechanic) return null;
    e.choreography.patternId = phasePlan?.id || `phase_${e.phase}`;
    e.choreography.lastMechanic = mechanic.name;
    e.choreography.history = [
      ...(e.choreography.history || []),
      { at: n, phase: e.phase, step: e.choreography.step, name: mechanic.name },
    ].slice(-32);
    e.choreography.step = (Number(e.choreography.step) + 1) % sequence.length;
    return mechanic;
  }
  validateEncounterMechanics(e) {
    const supported = new Set([
      "tank_buster",
      "frontal",
      "cone",
      "single",
      "single_target",
      "targeted",
      "ground",
      "movement",
      "spread",
      "stack",
      "soak",
      "interrupt",
      "summon",
      "adds",
      "cleanse",
      "dispel",
      "tether",
      "absorb",
      "anti_heal",
      "threat_wipe",
      "enrage",
      "tank_swap",
      "gaze",
      "stun",
      "aoe",
    ]);
    const errors = [];
    for (const m of e?.enemy?.mechanicPattern || []) {
      if (!supported.has(String(m?.kind || "single")))
        errors.push(`${m?.name || "unknown"}:${m?.kind}`);
    }
    for (const phase of e?.enemy?.phases || [])
      for (const m of phase?.mechanicPattern || []) {
        if (!supported.has(String(m?.kind || "single")))
          errors.push(`${m?.name || "unknown"}:${m?.kind}`);
      }
    return errors;
  }
  applyMechanicStatus(target, id, until, modifiers = {}, extra = {}) {
    target.statuses = target.statuses || [];
    target.statuses = target.statuses.filter((s: any) => s?.id !== id);
    target.statuses.push({
      id,
      until,
      modifiers,
      source: "encounter",
      ...extra,
    });
  }
  mechanicFailure(e, kind, target, n, reason) {
    const limit = Math.max(1, Number(e.enemy?.mechanicFailureLimit || 3));
    const windowMs = Math.max(
      5000,
      Number(e.enemy?.mechanicFailureWindowSec || 30) * 1000,
    );
    if (n - Number(e.mechanicFailureAt || 0) > windowMs) e.mechanicFailures = 0;
    e.mechanicFailureAt = n;
    e.mechanicFailures = Number(e.mechanicFailures || 0) + 1;
    if (e.partyExecution) {
      e.partyExecution.metrics.mechanicsFailed++;
      this.recordPartyTimeline(e, "mechanic_failed", { name: kind, reason });
    }
    this.host.log(
      e,
      `❌ ${kind} failed (${reason}). Failure ${e.mechanicFailures}/${limit}.`,
    );
    if (e.mechanicFailures >= limit) {
      const expected = new Set(e.partyExecution?.expectedMemberIds || []);
      const party = (this.host.world?.players || []).filter(
        (x: any) =>
          x &&
          x.online &&
          expected.has(x.id) &&
          x.zone === target?.zone &&
          x.partyId === target?.partyId,
      );
      for (const member of party) {
        member.hp = 0;
        this.host.handleDeath(member, e.log, e.enemy.name);
      }
      e.state = "wiped";
      e.cast = null;
      for (const member of party) {
        if (member.dungeon) {
          member.dungeon.wipePending = true;
          member.dungeon.wipeReason = "mechanic_failure";
        }
      }
      if (e.partyExecution) {
        e.partyExecution.recovery = e.partyExecution.recovery || {
          wipeCount: 0,
          state: "ACTIVE",
        };
        e.partyExecution.recovery.state = "WIPE_PENDING";
        e.partyExecution.recovery.wipeReason = "mechanic_failure";
        this.recordPartyTimeline(e, "wipe_pending", {
          reason: "mechanic_failure",
          stage: e.stage,
        });
      }
      this.host.log(
        e,
        `💀 Too many mechanic failures. ${e.enemy.name} wipes the party.`,
      );
      return true;
    }
    return false;
  }
  resolveOverlapCasts(e, players, n) {
    const queue = Array.isArray(e.activeOverlapCasts)
      ? e.activeOverlapCasts
      : [];
    if (!queue.length) return false;
    let wiped = false;
    for (const cast of [...queue]) {
      if (n < Number(cast.endsAt || 0)) continue;
      const targets = (cast.targetPlayerIds || [cast.targetPlayerId])
        .map((id: any) =>
          (this.host.world?.players || []).find((x: any) => x.id === id),
        )
        .filter(
          (x: any) =>
            x &&
            !x.dead &&
            x.zone === players[0]?.zone &&
            x.encounterId === e.id,
        );
      const idx = queue.indexOf(cast);
      if (idx >= 0) queue.splice(idx, 1);
      if (!targets.length) {
        this.recordPartyTimeline(e, "mechanic_expired", {
          name: cast.name,
          overlap: true,
        });
        continue;
      }
      const kind = String(cast.kind || "single");
      const meters = (x: any) =>
        Math.hypot(
          x.x - Number(cast.centerX ?? targets[0].x),
          x.y - Number(cast.centerY ?? targets[0].y),
        ) *
        Math.max(
          1,
          Number(
            this.host.world?.byId?.[players[0].zone]?.worldMeters ||
              this.host.world?.worldMetersFor?.(players[0].zone) ||
              10000,
          ),
        );
      if (kind === "ground" || kind === "aoe" || kind === "spread") {
        const resolutionTargets =
          kind === "ground" || kind === "aoe" ? players : targets;
        const hit = resolutionTargets.filter(
          (x: any) => meters(x) <= Number(cast.radius || 8),
        );
        for (const target of hit) this.applyMechanicDamage(e, target, cast, n);
        if (
          (kind === "ground" || kind === "aoe") &&
          Number(cast.persistentGroundMs || 0) > 0
        ) {
          e.groundEffects = e.groundEffects || [];
          e.groundEffects.push({
            id: `ground_${e.id}_${Date.now()}_${Math.random()}`,
            name: cast.name,
            kind,
            centerX: Number(cast.centerX ?? targets[0]?.x ?? 0),
            centerY: Number(cast.centerY ?? targets[0]?.y ?? 0),
            radius: Number(cast.radius || 8),
            startedAt: n,
            expiresAt: n + Number(cast.persistentGroundMs),
            nextTickAt: n + 1000,
            multiplier:
              Number(cast.multiplier || 1) *
              Number(cast.persistentTickMultiplier || 0.35),
          });
        }
        if (hit.length)
          this.recordPartyTimeline(e, "mechanic_overlap_hit", {
            name: cast.name,
            targetIds: hit.map((x: any) => x.id),
          });
        else {
          e.partyExecution &&
            (e.partyExecution.metrics.mechanicsResolved++,
            this.recordPartyTimeline(e, "mechanic_avoided", {
              name: cast.name,
              party: true,
              overlap: true,
            }));
        }
      } else if (kind === "movement" || kind === "gaze") {
        const target = targets[0];
        if (meters(target) > Number(cast.escapeRadius || 7)) {
          this.recordPartyMetric(e, target, "mechanicAvoided");
          this.recordPartyTimeline(e, "mechanic_avoided", {
            playerId: target.id,
            name: cast.name,
            overlap: true,
          });
        } else {
          this.applyMechanicDamage(e, target, cast, n);
          this.recordPartyTimeline(e, "mechanic_overlap_hit", {
            name: cast.name,
            targetIds: [target.id],
            overlap: true,
          });
          if (
            cast.mechanic?.failure === "wipe" &&
            this.mechanicFailure(
              e,
              cast.name,
              target,
              n,
              "overlapping movement requirement missed",
            )
          )
            wiped = true;
        }
      } else if (
        kind === "tank_buster" ||
        kind === "single" ||
        kind === "stun"
      ) {
        for (const target of targets)
          this.applyMechanicDamage(e, target, cast, n);
        this.recordPartyTimeline(e, "mechanic_overlap_hit", {
          name: cast.name,
          targetIds: targets.map((x: any) => x.id),
          overlap: true,
        });
      } else if (kind === "summon") {
        this.recordPartyTimeline(e, "mechanic_overlap_hit", {
          name: cast.name,
          targetIds: targets.map((x: any) => x.id),
          overlap: true,
        });
        const def = this.host.world?.mobDefs?.find(
          (x: any) => x.type === String(cast.summon || "catacomb_guard"),
        );
        if (def) {
          const center = targets[0];
          const count = Math.max(1, Math.min(5, Number(cast.count) || 2));
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const m = this.host.world.spawnMob(def, center.zone, 90000 + i, {
              id: `${e.id}_overlap_${cast.id}_${i}`,
              x: center.x,
              y: center.y,
              r: 0.04,
            });
            m.dungeonId = e.dungeonId || center.dungeon?.id || null;
            m.dungeonStage = e.stage;
            m.dungeonRoom = e.room?.id || center.dungeon?.roomId || null;
            m.respawn = 0;
            m.deadUntil = Infinity;
            m.temper = "aggressive";
            m.aggroRangeMeters = 120;
            m.aggroTarget = center.id;
            m.attackers = { [center.id]: 1 };
            m.state = "engaged";
            m.x = Math.max(
              0.01,
              Math.min(0.99, center.x + Math.cos(angle) * 0.025),
            );
            m.y = Math.max(
              0.01,
              Math.min(0.99, center.y + Math.sin(angle) * 0.025),
            );
            for (const member of this.host.world.players || []) {
              if (
                member.partyId === center.partyId &&
                member.dungeon &&
                center.dungeon &&
                member.dungeon.instanceId === center.dungeon.instanceId
              ) {
                member.dungeon.roomMobIds = member.dungeon.roomMobIds || [];
                if (!member.dungeon.roomMobIds.includes(m.id))
                  member.dungeon.roomMobIds.push(m.id);
              }
            }
          }
          this.host.log(
            e,
            `🩸 ${cast.name} resolves as overlapping reinforcements.`,
          );
        }
      }
      if (e.state !== "running") wiped = true;
    }
    return wiped;
  }
  enemyTick(p, n) {
    const e = p.encounterId ? this.host.get(p.encounterId) : null;
    if (!e || e.state !== "running") return;
    const players = this.syncPartyExecution(e);
    if (!players.length) {
      const party = (this.host.world?.players || []).filter(
        (x: any) =>
          x &&
          x.online &&
          x.partyId &&
          x.partyId === p.partyId &&
          x.encounterId === e.id,
      );
      const allDead = party.length > 0 && party.every((x: any) => x.dead);
      if (allDead) {
        e.state = "wiped";
        e.cast = null;
        for (const member of party) {
          member.encounterId = null;
          member.combat.autoAttack = false;
          member.combat.autoApproach = false;
          member.combat.queuedAbility = null;
          member.combat.queuedWorldAbility = null;
          member.dungeon &&
            ((member.dungeon.wipePending = true),
            (member.dungeon.wipeReason = "party_defeat"));
        }
        if (e.partyExecution) {
          e.partyExecution.recovery = e.partyExecution.recovery || {
            wipeCount: 0,
            state: "ACTIVE",
          };
          e.partyExecution.recovery.state = "WIPE_PENDING";
          e.partyExecution.recovery.wipeReason = "party_defeat";
          this.recordPartyTimeline(e, "wipe_pending", {
            reason: "party_defeat",
            stage: e.stage,
          });
        }
        this.host.log(e, "💀 The party has been defeated. Encounter reset.");
        this.host.encounters.delete(e.id);
      }
      return;
    }
    if (
      e.statuses?.some(
        (s: any) => s?.id === "stunned" && Number(s.until || 0) > Date.now(),
      )
    ) {
      e.cast = null;
      e.activeOverlapCasts = [];
      this.host.log(e, "💫 The boss is stunned and its casts are broken.");
      return;
    }
    e.statuses = (e.statuses || []).filter(
      (s: any) => !(s?.id === "stunned" && Number(s.until || 0) <= Date.now()),
    );

    const hpPct = e.enemyHp / e.maxHp;
    const phase2 = (e.enemy.phases || []).reduce(
      (last: number, x: any, i: number) => (hpPct <= Number(x.at) ? i : last),
      -1,
    );
    const wantedPhase = phase2 >= 0 ? phase2 + 2 : 1;
    if (wantedPhase > e.phase) {
      e.phase = wantedPhase;
      e.cast = null;
      e.activeOverlapCasts = [];
      e.mechanicIndex = 0;
      e.phaseTransitionUntil = n + 1200;
      e.choreography = {
        phase: e.phase,
        step: 0,
        patternId: null,
        lastMechanic: null,
        history: [],
      };
      e.partyExecution &&
        (e.partyExecution.metrics.phaseTransitions++,
        this.recordPartyTimeline(e, "phase_transition", {
          phase: e.phase,
          name: e.enemy.phases?.[e.phase - 2]?.name || "Enrage",
        }));
      this.host.log(
        e,
        `⚠️ Phase ${e.phase}: ${e.enemy.phases?.[e.phase - 2]?.name || "Enrage"}`,
      );
    }

    if (
      !e.enraged &&
      Number(e.enemy.enrageAfter) > 0 &&
      n - e.combatStartedAt >= Number(e.enemy.enrageAfter) * 1000
    ) {
      e.enraged = true;
      e.enrageMultiplier = Number(e.enemy.enrageMultiplier || 1.5);
      this.host.log(
        e,
        `🔥 ${e.enemy.name} becomes ENRAGED. Damage is increased.`,
      );
    }

    if (e.phaseTransitionUntil && n < e.phaseTransitionUntil) return;
    e.groundEffects = (e.groundEffects || []).filter(
      (zone: any) => Number(zone.expiresAt || 0) > n,
    );
    for (const zone of e.groundEffects || []) {
      if (n < Number(zone.nextTickAt || 0)) continue;
      zone.nextTickAt = n + 1000;
      const metersPerNorm = this.encounterWorldMeters(e, p);
      const inside = players.filter(
        (x: any) =>
          !x.dead &&
          x.online &&
          Math.hypot(x.x - Number(zone.centerX), x.y - Number(zone.centerY)) *
            metersPerNorm <=
            Number(zone.radius || 8),
      );
      for (const target of inside)
        this.applyMechanicDamage(
          e,
          target,
          {
            name: zone.name,
            kind: zone.kind,
            multiplier: zone.multiplier,
            interruptible: false,
          },
          n,
        );
      if (inside.length)
        this.recordPartyTimeline(e, "persistent_ground_tick", {
          name: zone.name,
          targetIds: inside.map((x: any) => x.id),
        });
    }
    if (this.resolveOverlapCasts(e, players, n)) return;
    if (e.cast) {
      if (n < e.cast.endsAt) return;
      const targets = (e.cast.targetPlayerIds || [e.cast.targetPlayerId])
        .map((id: any) =>
          (this.host.world?.players || []).find((x: any) => x.id === id),
        )
        .filter(
          (x: any) =>
            x && !x.dead && x.zone === p.zone && x.encounterId === e.id,
        );
      if (!targets.length) {
        e.cast = null;
        return;
      }
      if (
        e.cast.kind === "summon" &&
        Number(e.bossAI?.director?.addBudget || 0) <= 0
      ) {
        e.cast = null;
        return;
      }
      if (e.cast.kind === "summon") {
        const defId = String(e.cast.summon || "catacomb_guard");
        const def = this.host.world?.mobDefs?.find(
          (x: any) => x.type === defId,
        );
        const count = Math.max(1, Math.min(5, Number(e.cast.count) || 2));
        if (def) {
          const center = targets[0];
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2,
              rr = 0.025 + 0.01 * (i % 2);
            const area = {
              id: `${e.id}_summon_${i}`,
              x: center.x,
              y: center.y,
              r: 0.04,
            };
            const m = this.host.world.spawnMob(def, p.zone, 90000 + i, area);
            m.dungeonId = e.dungeonId || p.dungeon?.id || null;
            m.dungeonInstanceId = p.dungeon?.instanceId || null;
            m.dungeonStage = e.stage;
            m.dungeonRoom = e.room?.id || p.dungeon?.roomId || null;
            m.respawn = 0;
            m.deadUntil = Infinity;
            m.temper = "aggressive";
            m.aggroRangeMeters = 120;
            m.aggroTarget = center.id;
            m.attackers = { [center.id]: 1 };
            m.state = "engaged";
            m.returning = false;
            m.x = Math.max(
              0.01,
              Math.min(0.99, center.x + Math.cos(angle) * rr),
            );
            m.y = Math.max(
              0.01,
              Math.min(0.99, center.y + Math.sin(angle) * rr),
            );
            const ids = p.dungeon?.roomMobIds || [];
            if (p.dungeon && !ids.includes(m.id))
              p.dungeon.roomMobIds.push(m.id);
            for (const member of this.host.world.players || []) {
              if (
                member.partyId &&
                member.partyId === p.partyId &&
                member.dungeon &&
                p.dungeon &&
                member.dungeon.id === p.dungeon.id
              ) {
                member.dungeon.roomMobIds = member.dungeon.roomMobIds || [];
                if (!member.dungeon.roomMobIds.includes(m.id))
                  member.dungeon.roomMobIds.push(m.id);
              }
            }
          }
        }
        this.host.log(e, `🩸 ${e.cast.name} summons ${count} reinforcements.`);
        e.cast = null;
        return;
      }

      const centerX = Number(e.cast.centerX ?? targets[0].x),
        centerY = Number(e.cast.centerY ?? targets[0].y);
      const distNorm = (x: any) => Math.hypot(x.x - centerX, x.y - centerY);
      const meters = (x: any) =>
        distNorm(x) *
        Math.max(
          1,
          Number(
            this.host.world?.byId?.[p.zone]?.worldMeters ||
              this.host.world?.worldMetersFor?.(p.zone) ||
              10000,
          ),
        );
      const kind = String(e.cast.kind || "single");
      const mech = e.cast.mechanic || null;
      if (kind === "ground" || kind === "aoe" || kind === "spread") {
        const radius = Number(e.cast.radius || 8);
        const resolutionTargets =
          kind === "ground" || kind === "aoe" ? players : targets;
        const hit = resolutionTargets.filter((x: any) => meters(x) <= radius);
        for (const target of hit)
          this.applyMechanicDamage(e, target, e.cast, n);
        if (
          (kind === "ground" || kind === "aoe") &&
          Number(e.cast.persistentGroundMs || 0) > 0
        ) {
          e.groundEffects = e.groundEffects || [];
          e.groundEffects.push({
            id: `ground_${e.id}_${Date.now()}_${Math.random()}`,
            name: e.cast.name,
            kind,
            centerX,
            centerY,
            radius,
            startedAt: n,
            expiresAt: n + Number(e.cast.persistentGroundMs),
            nextTickAt: n + 1000,
            multiplier:
              Number(e.cast.multiplier || 1) *
              Number(e.cast.persistentTickMultiplier || 0.35),
          });
        }
        if (hit.length) {
          if (
            mech?.failure === "wipe" ||
            this.mechanicFailure(
              e,
              e.cast.name,
              targets[0],
              n,
              "telegraph failed",
            )
          )
            return;
        } else {
          e.partyExecution &&
            this.recordPartyTimeline(e, "mechanic_avoided", {
              name: e.cast.name,
              party: true,
            });
          this.host.log(e, `🕯️ The party escaped ${e.cast.name}.`);
        }
      } else if (kind === "gaze" || kind === "movement") {
        const target = targets[0];
        const moved =
          meters({ x: target.x, y: target.y }) >
          Number(e.cast.escapeRadius || 7);
        if (moved) {
          this.recordPartyMetric(e, target, "mechanicAvoided");
          this.recordPartyTimeline(e, "mechanic_avoided", {
            playerId: target.id,
            name: e.cast.name,
          });
          this.host.log(e, `👁️ ${target.name} broke ${e.cast.name}.`);
        } else {
          this.applyMechanicDamage(e, target, e.cast, n);
          if (
            this.mechanicFailure(
              e,
              e.cast.name,
              target,
              n,
              "movement requirement missed",
            )
          )
            return;
        }
      } else if (kind === "tank_swap") {
        const target = targets[0];
        this.applyMechanicDamage(e, target, e.cast, n);
        const tanks = players.filter(
          (x: any) => partyRole(x) === "Tank" && !x.dead && x.id !== target.id,
        );
        if (tanks.length) {
          const off = tanks.sort(
            (a: any, b: any) =>
              Number(e.threat[b.id] || 0) - Number(e.threat[a.id] || 0),
          )[0];
          e.threat[off.id] = Math.max(
            Number(e.threat[off.id] || 0),
            Number(e.threat[target.id] || 0) + 1,
          );
          e.forcedTarget = { id: off.id, until: n + 5000 };
          e.currentThreatTarget = off.id;
          for (const m of players) m.combat.currentThreatTarget = off.id;
          e.partyExecution &&
            (e.partyExecution.metrics.threatSwaps++,
            this.recordPartyTimeline(e, "threat_swap", {
              from: target.id,
              to: off.id,
              name: e.cast.name,
            }));
          this.host.log(
            e,
            `🔄 ${e.cast.name}: threat transferred to ${off.name}.`,
          );
        } else if (mech?.failure === "threat_swap") {
          this.mechanicFailure(
            e,
            e.cast.name,
            target,
            n,
            "no off-tank available",
          );
        }
      } else if (["frontal", "cone"].includes(kind)) {
        const target = targets[0];
        const radius = Math.max(1, Number(e.cast.radius || 10));
        const boss = e.bossPosition || { x: target.x, y: target.y };
        const vx = target.x - Number(boss.x),
          vy = target.y - Number(boss.y);
        const vlen = Math.hypot(vx, vy) || 1;
        const halfAngle = (Number(e.cast.angleDeg || 90) * Math.PI) / 180 / 2;
        const hit = players.filter((x: any) => {
          if (x.dead || !x.online) return false;
          const dx = x.x - Number(boss.x),
            dy = x.y - Number(boss.y);
          const dist = Math.hypot(dx, dy) * this.encounterWorldMeters(e, x);
          if (dist > radius) return false;
          if (kind === "frontal") return true;
          const dot =
            (dx * vx + dy * vy) / (Math.max(1, Math.hypot(dx, dy)) * vlen);
          return Math.acos(Math.max(-1, Math.min(1, dot))) <= halfAngle;
        });
        for (const x of hit) this.applyMechanicDamage(e, x, e.cast, n);
        if (
          hit.some((x: any) => partyRole(x) !== "Tank") &&
          mech?.failure === "heavy_damage"
        )
          this.recordPartyTimeline(e, "frontal_overlap", {
            name: e.cast.name,
            targetIds: hit.map((x: any) => x.id),
          });
      } else if (["stack", "soak"].includes(kind)) {
        const center = targets[0];
        const radius = Math.max(1, Number(e.cast.radius || 5));
        const nearby = players.filter(
          (x: any) =>
            !x.dead &&
            x.online &&
            Math.hypot(x.x - center.x, x.y - center.y) <= radius,
        );
        const required = Math.max(
          1,
          Number(
            mech?.minStack ||
              mech?.minSoak ||
              e.cast.minStack ||
              e.cast.minSoak ||
              2,
          ),
        );
        if (nearby.length < required) {
          for (const x of nearby) this.applyMechanicDamage(e, x, e.cast, n);
          if (mech?.failure)
            this.mechanicFailure(
              e,
              e.cast.name,
              center,
              n,
              `${kind} required ${required} players but got ${nearby.length}`,
            );
        } else {
          const reduction = Math.max(
            0.2,
            1 - (nearby.length - required) * 0.15,
          );
          for (const x of nearby) {
            const c = {
              ...e.cast,
              multiplier: Number(e.cast.multiplier || 1) * reduction,
            };
            this.applyMechanicDamage(e, x, c, n);
          }
          this.recordPartyTimeline(e, "mechanic_soaked", {
            name: e.cast.name,
            count: nearby.length,
            required,
          });
        }
      } else if (kind === "tether") {
        const tetherTargets =
          targets.length >= 2
            ? targets.slice(0, 2)
            : players.filter((x: any) => !x.dead && x.online).slice(0, 2);
        if (tetherTargets.length >= 2) {
          const dist = this.encounterDistanceMeters(
            e,
            tetherTargets[0],
            tetherTargets[1],
          );
          const maxDistance = Number(
            mech?.maxDistance || e.cast.maxDistance || 9,
          );
          if (dist > maxDistance) {
            for (const x of tetherTargets)
              this.applyMechanicDamage(e, x, e.cast, n);
            if (mech?.failure)
              this.mechanicFailure(
                e,
                e.cast.name,
                tetherTargets[0],
                n,
                `tether exceeded ${maxDistance}m`,
              );
          } else
            this.recordPartyTimeline(e, "tether_resolved", {
              name: e.cast.name,
              targetIds: tetherTargets.map((x: any) => x.id),
              distance: Number(dist.toFixed(2)),
            });
        }
      } else if (kind === "absorb") {
        const target = targets[0];
        const amount = Math.max(
          1,
          Math.round(Number(e.cast.absorbAmount || target.maxHp * 0.18)),
        );
        this.applyMechanicStatus(
          target,
          "encounter_absorb",
          n + Number(e.cast.durationMs || 7000),
          {},
          { absorbRemaining: amount, absorbMax: amount },
        );
        this.recordPartyTimeline(e, "mechanic_absorb_applied", {
          name: e.cast.name,
          targetId: target.id,
          amount,
        });
      } else if (kind === "anti_heal") {
        const target = targets[0];
        target.statuses = target.statuses || [];
        target.statuses = target.statuses.filter(
          (st: any) => st.id !== "encounter_anti_heal",
        );
        target.statuses.push({
          id: "encounter_anti_heal",
          until: n + Number(mech?.durationMs || 7000),
          description: `${e.cast.name} reduces incoming healing.`,
          modifiers: {
            healing: -Math.abs(Number(mech?.healingReductionPct || 40)),
          },
        });
        this.host.log(
          e,
          `🩸 ${target.name} is afflicted by ${e.cast.name}: healing reduced.`,
        );
      } else if (kind === "dispel") {
        const amount = Math.max(
          1,
          Math.round(
            Number(e.cast.shieldAmount || e.enemy.shieldAmount || 300),
          ),
        );
        this.applyMechanicStatus(
          e.enemy,
          "encounter_boss_ward",
          n + Number(e.cast.durationMs || 7000),
          { damageTaken: -25 },
          {
            absorbRemaining: amount,
            absorbMax: amount,
            description: `${e.cast.name} empowers the boss.`,
            modifiers: { damageTaken: -25 },
          },
        );
        this.host.log(
          e,
          `🛡️ ${e.enemy.name} gains ${e.cast.name}; purge the ward to restore normal damage.`,
        );
        this.recordPartyTimeline(e, "boss_buff_applied", {
          name: e.cast.name,
          amount,
        });
      } else if (kind === "enrage") {
        e.enraged = true;
        e.enrageMultiplier = Math.max(
          Number(e.enrageMultiplier || 1),
          Number(e.cast.multiplier || 1.5),
        );
        this.recordPartyTimeline(e, "enrage_triggered", {
          name: e.cast.name,
          multiplier: e.enrageMultiplier,
        });
        this.host.log(
          e,
          `🔥 ${e.enemy.name} enters enrage through ${e.cast.name}.`,
        );
      } else if (kind === "threat_wipe") {
        for (const id of Object.keys(e.threat)) e.threat[id] = 1;
        const next =
          players
            .filter((x: any) => !x.dead && x.online)
            .sort(
              (a: any, b: any) =>
                Number(e.threat[b.id] || 0) - Number(e.threat[a.id] || 0),
            )[0] || targets[0];
        if (next) {
          e.forcedTarget = { id: next.id, until: n + 3500 };
          e.currentThreatTarget = next.id;
          for (const x of players) x.combat.currentThreatTarget = next.id;
          this.recordPartyTimeline(e, "threat_wipe", {
            name: e.cast.name,
            newTargetId: next.id,
          });
        }
      } else if (kind === "cleanse") {
        const target = targets[0];
        target.statuses = target.statuses || [];
        target.statuses.push({
          id: "encounter_brand",
          until: n + 5000,
          description: `${e.cast.name} must be cleansed before detonation.`,
        });
        this.host.log(
          e,
          `🩸 ${target.name} is marked by ${e.cast.name}. Cleanse it before detonation.`,
        );
      } else {
        for (const target of targets)
          this.applyMechanicDamage(e, target, e.cast, n);
        if (
          e.cast.interruptible !== false &&
          (kind === "interrupt" || mech?.requiresInterrupt)
        )
          this.mechanicFailure(
            e,
            e.cast.name,
            targets[0],
            n,
            "interrupt window expired",
          );
      }
      if (e.state === "running") {
        e.partyExecution &&
          (e.partyExecution.metrics.mechanicsResolved++,
          this.recordPartyTimeline(e, "mechanic_resolved", {
            name: e.cast.name,
            kind: e.cast.kind,
            targetIds: e.cast.targetPlayerIds || [],
          }));
      }
      e.cast = null;
      return;
    }

    for (const member of players) {
      const marked = (member.statuses || []).find(
        (st: any) => st?.id === "encounter_brand" && Number(st.until || 0) > 0,
      );
      if (marked && n >= Number(marked.until)) {
        member.statuses = (member.statuses || []).filter(
          (st: any) => st !== marked,
        );
        this.applyMechanicDamage(
          e,
          member,
          { name: "Brand Detonation", multiplier: 2.0, kind: "single" },
          n,
        );
        if (e.state === "running")
          this.mechanicFailure(
            e,
            "Ashen Brand",
            member,
            n,
            "cleanse deadline missed",
          );
      }
    }

    for (const st of [
      ...(e.enemy.statuses || []),
      ...(e.enemyStatuses || []),
    ]) {
      if (n >= Number(st.until || 0)) {
        e.enemy.statuses = (e.enemy.statuses || []).filter(
          (x: any) => x !== st,
        );
        e.enemyStatuses = (e.enemyStatuses || []).filter((x: any) => x !== st);
        continue;
      }
      if (
        Number(st.snapshotDamage || 0) > 0 &&
        n - Number(st.lastTick || 0) >= 1000
      ) {
        st.lastTick = n;
        const tick = Math.max(1, Math.round(Number(st.snapshotDamage)));
        e.enemyHp = Math.max(0, e.enemyHp - tick);
        const src = (this.host.world?.players || []).find(
          (x: any) => x.id === st.sourcePlayerId,
        );
        if (src)
          e.threat[src.id] =
            (e.threat[src.id] || 0) + combatThreat(src, tick, 0.5);
        this.host.log(e, `☠️ ${st.id} deals ${tick} damage.`);
      }
    }
    if (e.enemyHp <= 0) {
      e.state = "won";
      e.participants = (this.host.world?.players || [])
        .filter((x: any) => x && x.encounterId === e.id)
        .map((x: any) => x.id);
      for (const member of this.host.world?.players || [])
        if (member.encounterId === e.id) {
          member.lastCombat = {
            outcome: "victory",
            enemy: e.enemy.name,
            log: [...e.log],
          };
          member.encounterId = null;
          member.combat.autoAttack = false;
          member.combat.autoApproach = false;
          member.combat.queuedAbility = null;
          member.combat.queuedWorldAbility = null;
        }
      return;
    }

    this.host.partyFailureState(e, n);
    if (n >= Number(e.nextBasicAt || 0)) {
      const basicTarget = this.threatTarget(e, players);
      const raw = rollDamage({
        attack: e.enemy.attack,
        power: (e.enraged ? Number(e.enrageMultiplier || 1.5) : 1) * 0.62,
        armor: basicTarget.armor,
        attackerLevel: Number(e.enemy.level || basicTarget.level || 1),
        critChance: 0,
      }).damage;
      const incoming = applyIncomingPartyDamage(
        basicTarget,
        Math.max(
          1,
          Math.round(
            raw *
              (basicTarget.combat.shieldWallUntil > n ? 0.55 : 1) *
              (basicTarget.combat.barrierUntil > n ? 0.55 : 1) *
              this.host.gearIncomingMultiplier(basicTarget, n),
          ),
        ),
        n,
        Math.random,
        {
          avoidable: true,
          attackerLevel:
            Number(e.enemy.level || basicTarget.level || 1) +
            (isBossLike(e.enemy) ? COMBAT_TABLE.bossLevelBonus : 0),
        },
      );
      const dmg = incoming.damage;
      if (incoming.avoided)
        this.host.log(
          e,
          `💨 ${basicTarget.name} ${incoming.avoided === "dodge" ? "dodges" : "evades"} ${e.enemy.name}'s attack.`,
        );
      basicTarget.hp = Math.max(0, basicTarget.hp - dmg);
      if (incoming.blocked)
        this.host.log(e, `🛡️ ${basicTarget.name} blocks the attack.`);
      basicTarget.combatFx = basicTarget.combatFx || [];
      basicTarget.combatFx.push({
        id: `boss_basic_${Date.now()}_${Math.random()}`,
        type: incoming.avoided ? "avoid" : "boss-basic",
        outcome: incoming.avoided || null,
        source: e.enemy.id,
        target: basicTarget.id,
        amount: dmg,
        at: n,
        expiresAt: incoming.avoided ? n + 900 : n + 700,
      });
      e.nextBasicAt = n + 2600;
      this.host.log(
        e,
        `⚔️ ${e.enemy.name} strikes ${basicTarget.name} for ${dmg}.`,
      );
      if (basicTarget.hp <= 0)
        this.host.handleDeath(basicTarget, e.log, e.enemy.name);
      if (!players.some((x: any) => !x.dead)) return;
    }
    if (n < e.nextMechanicAt) return;
    e.nextMechanicAt =
      n + Math.max(3500, (Number(e.enemy.castEvery) || 6) * 1000);
    const phase = e.enemy.phases?.[e.phase - 2];
    const pattern = phase?.mechanicPattern?.length
      ? phase.mechanicPattern
      : e.phase === 1 && e.enemy.phase1MechanicPattern?.length
        ? e.enemy.phase1MechanicPattern
        : e.enemy.mechanicPattern || [];
    const directorPlan = this.encounterDirector(e, players, pattern, n);
    const choreographed = this.choreographyMechanic(e, pattern, n);
    const scripted =
      choreographed ||
      (pattern.length ? this.chooseBossMechanic(e, players, pattern, n) : null);
    const mechanic = this.encounterMechanicByName(e, scripted?.name || "");
    const target = this.mechanicTargets(e, players, scripted);
    if (!target) return;
    for (const x of players) e.threat[x.id] = e.threat[x.id] || 1;
    const mechanicMeta = this.encounterMechanicByName(e, scripted?.name || "");
    const kind = String(
      scripted?.kind ||
        mechanicMeta?.runtimeKind ||
        mechanicMeta?.type ||
        "single",
    );
    const castName =
      scripted?.name || phase?.castName || e.enemy.castName || "Dark Cleave";
    const targetList = scripted?.partyWide
      ? players
      : ["tether", "stack", "soak"].includes(kind)
        ? shuffled(players.slice()).slice(
            0,
            Math.max(2, Number(scripted?.targetCount || 2)),
          )
        : scripted?.targets === "two"
          ? shuffled(players.slice()).slice(0, 2)
          : [target];
    const radius = Number(scripted?.radius || 0);
    const castDuration =
      (Number(scripted?.castDuration) || Number(e.enemy.castDuration) || 2.2) *
      1000;
    const phaseMult =
      Number(scripted?.multiplier) ||
      Number(phase?.castMultiplier) ||
      Number(phase?.mult) ||
      Number(e.enemy.castMultiplier) ||
      1.6;
    e.currentThreatTarget = target.id;
    for (const x of players) x.combat.currentThreatTarget = target.id;
    e.cast = {
      name: castName,
      kind,
      targetPlayerId: target.id,
      targetPlayerIds: targetList.map((x: any) => x.id),
      startedAt: n,
      endsAt: n + castDuration,
      duration: castDuration,
      damage: e.enemy.attack,
      radius,
      centerX: target.x,
      centerY: target.y,
      multiplier:
        phaseMult * (e.enraged ? Number(e.enrageMultiplier || 1.5) : 1),
      interruptible: scripted?.interruptible !== false,
      stun: Number(scripted?.stun || 0),
      summon: scripted?.summon || null,
      count: Number(scripted?.count || 0),
      escapeRadius: Number(scripted?.escapeRadius || 7),
      minStack: Number(scripted?.minStack || 0),
      minSoak: Number(scripted?.minSoak || 0),
      maxDistance: Number(scripted?.maxDistance || 0),
      absorbAmount: Number(scripted?.absorbAmount || 0),
      durationMs: Number(scripted?.durationMs || 7000),
      persistentGroundMs: Number(scripted?.persistentGroundMs || 0),
      persistentTickMultiplier: Number(
        scripted?.persistentTickMultiplier || 0.35,
      ),
      telegraph:
        kind === "ground" ||
        kind === "aoe" ||
        kind === "spread" ||
        kind === "stack" ||
        kind === "soak" ||
        kind === "cone" ||
        kind === "frontal"
          ? "ground"
          : kind === "gaze" || kind === "movement" || kind === "tether"
            ? "movement"
            : kind === "stun"
              ? "stun"
              : "interrupt",
      mechanic,
    };
    const director = e.bossAI?.director;
    const overlapDefs =
      director &&
      Number(director.overlapBudget || 0) > 0 &&
      Array.isArray(scripted?.overlap)
        ? scripted.overlap.slice(0, Number(director.overlapBudget))
        : [];
    e.activeOverlapCasts = e.activeOverlapCasts || [];
    for (const od of overlapDefs) {
      const source =
        typeof od === "string"
          ? pattern.find((x: any) => x?.name === od)
          : (od?.name && pattern.find((x: any) => x?.name === od.name)) || od;
      if (!source) continue;
      const om = this.encounterMechanicByName(e, source.name);
      const okind = String(source.kind || "single");
      const otarget = this.mechanicTargets(e, players, source) || target;
      const otargetList = source.partyWide
        ? players
        : source.targets === "two"
          ? shuffled(players.slice()).slice(0, 2)
          : [otarget];
      const odelay = Math.max(0, Number(od?.delayMs || 0));
      const oduration =
        (Number(source.castDuration) || Number(e.enemy.castDuration) || 2.2) *
        1000;
      const oc = {
        id: `ov_${e.id}_${e.overlapSequence++}`,
        name: source.name,
        kind: okind,
        targetPlayerId: otarget.id,
        targetPlayerIds: otargetList.map((x: any) => x.id),
        startedAt: n + odelay,
        endsAt: n + odelay + oduration,
        duration: oduration,
        radius: Number(source.radius || 0),
        centerX: otarget.x,
        centerY: otarget.y,
        multiplier:
          (Number(source.multiplier) || phaseMult) *
          (e.enraged ? Number(e.enrageMultiplier || 1.5) : 1),
        interruptible: source.interruptible !== false,
        stun: Number(source.stun || 0),
        summon: source.summon || null,
        count: Number(source.count || 0),
        escapeRadius: Number(source.escapeRadius || 7),
        absorbAmount: Number(source.absorbAmount || 0),
        durationMs: Number(source.durationMs || 7000),
        persistentGroundMs: Number(source.persistentGroundMs || 0),
        persistentTickMultiplier: Number(
          source.persistentTickMultiplier || 0.35,
        ),
        mechanic: om,
      };
      e.activeOverlapCasts.push(oc);
      e.partyExecution &&
        (e.partyExecution.metrics.mechanicsStarted++,
        this.recordPartyTimeline(e, "overlap_mechanic_start", {
          name: oc.name,
          kind: oc.kind,
          targetIds: oc.targetPlayerIds,
          startsAt: oc.startedAt,
          endsAt: oc.endsAt,
        }));
    }
    e.mechanicIndex++;
    e.partyExecution &&
      (e.partyExecution.metrics.mechanicsStarted++,
      this.recordPartyTimeline(e, "mechanic_start", {
        name: castName,
        kind,
        targetIds: e.cast.targetPlayerIds,
        endsAt: e.cast.endsAt,
      }));
    this.host.log(
      e,
      `✨ ${e.enemy.name} targets ${targetList.map((x: any) => x.name).join(", ")} with ${castName}${e.cast.interruptible ? "  -  interruptible." : kind === "ground" || kind === "aoe" || kind === "spread" ? "  -  MOVE OUT." : kind === "gaze" || kind === "movement" ? "  -  MOVE AWAY." : ""}`,
    );
  }
  applyMechanicDamage(e, target, cast, n) {
    if (!target || target.dead) return;
    let raw = rollDamage({
      attack: e.enemy.attack,
      power: cast.multiplier || 1,
      armor: target.armor,
      attackerLevel: Number(e.enemy.level || target.level || 1),
      critChance: 0,
    }).damage;
    if (cast.kind === "tank_buster" && partyRole(target) !== "Tank")
      raw = Math.round(raw * 1.15);
    const incoming = applyIncomingPartyDamage(
      target,
      Math.max(
        1,
        Math.round(
          raw *
            (target.combat.shieldWallUntil > n ? 0.55 : 1) *
            this.host.gearIncomingMultiplier(target, n),
        ),
      ),
      n,
    );
    const dmg = incoming.damage;
    target._lastDamageAt = n;
    target._hpRegenAt = n;
    target.hp = Math.max(0, target.hp - dmg);
    if (incoming.blocked)
      this.host.log(e, `🛡️ ${target.name} blocks ${cast.name}.`);
    if (Number(cast.stun || 0) > 0 && target.hp > 0) {
      const applied = this.host.applyControl(
        target,
        "stunned",
        Number(cast.stun),
        n,
      );
      if (applied > 0)
        this.host.log(
          e,
          `💫 ${target.name} is stunned for ${applied.toFixed(2)}s.`,
        );
    }
    target.combatFx = target.combatFx || [];
    target.combatFx.push({
      id: `fx_${Date.now()}_${Math.random()}`,
      type: "boss-hit",
      source: e.enemy.id,
      target: target.id,
      abilityName: cast.name,
      kind: cast.kind,
      amount: dmg,
      at: n,
      expiresAt: n + 900,
    });
    this.host.log(e, `☠️ ${cast.name} hits ${target.name} for ${dmg}.`);
    if (target.hp <= 0) this.host.handleDeath(target, e.log, e.enemy.name);
  }
}

export { EncounterEngine };
