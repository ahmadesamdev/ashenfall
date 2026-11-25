import { runtimeId } from "../shared/Ids.js";
import { rollDamage, mobArmorScale } from "./CombatFormula.js";
import { attackMisses, critSuppression, isBossLike } from "./CombatTable.js";
import {
  combatThreat,
  incomingPartyDamage,
  applyIncomingPartyDamage,
  partyRole,
  healingThreat,
} from "./PartyCombat.js";
import {
  COMBAT_RANGES,
  RANGED_CLASSES,
  normalizeAbilityRange,
  normalizeGameDistance,
} from "./CombatRanges.js";
import {
  validateCombatActor,
  validateAbilityOwnership,
  validateResourceAndCooldown,
  validateTargetRule,
} from "./CombatAuthority.js";
import { pushFx } from "./CombatEffects.js";
import { CombatProjectileService } from "./CombatProjectileService.js";
import { CombatGearService } from "./CombatGearService.js";
import { PvpCombatService } from "./PvpCombatService.js";
import { EncounterEngine } from "./EncounterEngine.js";
import {
  ensureCombatState,
  transitionCombat,
  finishRecoveryIfReady,
  queueAbility,
  popQueuedAbility,
  clearCombatQueue,
} from "./CombatStateMachine.js";
class CombatEngine {
  abilities: Record<string, any>;
  enemies: Record<string, any>;
  items: Record<string, any>;
  inv: any;
  world: any;
  combatSynergies: any;
  talentTransformations: any;
  combatResources: any;
  combatRotations: any;
  encounters: Map<string, any>;
  projectiles: CombatProjectileService;
  gear: CombatGearService;
  pvp: PvpCombatService;
  encounterEngine: EncounterEngine;
  constructor({
    abilities,
    enemies,
    items,
    inv,
    world,
    combatSynergies,
    talentTransformations,
    combatResources,
    combatRotations,
  }: any) {
    this.abilities = abilities;
    this.enemies = enemies;
    this.items = items;
    this.inv = inv;
    this.world = world;
    this.combatSynergies = combatSynergies || {};
    this.talentTransformations = talentTransformations || {};
    this.combatResources = combatResources || {};
    this.combatRotations = combatRotations || {};
    this.encounters = new Map();
    this.gear = new CombatGearService({
      items: this.items,
      logSynergy: (p: any, msg: string) => this.logSynergy(p, msg),
    });
    this.pvp = new PvpCombatService(this);
    this.encounterEngine = new EncounterEngine(this);
    this.projectiles = new CombatProjectileService({
      world: this.world,
      onImpact: (projectile: any, target: any, n: number) =>
        this.resolveWorldProjectileImpact(projectile, target, n),
    });
  }
  log(e, msg) {
    e.log.push({ t: new Date().toLocaleTimeString(), msg });
    e.log = e.log.slice(-100);
  }
  buildAbilityMultiplier(p: any, id: string) {
    return Math.max(0, Number(p?.buildBonuses?.abilityMultipliers?.[id] || 1));
  }
  transformedAbility(p: any, a: any) {
    const list = this.talentTransformations?.builds?.[p?.activeBuildId] || [];
    const ranks = Object.fromEntries(
      (p?.talents || []).map((x: any) => [x.id, Number(x.rank || 0)]),
    );
    const skillList = Object.entries(
      this.talentTransformations?.skillTalents || {},
    ).map(([talentId, x]: any) => ({ talentId, ...x }));
    const matches = [...list, ...skillList].filter(
      (x: any) =>
        x.abilityId === a.id &&
        (ranks[x.talentId] || 0) >= Number(x.minRank || 1),
    );
    if (!matches.length) return a;
    const out = { ...a };
    for (const m of matches) {
      const c = m.changes || {};
      if (c.powerPct)
        out.power = Number(out.power || 0) * (1 + Number(c.powerPct) / 100);
      if (c.costPct)
        out.cost = Math.max(
          0,
          Number(out.cost || 0) * (1 + Number(c.costPct) / 100),
        );
      if (c.gcdPct)
        out.gcd = Math.max(
          0,
          Number(out.gcd || 0) * (1 + Number(c.gcdPct) / 100),
        );
      if (c.stunPct && out.stun)
        out.stun = Number(out.stun) * (1 + Number(c.stunPct) / 100);
      if (c.healPct && out.heal)
        out.heal = Number(out.heal) * (1 + Number(c.healPct) / 100);
      if (c.hotPowerPct && out.hot)
        out.hot = {
          ...out.hot,
          tickHeal:
            Number(out.hot.tickHeal || 0) * (1 + Number(c.hotPowerPct) / 100),
        };
    }
    p.combat.lastTalentTransformations = matches.map((x: any) => x.talentId);
    return out;
  }

  buildCostMultiplier(p: any) {
    return Math.max(0.5, 1 + Number(p?.buildBonuses?.resourceCost || 0) / 100);
  }
  abilityResourceCost(p: any, a: any, n = Date.now()) {
    return Math.max(
      0,
      Number(a?.cost || 0) *
        this.buildCostMultiplier(p) *
        this.gear.castCostMultiplier(p, a, n),
    );
  }
  selfBuffDurationMs(id: string) {
    return id === "shield_wall"
      ? 8000
      : id === "guard"
        ? 5000
        : id === "arcane_surge"
          ? 8000
          : id === "arcane_echo"
            ? 7000
            : id === "trueshot"
              ? 6000
              : id === "shadow_dance"
                ? 8000
                : id === "barrier"
                  ? 7000
                  : id === "smoke_bomb"
                    ? 7000
                    : id === "stealth"
                      ? 5000
                      : id === "rootward"
                        ? 7000
                        : id === "frenzy"
                          ? 8000
                          : 3000;
  }
  applySelfBuffStatus(p: any, a: any, n: number) {
    const id = String(a?.selfBuff || "");
    if (!id) return null;
    const until =
      n +
      this.selfBuffDurationMs(id) *
        (1 + Number(p.bonuses?.buffDuration || 0) / 100);
    const buffIds = new Set([
      "guard",
      "shield_wall",
      "arcane_surge",
      "arcane_echo",
      "trueshot",
      "shadow_dance",
      "barrier",
      "smoke_bomb",
      "stealth",
      "rootward",
      "frenzy",
      "blink",
    ]);
    p.statuses = (p.statuses || []).filter(
      (s: any) => !buffIds.has(String(typeof s === "string" ? s : s?.id || "")),
    );
    const labels: any = {
      guard: "Guard",
      shield_wall: "Shield Wall",
      arcane_surge: "Arcane Surge",
      arcane_echo: "Arcane Echo",
      trueshot: "Trueshot",
      shadow_dance: "Shadow Dance",
      barrier: "Barrier",
      smoke_bomb: "Smoke Bomb",
      stealth: "Stealth",
      rootward: "Rootward",
      frenzy: "Frenzy",
      blink: "Blink",
    };
    const status: any = {
      id,
      name: labels[id] || a.name || id,
      effect: String(a.description || "Temporary combat buff."),
      duration: (until - n) / 1000,
      until,
      sourcePlayerId: p.id,
      description: String(a.description || `${labels[id] || id} is active.`),
      icon: a.icon || null,
    };
    p.statuses.push(status);
    return status;
  }
  gearAbilityMultiplier(p: any, id: string) {
    return this.gear.abilityMultiplier(p, id);
  }
  gearEffects(p: any) {
    return this.gear.effects(p);
  }
  gearActiveEffects(p: any, n = Date.now()) {
    return this.gear.activeEffects(p, n);
  }
  gearActiveMultiplier(p: any, key: string, n = Date.now()) {
    return this.gear.activeMultiplier(p, key, n);
  }
  gearUse(p: any, itemId: string, n = Date.now()) {
    return this.gear.use(p, itemId, n);
  }
  gearBeforeCast(p: any, a: any, target: any, n = Date.now()) {
    return this.gear.beforeCast(p, a, target, n);
  }
  gearAfterHit(p: any, a: any, target: any, result: any, n = Date.now()) {
    return this.gear.afterHit(p, a, target, result, n);
  }
  gearAfterHeal(p: any, a: any, healed: number, n = Date.now()) {
    return this.gear.afterHeal(p, a, healed, n);
  }
  gearIncomingMultiplier(p: any, n = Date.now()) {
    return this.gear.incomingMultiplier(p, n);
  }
  gcdMs(p: any, a: any) {
    const base = Math.max(0, Number(a?.gcd) || 0) * 1000;
    if (!base) return 0;
    return Math.max(
      Math.min(750, base),
      base / (1 + Math.max(0, this.cooldownHaste(p)) / 100),
    );
  }
  swingMs(p: any, baseMs: number) {
    return Math.max(
      650,
      Number(baseMs || 0) / (1 + Math.max(0, this.cooldownHaste(p)) / 100),
    );
  }

  preflight = false;
  private completionGrants = new WeakMap<
    object,
    { abilityId: string; until: number }
  >();
  private runPreflight(fn: () => any) {
    this.preflight = true;
    try {
      return fn();
    } finally {
      this.preflight = false;
    }
  }
  castMs(p: any, a: any) {
    const base = Math.max(0, Number(a?.castTime) || 0) * 1000;
    if (!base || a?.id === "basic_strike") return 0;
    return Math.max(250, base / (1 + Math.max(0, this.cooldownHaste(p)) / 100));
  }
  grantCompletion(p: any, abilityId: string, n = Date.now()) {
    this.completionGrants.set(p, { abilityId, until: n + 3000 });
  }
  consumeCompletion(p: any, abilityId: string, n = Date.now()) {
    const g = this.completionGrants.get(p);
    if (g && g.abilityId === abilityId && g.until >= n) {
      this.completionGrants.delete(p);
      return true;
    }
    return false;
  }
  isCasting(p: any) {
    return !!p?.combat?.casting;
  }
  beginCast(p: any, a: any, n: number, ctx: { kind: string; command: any }) {
    ensureCombatState(p);
    if (Number(p.combat.castLockUntil || 0) > n)
      return [false, "Your spells are locked out."];
    if (p.moveInput) return [false, "You must stand still to cast."];
    if (p.moveState === "moving") {
      p.moveState = "idle";
      p.movementIntent = "none";
      p.targetX = p.x;
      p.targetY = p.y;
      p.velocityX = 0;
      p.velocityY = 0;
    }
    const castMs = this.castMs(p, a),
      gcdMs = this.gcdMs(p, a);
    p.combat.casting = {
      abilityId: a.id,
      name: a.name,
      icon: a.icon,
      startedAt: n,
      endsAt: n + castMs,
      castMs,
      gcdReadyAt: n + gcdMs,
      kind: ctx.kind,
      command: ctx.command,
      startX: p.x,
      startY: p.y,
      completing: false,
    };
    p.combat.gcdReadyAt = n + gcdMs;
    p.combat.castEventAt = n;
    return [
      true,
      { casting: true, abilityId: a.id, castMs, endsAt: n + castMs },
    ];
  }
  cancelCast(p: any, reason = "Cast cancelled.", n = Date.now()) {
    const c = p?.combat?.casting;
    if (!c) return false;
    p.combat.casting = null;
    p.combat.castEventAt = n;
    p.worldCombatLog = p.worldCombatLog || [];
    p.worldCombatLog.push({
      t: new Date().toLocaleTimeString(),
      msg: `✖️ ${c.name || "Cast"}: ${reason}`,
    });
    p.worldCombatLog = p.worldCombatLog.slice(-80);
    pushFx(p, "cast_cancel", p.id, p.id, c.abilityId, { durationMs: 700 });
    return true;
  }
  tickCast(p: any, n: number) {
    const c = p?.combat?.casting;
    if (!c) return null;
    if (c.completing) {
      if (n > Number(c.endsAt) + 8000) {
        p.combat.casting = null;
      }
      return null;
    }
    const stop = (why: string) => {
      this.cancelCast(p, why, n);
      return { cancelled: why };
    };
    if (n > Number(c.endsAt) + 4000) {
      p.combat.casting = null;
      return { cancelled: "stale" };
    }
    if (p.dead) return stop("You died.");
    if (this.isStunned(p, n)) return stop("Interrupted.");
    const meters = Number(this.world?.worldMetersFor?.(p.zone) || 10000);
    if (
      Math.hypot(
        Number(p.x) - Number(c.startX),
        Number(p.y) - Number(c.startY),
      ) *
        meters >
      1.5
    )
      return stop("You moved.");
    if (c.kind === "world" && c.command?.mobId) {
      const mob = this.world?.byIdMob?.(c.command.mobId);
      if (
        !mob ||
        mob.state === "dead" ||
        Number(mob.hp) <= 0 ||
        mob.zone !== p.zone
      )
        return stop("Target lost.");
    }
    if (
      c.kind === "encounter" &&
      (!p.encounterId || this.get(p.encounterId)?.state !== "running")
    )
      return stop("Combat ended.");
    if (c.kind === "pvp" && !p.pvp) return stop("PvP ended.");
    if (n >= Number(c.endsAt)) {
      c.completing = true;
      return { complete: c };
    }
    return null;
  }

  requestWorldCast(
    p: any,
    id: string,
    mob: any,
    targetId: any = null,
    options: any = {},
  ) {
    const n = Date.now(),
      a0 = this.abilities[id];
    const completing = this.consumeCompletion(p, id, n);
    if (p?.combat?.casting && !completing)
      return [false, "You are already casting."];
    if (completing || this.castMs(p, a0) <= 0)
      return this.requestWorldCastNow(p, id, mob, targetId, options);
    const pre = this.runPreflight(() =>
      this.requestWorldCastNow(p, id, mob, targetId, options),
    );
    if (!pre?.[0] || pre[1] !== "preflight") return pre;
    return this.beginCast(p, this.transformedAbility(p, a0), n, {
      kind: "world",
      command: {
        action: "use_world_ability",
        abilityId: id,
        mobId: mob?.id || null,
        targetPlayerId: targetId || null,
      },
    });
  }
  _request(p: any, id: string, e: any) {
    const n = Date.now(),
      a0 = this.abilities[id];
    const completing = this.consumeCompletion(p, id, n);
    if (p?.combat?.casting && !completing)
      return [false, "You are already casting."];
    if (completing || this.castMs(p, a0) <= 0)
      return this._requestNow(p, id, e);
    const pre = this.runPreflight(() => this._requestNow(p, id, e));
    if (!pre?.[0] || pre[1] !== "preflight") return pre;
    return this.beginCast(p, a0, n, {
      kind: "encounter",
      command: {
        action: "cast_ability",
        abilityId: id,
        targetPlayerId: p.targetPlayerId || null,
      },
    });
  }
  cooldownHaste(p: any) {
    return (
      Number(p?.bonuses?.haste || 0) +
      Number(p?.bonuses?.gearAttunementCooldownRecoveryPct || 0) +
      Number(this.gearActiveMultiplier(p, "hastePct") - 1) * 100
    );
  }
  resourceGain(p: any, gain: any) {
    return (
      Number(gain || 0) *
      (1 + Number(p?.bonuses?.gearAttunementResourceGainPct || 0) / 100)
    );
  }
  resourceProfile(p: any) {
    return (
      this.combatResources?.classes?.[p?.classId] || p?.resourceSpec || null
    );
  }
  rotationProfile(p: any) {
    return (
      this.combatRotations?.classes?.[p?.classId]?.builds?.[p?.activeBuildId] ||
      null
    );
  }
  trackRotation(p: any, a: any) {
    const profile = this.rotationProfile(p);
    if (!profile) return;
    p.combat = p.combat || {};
    p.combat.rotationState = p.combat.rotationState || {
      phase: "sustained",
      step: 0,
      lastAbilityId: null,
      sequenceBreaks: 0,
    };
    const state = p.combat.rotationState;
    const phase = state.phase || "sustained";
    const seq = (
      profile.phases?.[phase] ||
      profile.phases?.sustained ||
      []
    ).map((x: any) => x.abilityId);
    if (!seq.length) return;
    const expected = seq[Math.min(state.step, seq.length - 1)];
    if (a.id === expected) {
      state.step = (state.step + 1) % seq.length;
    } else {
      const idx = seq.indexOf(a.id);
      if (idx >= 0) state.step = (idx + 1) % seq.length;
      else state.sequenceBreaks = Number(state.sequenceBreaks || 0) + 1;
    }
    state.lastAbilityId = a.id;
    state.resourceAtCast = Number(p.resolve || 0);
  }
  setRotationPhase(p: any, phase: string) {
    const profile = this.rotationProfile(p);
    if (!profile?.phases?.[phase]) return false;
    p.combat = p.combat || {};
    p.combat.rotationState = {
      phase,
      step: 0,
      lastAbilityId: null,
      sequenceBreaks: Number(p.combat.rotationState?.sequenceBreaks || 0),
    };
    return true;
  }
  activeSynergies(p: any) {
    const cls = this.combatSynergies?.[p?.classId];
    const build = cls?.[p?.activeBuildId];
    if (!build?.length) return [];
    const ranks = Object.fromEntries(
      (p?.talents || []).map((x: any) => [x.id, Number(x.rank || 0)]),
    );
    return build.filter(
      (x: any) => (ranks[x.talentId] || 0) >= Number(x.minRank || 1),
    );
  }
  synergyBeforeAbility(p: any, a: any, target: any, n = Date.now()) {
    const active = this.activeSynergies(p);
    let multiplier = 1;
    let consumed = 0;
    const pending = Number(p?.combat?.synergyNextPowerPct || 0);
    const eligible =
      Number(a?.power || 0) > 0 || !!a?.heal || !!a?.hot || !!a?.revive;
    if (pending > 0 && eligible) {
      multiplier *= 1 + pending / 100;
      p.combat.synergyNextPowerPct = 0;
      consumed = pending;
    }
    for (const x of active) {
      const t = x.trigger || {};
      if (t.type !== "conditional_cast" || t.abilityId !== a.id) continue;
      const hp = target?.maxHp ? Number(target.hp) / Number(target.maxHp) : 1;
      const selfHp = p?.maxHp ? Number(p.hp) / Number(p.maxHp) : 1;
      if (
        hp <= Number(t.targetHpBelow ?? -1) ||
        selfHp <= Number(t.selfHpBelow ?? -1)
      ) {
        multiplier *= 1 + Number(x.effect?.nextPowerPct || 0) / 100;
        this.logSynergy(p, `${x.name} empowers ${a.name}.`);
      }
    }
    return { multiplier, consumed };
  }
  synergyAfterAbility(p: any, a: any, n = Date.now()) {
    const active = this.activeSynergies(p);
    for (const x of active) {
      const t = x.trigger || {};
      if (t.type !== "after_cast" || t.abilityId !== a.id) continue;
      const effect = x.effect || {};
      if (Number(effect.resourceGain || 0) > 0)
        p.resolve = Math.min(
          p.maxResolve,
          p.resolve + Number(effect.resourceGain),
        );
      if (Number(effect.nextPowerPct || 0) > 0)
        p.combat.synergyNextPowerPct = Math.max(
          Number(p.combat.synergyNextPowerPct || 0),
          Number(effect.nextPowerPct),
        );
      this.logSynergy(p, `${x.name} triggered after ${a.name}.`);
      p.combat.synergyHistory = (p.combat.synergyHistory || [])
        .concat([{ id: x.id, at: n }])
        .slice(-12);
    }
  }
  logSynergy(p, msg) {
    const e = p?.encounterId ? this.get(p.encounterId) : null;
    if (e) this.log(e, `🔗 ${msg}`);
    else if (p?.worldCombatLog) {
      p.worldCombatLog.push({
        t: new Date().toLocaleTimeString(),
        msg: `🔗 ${msg}`,
      });
      p.worldCombatLog = p.worldCombatLog.slice(-80);
    }
  }
  isStunned(p: any, now = Date.now()) {
    return (p?.statuses || []).some(
      (s: any) =>
        s === "stunned" || (s?.id === "stunned" && Number(s.until || 0) > now),
    );
  }
  get(id) {
    return this.encounters.get(id);
  }
  syncPartyExecution(e: any) {
    return this.encounterEngine.syncPartyExecution(e);
  }
  recordPartyTimeline(e: any, type: string, data: any = {}) {
    return this.encounterEngine.recordPartyTimeline(e, type, data);
  }
  recordPartyMetric(e: any, p: any, type: string, amount = 0) {
    return this.encounterEngine.recordPartyMetric(e, p, type, amount);
  }
  partyCombatants(e: any, p: any) {
    return this.encounterEngine.partyCombatants(e, p);
  }
  threatTarget(e: any, players: any[]) {
    return this.encounterEngine.threatTarget(e, players);
  }
  roleTarget(e: any, players: any[], role: string) {
    return this.encounterEngine.roleTarget(e, players, role);
  }
  nonTankTarget(e: any, players: any[]) {
    return this.encounterEngine.nonTankTarget(e, players);
  }
  mechanicTargets(e: any, players: any[], scripted: any) {
    return this.encounterEngine.mechanicTargets(e, players, scripted);
  }
  encounterMechanicByName(e: any, name: string) {
    return this.encounterEngine.encounterMechanicByName(e, name);
  }
  bossAIState(e: any, players: any[], n = Date.now()) {
    return this.encounterEngine.bossAIState(e, players, n);
  }
  encounterDirector(e: any, players: any[], pattern: any[], n = Date.now()) {
    return this.encounterEngine.encounterDirector(e, players, pattern, n);
  }
  directorMechanicScore(
    e: any,
    players: any[],
    m: any,
    director: any,
    state: any,
    n = Date.now(),
  ) {
    return this.encounterEngine.directorMechanicScore(
      e,
      players,
      m,
      director,
      state,
      n,
    );
  }
  chooseBossMechanic(e: any, players: any[], pattern: any[], n = Date.now()) {
    return this.encounterEngine.chooseBossMechanic(e, players, pattern, n);
  }
  encounterWorldMeters(e: any, p: any) {
    return this.encounterEngine.encounterWorldMeters(e, p);
  }
  encounterDistanceMeters(e: any, a: any, b: any) {
    return this.encounterEngine.encounterDistanceMeters(e, a, b);
  }
  choreographyMechanic(e: any, pattern: any[], n = Date.now()) {
    return this.encounterEngine.choreographyMechanic(e, pattern, n);
  }
  validateEncounterMechanics(e: any) {
    return this.encounterEngine.validateEncounterMechanics(e);
  }
  applyMechanicStatus(
    target: any,
    id: string,
    until: number,
    modifiers: any = {},
    extra: any = {},
  ) {
    return this.encounterEngine.applyMechanicStatus(
      target,
      id,
      until,
      modifiers,
      extra,
    );
  }
  mechanicFailure(
    e: any,
    kind: string,
    target: any,
    n: number,
    reason: string,
  ) {
    return this.encounterEngine.mechanicFailure(e, kind, target, n, reason);
  }
  resolveOverlapCasts(e: any, players: any[], n = Date.now()) {
    return this.encounterEngine.resolveOverlapCasts(e, players, n);
  }
  enemyTick(p: any, n: number) {
    return this.encounterEngine.enemyTick(p, n);
  }
  applyMechanicDamage(e: any, target: any, cast: any, n: number) {
    return this.encounterEngine.applyMechanicDamage(e, target, cast, n);
  }
  shouldTickEncounter(p: any) {
    const e = p?.encounterId ? this.get(p.encounterId) : null;
    if (!e || e.state !== "running") return false;
    const members = this.partyCombatants(e, p);
    if (!members.length) return false;
    let driver = members.find((m: any) => m.id === e.driverId);
    if (!driver) {
      driver = members[0];
      e.driverId = driver.id;
    }
    return driver.id === p.id;
  }
  partyFailureState(e: any, now = Date.now()) {
    if (!e?.partyExecution) return null;
    const expected = new Set(e.partyExecution.expectedMemberIds || []);
    const members = (this.world?.players || []).filter(
      (x: any) =>
        x &&
        expected.has(x.id) &&
        (e.partyExecution.partyId
          ? x.partyId === e.partyExecution.partyId
          : x.encounterId === e.id),
    );
    const active = members.filter(
      (x: any) => x.online && !x.dead && x.encounterId === e.id,
    );
    const tanks = active.filter((x: any) => partyRole(x) === "Tank");
    const healers = active.filter((x: any) => partyRole(x) === "Healer");
    const support = active.filter((x: any) => partyRole(x) === "Support");
    const recovery = (e.partyExecution.recovery = e.partyExecution.recovery || {
      state: "ACTIVE",
      wipeCount: 0,
    });
    const roleFailure = (e.partyExecution.roleFailure = e.partyExecution
      .roleFailure || {
      tank: "ACTIVE",
      healer: "ACTIVE",
      support: "ACTIVE",
      graceMs: 60000,
    });
    const update = (role: any, available: boolean) => {
      const prev = roleFailure[role];
      if (available && prev !== "ACTIVE") {
        roleFailure[role] = "ACTIVE";
        this.recordPartyTimeline(e, "role_recovered", { role });
      } else if (!available && prev === "ACTIVE") {
        roleFailure[role] = "FAILED";
        roleFailure[`${role}FailedAt`] = now;
        this.recordPartyTimeline(e, "role_failure", {
          role,
          graceMs: roleFailure.graceMs,
        });
      }
    };
    update("tank", tanks.length > 0);
    update("healer", healers.length > 0);
    update("support", support.length > 0);
    if (!tanks.length && active.length) {
      const fallback = active
        .slice()
        .sort(
          (a: any, b: any) =>
            Number(e.threat[b.id] || 0) - Number(e.threat[a.id] || 0),
        )[0];
      if (fallback) {
        e.currentThreatTarget = fallback.id;
        e.forcedTarget = { id: fallback.id, until: now + 2500 };
        this.recordPartyTimeline(e, "tank_fallback", {
          targetId: fallback.id,
          name: fallback.name,
        });
      }
    }
    if (!healers.length && active.length) {
      recovery.healerMissing = true;
      recovery.healerMissingAt = recovery.healerMissingAt || now;
      e.partyExecution.metrics.healerFailures =
        Number(e.partyExecution.metrics.healerFailures || 0) + 1;
      if (
        !recovery.healerPressureAt ||
        now - recovery.healerPressureAt >= 5000
      ) {
        recovery.healerPressureAt = now;
        for (const m of active) {
          m.hp = Math.max(
            1,
            Math.round(Number(m.hp || 1) - Number(m.maxHp || 1) * 0.025),
          );
        }
        this.recordPartyTimeline(e, "healer_pressure", { damagePct: 2.5 });
      }
    } else recovery.healerMissing = false;
    if (!active.length && e.state === "running") {
      e.state = "wiped";
      recovery.state = "WIPE_PENDING";
      recovery.wipeReason = "party_defeat";
      this.recordPartyTimeline(e, "wipe_pending", { reason: "party_defeat" });
    }
    return {
      active: active.length,
      tanks: tanks.length,
      healers: healers.length,
      support: support.length,
      roleFailure,
      recovery,
    };
  }
  reconnectPartyMember(p: any) {
    if (!p?.partyId) return [true, null];
    const instanceId = p.dungeon?.instanceId;
    for (const e of this.encounters.values()) {
      if (
        e.state !== "running" ||
        !e.partyExecution?.expectedMemberIds?.includes(p.id)
      )
        continue;
      if (instanceId && e.dungeonId !== p.dungeon?.id) continue;
      p.encounterId = e.id;
      p.combat = p.combat || {};
      p.combat.currentThreatTarget = e.currentThreatTarget || null;
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
      m.online = true;
      m.reconnectedAt = Date.now();
      e.partyExecution.reconnects =
        Number(e.partyExecution.reconnects || 0) + 1;
      this.recordPartyTimeline(e, "party_reconnect", {
        playerId: p.id,
        name: p.name,
      });
      return [true, { resumed: true, encounterId: e.id }];
    }
    return [true, null];
  }

  cleanupOrphans(players: any[] = [], now = Date.now()) {
    const active = new Set(
      players
        .filter((p: any) => p?.online && p?.encounterId)
        .map((p: any) => p.encounterId),
    );
    for (const [id, e] of this.encounters) {
      if (
        e.state !== "running" ||
        !active.has(id) ||
        now - Number(e.combatStartedAt || now) > 45 * 60 * 1000
      )
        this.encounters.delete(id);
    }
  }
  rangeMeters(p, meters) {
    return (
      Number(meters) /
      Math.max(
        1,
        Number(
          this.world?.worldMetersFor?.(p.zone) ||
            this.world?.byId?.[p.zone]?.worldMeters ||
            10000,
        ),
      )
    );
  }
  faceTarget(p, target: any) {
    if (!target || target === p) return;
    const dx = Number(target.x || 0) - Number(p.x || 0),
      dy = Number(target.y || 0) - Number(p.y || 0),
      d = Math.hypot(dx, dy) || 1;
    p.facingX = dx / d;
    p.facingY = dy / d;
  }
  abilityRangeNormalized(p, a) {
    const zoneMeters = Number(
      this.world?.worldMetersFor?.(p.zone) ||
        this.world?.byId?.[p.zone]?.worldMeters ||
        10000,
    );
    const raw = Number(a?.range || 0);
    const rangedClass = RANGED_CLASSES;
    const rangedFloor =
      rangedClass.has(String(p?.classId || "")) && raw >= 30
        ? Math.max(raw, COMBAT_RANGES.rangedAbilityMeters)
        : raw;
    return normalizeAbilityRange(
      rangedFloor,
      zoneMeters,
      COMBAT_RANGES.meleeMeters,
    );
  }
  abilityRangeMeters(p, a) {
    return (
      this.abilityRangeNormalized(p, a) *
      Math.max(1, Number(this.world?.byId?.[p.zone]?.worldMeters || 10000))
    );
  }
  start(p: any, enemyId: string, context: any = {}) {
    if (p.encounterId || p.worldCombatMobId)
      return [false, "Already in combat."];
    const d = this.enemies[enemyId];
    if (!d) return [false, "Unknown enemy."];
    const encounterOverride = context.mechanicsOverride || null;
    let enemyForEncounter = encounterOverride
      ? {
          ...d,
          ...encounterOverride,
          encounterMechanics: encounterOverride.mechanics,
          mechanicFailureLimit:
            encounterOverride.mechanicFailureLimit || d.mechanicFailureLimit,
          mechanicFailureWindowSec:
            encounterOverride.mechanicFailureWindowSec ||
            d.mechanicFailureWindowSec,
        }
      : { ...d };
    if (context.dungeonId) {
      const delta = Math.max(0, Number(p.level || 1) - Number(d.level || 1));
      const tierModifier = Math.max(
        1,
        Number(context.dungeonTierModifier || 1),
      );
      const hpScale = Math.pow(1.06, delta) * (1 + (tierModifier - 1) * 0.55);
      const atkScale = Math.pow(1.035, delta) * (1 + (tierModifier - 1) * 0.28);
      const armorScale =
        Math.pow(1.028, delta) * (1 + (tierModifier - 1) * 0.22);
      enemyForEncounter = {
        ...enemyForEncounter,
        level: Math.max(Number(d.level || 1), Number(p.level || 1)),
        maxHp: Math.max(
          1,
          Math.round(Number(enemyForEncounter.maxHp || d.maxHp || 1) * hpScale),
        ),
        attack: Math.max(
          1,
          Math.round(
            Number(enemyForEncounter.attack || d.attack || 1) * atkScale,
          ),
        ),
        armor: Math.max(
          0,
          Math.round(
            Number(enemyForEncounter.armor || d.armor || 0) * armorScale,
          ),
        ),
        xp: Math.max(
          1,
          Math.round(
            Number(enemyForEncounter.xp || d.xp || 1) * Math.pow(1.07, delta),
          ),
        ),
        gold: Math.max(
          0,
          Math.round(
            Number(enemyForEncounter.gold || d.gold || 0) *
              Math.pow(1.03, delta),
          ),
        ),
      };
    }
    const e = {
      id: runtimeId("enc"),
      enemy: { ...enemyForEncounter },
      enemyHp: enemyForEncounter.maxHp,
      maxHp: enemyForEncounter.maxHp,
      statuses: [],
      threat: { [p.id]: 1 },
      log: [],
      state: "running",
      phase: 1,
      cast: null,
      lastEnemyAt: Date.now(),
      lastCombatId: p.id,
      ownerId: p.id,
      driverId: p.id,
      dungeonId: context.dungeonId || null,
      stage: context.stage ?? null,
      room: context.room || null,
      bossPosition: {
        x: Number(context.room?.x ?? p.x),
        y: Number(context.room?.y ?? p.y),
      },
      optionalRoomId: context.optionalRoomId || null,
      combatStartedAt: Date.now(),
      nextMechanicAt: Date.now() + 2500,
      nextBasicAt: Date.now() + 1800,
      mechanicIndex: 0,
      forcedTarget: null,
      ccDiminishing: {},
      enemyStatuses: [],
      mechanicFailures: 0,
      mechanicFailureAt: 0,
      encounterMechanicState: {},
      activeOverlapCasts: [],
      overlapSequence: 0,
      groundEffects: [],
      choreography: {
        phase: 1,
        step: 0,
        patternId: null,
        lastMechanic: null,
        history: [],
      },
      bossAI: {
        state: "IDLE",
        lastState: "IDLE",
        lastDecisionAt: 0,
        decisionCount: 0,
        reason: null,
        selectedMechanic: null,
        mechanicCooldowns: {},
        history: [],
        director: {
          version: "4.5",
          phaseBudget: 0,
          overlapBudget: 0,
          addBudget: 0,
          pressureBudget: 0,
          recoveryWindow: false,
          lastBudgetAt: 0,
          lastPlan: null,
          planCount: 0,
        },
      },
      partyExecution: {
        version: "4.3",
        startedAt: Date.now(),
        partyId: p.partyId || null,
        expectedMemberIds: [],
        members: {},
        metrics: {
          damageDone: 0,
          healingDone: 0,
          damageTaken: 0,
          deaths: 0,
          revives: 0,
          mechanicsStarted: 0,
          mechanicsResolved: 0,
          mechanicsFailed: 0,
          mechanicsInterrupted: 0,
          mechanicsAvoided: 0,
          cleanses: 0,
          threatSwaps: 0,
          phaseTransitions: 0,
        },
        timeline: [],
        recovery: {
          state: "ACTIVE",
          wipeCount: 0,
          lastWipeAt: null,
          wipeReason: null,
          checkpointStage: context.stage ?? 0,
        },
      },
    };
    this.encounters.set(e.id, e);
    p.encounterId = e.id;
    p.combat.currentThreatTarget = p.id;
    const initialMembers = this.partyCombatants(e, p);
    e.partyExecution.expectedMemberIds = initialMembers.map((x: any) => x.id);
    for (const member of initialMembers)
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
    this.recordPartyTimeline(e, "encounter_start", {
      memberIds: e.partyExecution.expectedMemberIds,
    });
    return [
      true,
      {
        encounterId: e.id,
        enemy: e.enemy,
        stage: context.stage ?? null,
        partyExecution: e.partyExecution,
      },
    ];
  }
  executePvpBasic(p, target, n = Date.now()) {
    return this.pvp.executePvpBasic(p, target, n);
  }
  executePvpCast(
    p,
    a0,
    targetId = null,
    opponents = [],
    allies = [],
    n = Date.now(),
  ) {
    return this.pvp.executePvpCast(p, a0, targetId, opponents, allies, n);
  }
  requestCast(p, id, targetId = null) {
    let a = this.abilities[id];
    const actor = validateCombatActor(p);
    if (!actor[0]) return actor;
    const own = validateAbilityOwnership(p, id, a);
    if (!own[0]) return own;
    if (!p.encounterId) return [false, "You have no active encounter."];
    a = this.transformedAbility(p, a);
    const e = this.get(p.encounterId);
    if (!e || e.state !== "running")
      return [false, "That fight is no longer active."];
    if (a.purge) {
      const rc = validateResourceAndCooldown(
        p,
        a,
        Date.now(),
        this.abilityResourceCost(p, a),
      );
      if (!rc[0]) return rc;
      const removed = this.cleanseStatuses(
        e.enemy,
        Number(a.purge),
        "beneficial",
      );
      p.resolve -= this.abilityResourceCost(p, a);
      if (a.cooldown)
        p.cooldowns[a.id] =
          Date.now() + (a.cooldown * 1000) / (1 + this.cooldownHaste(p) / 100);
      if (a.gcd)
        p.combat.gcdReadyAt =
          Date.now() + (a.gcd * 1000) / (1 + this.cooldownHaste(p) / 100);
      this.log(
        e,
        `🌀 ${p.name} purges ${removed.length} effect(s) from ${e.enemy.name}.`,
      );
      return [
        true,
        {
          executed: true,
          abilityId: a.id,
          purged: removed.map((x: any) => x.id),
        },
      ];
    }
    if (a.heal || a.partyBuff || a.hot || a.revive) {
      const target = targetId
        ? (this.world?.players || []).find((x: any) => x.id === targetId)
        : p;
      return this.executeEncounterSupport(p, a, e, target);
    }
    return this._request(p, id, e);
  }
  _requestNow(p, id, e) {
    ensureCombatState(p);
    finishRecoveryIfReady(p);
    const a = this.abilities[id];
    if (!a) return [false, "Unknown ability."];
    const n = Date.now();
    if ((p.cooldowns[id] || 0) > n) return [false, `${a.name} is on cooldown.`];
    if (p.resolve < this.abilityResourceCost(p, a))
      return [false, `Not enough ${p.resourceName}.`];
    if (this.isStunned(p, n)) return [false, "You are stunned."];
    if (a.requiresShield && !p.equipment.shield)
      return [false, "You need a shield equipped."];
    if (a.requiresBlock && p.combat.revengeUntil < n)
      return [false, "Revenge requires a recent block."];
    if (a.gcd > 0 && p.combat.gcdReadyAt > n) {
      if (a.queueable) {
        const q = queueAbility(
          p,
          id,
          String(p.combat.currentActionId || ""),
          Number(a?.combatFeel?.priority || 0),
          n,
          false,
        );
        return [true, { ...q, queued: true, abilityId: id }];
      }
      return [false, "Global cooldown is active."];
    }
    return this.execute(p, e, a, n);
  }
  applyControl(
    target: any,
    id: string,
    durationSeconds: number,
    n = Date.now(),
    source: any = null,
  ) {
    if (!target || durationSeconds <= 0) return 0;
    const key = String(id || "stunned");
    target.combat = target.combat || {};
    target.combat.ccDiminishing = target.combat.ccDiminishing || {};
    const dr = target.combat.ccDiminishing[key] || { level: 0, resetAt: 0 };
    if (n >= Number(dr.resetAt || 0)) dr.level = 0;
    const multipliers = [1, 0.5, 0];
    const applied =
      durationSeconds * multipliers[Math.min(2, Number(dr.level) || 0)];
    dr.level = Math.min(2, (Number(dr.level) || 0) + 1);
    dr.resetAt = n + 18000;
    target.combat.ccDiminishing[key] = dr;
    if (applied <= 0) return 0;
    const rootward = target.combat?.rootwardUntil > n ? 0.65 : 1;
    const sourceControl = source?.bonuses?.controlDuration || 0;
    const finalMultiplier = 1 + Number(sourceControl) / 100;
    const finalDuration = applied * rootward * finalMultiplier;
    target.statuses = target.statuses || [];
    target.statuses = target.statuses.filter((x: any) => x?.id !== key);
    target.statuses.push({
      id: key,
      until: n + finalDuration * 1000,
      sourcePlayerId: source?.id || null,
      description: `${key} control`,
      icon: key === "stunned" ? "💫" : "⛓️",
    });
    target.stunnedUntil =
      key === "stunned" ? n + finalDuration * 1000 : target.stunnedUntil || 0;
    return finalDuration;
  }
  applyEnemyControl(
    e: any,
    id: string,
    durationSeconds: number,
    n = Date.now(),
    source: any = null,
  ) {
    if (!e || durationSeconds <= 0) return 0;
    e.ccDiminishing = e.ccDiminishing || {};
    const key = String(id || "stunned");
    const dr = e.ccDiminishing[key] || { level: 0, resetAt: 0 };
    if (n >= Number(dr.resetAt || 0)) dr.level = 0;
    const multipliers = [1, 0.5, 0];
    const applied =
      durationSeconds * multipliers[Math.min(2, Number(dr.level) || 0)];
    dr.level = Math.min(2, (Number(dr.level) || 0) + 1);
    dr.resetAt = n + 18000;
    e.ccDiminishing[key] = dr;
    if (applied <= 0) return 0;
    e.statuses = e.statuses || [];
    e.statuses.push({
      id: key,
      until: n + applied * 1000,
      sourcePlayerId: source?.id || null,
    });
    return applied;
  }
  applyMobControl(
    target: any,
    id: string,
    durationSeconds: number,
    n = Date.now(),
  ) {
    if (!target || durationSeconds <= 0) return 0;
    target.ccDiminishing = target.ccDiminishing || {};
    const key = String(id || "stunned");
    const dr = target.ccDiminishing[key] || { level: 0, resetAt: 0 };
    if (n >= Number(dr.resetAt || 0)) dr.level = 0;
    const applied =
      durationSeconds * [1, 0.5, 0][Math.min(2, Number(dr.level) || 0)];
    dr.level = Math.min(2, (Number(dr.level) || 0) + 1);
    dr.resetAt = n + 18000;
    target.ccDiminishing[key] = dr;
    if (applied <= 0) return 0;
    target.stunnedUntil = n + applied * 1000;
    target.statuses = target.statuses || [];
    target.statuses = target.statuses.filter((x: any) => x?.id !== key);
    target.statuses.push({
      id: key,
      until: target.stunnedUntil,
      description: `${key} control`,
      icon: "💫",
    });
    return applied;
  }
  cleanseStatuses(
    target: any,
    count: number,
    mode: "harmful" | "beneficial" | "any" = "harmful",
  ) {
    if (!target?.statuses?.length) return [];
    const harmful = new Set([
      "poisoned",
      "bleeding",
      "stunned",
      "cursed",
      "rooted",
      "burning",
      "deep_wound",
      "encounter_brand",
      "encounter_anti_heal",
      "encounter_absorb",
      "encounter_tether",
    ]);
    const removed: any[] = [];
    let left = Math.max(0, Number(count) || 0);
    target.statuses = target.statuses.filter((st: any) => {
      if (left <= 0 || !st?.id) return true;
      const isH =
        harmful.has(String(st.id)) ||
        (String(st.id).startsWith("hot_") === false && !!st.damage);
      const isB = !isH && !!st.modifiers;
      const eligible =
        mode === "any" ||
        (mode === "harmful" && isH) ||
        (mode === "beneficial" && isB);
      if (eligible) {
        removed.push(st);
        left--;
        return false;
      }
      return true;
    });
    return removed;
  }
  executeRevive(p, a, e, target, n) {
    if (!target?.dead) return [false, "That ally is not dead."];
    const targetCheck = validateTargetRule(p, a, target, this.world);
    if (!targetCheck[0]) return targetCheck;
    const rc = validateResourceAndCooldown(
      p,
      a,
      n,
      this.abilityResourceCost(p, a),
    );
    if (!rc[0]) return rc;
    if (this.preflight) return [true, "preflight"];
    p.resolve -= this.abilityResourceCost(p, a);
    if (a.cooldown)
      p.cooldowns[a.id] =
        n + (a.cooldown * 1000) / (1 + this.cooldownHaste(p) / 100);
    if (a.gcd) p.combat.gcdReadyAt = n + this.gcdMs(p, a);
    target.dead = false;
    target.respawnReady = false;
    target.respawnAt = 0;
    target.hp = Math.max(
      1,
      Math.round(target.maxHp * Number(a.revive?.health || 0.35)),
    );
    target.resolve = target.maxResolve;
    target.respawnMessage = null;
    target.encounterId = e?.id || p.encounterId || null;
    target.worldCombatMobId = null;
    target.targetMobId = null;
    target.targetPlayerId = null;
    target.combat = target.combat || {};
    target.combat.autoAttack = true;
    target.combat.autoApproach = false;
    target.combat.manualMove = false;
    target.combat.queuedAbility = null;
    target.combat.queuedWorldAbility = null;
    if (e?.threat)
      e.threat[target.id] = Math.max(
        1,
        Number(e.threat[target.id] || 0) * 0.25,
      );
    this.recordPartyMetric(e, p, "revive");
    this.recordPartyTimeline(e, "revive", {
      sourceId: p.id,
      targetId: target.id,
    });
    this.log(e, `✨ ${p.name} revives ${target.name}.`);
    pushFx(p, "revive", p.id, target.id, a.id);
    return [
      true,
      {
        executed: true,
        abilityId: a.id,
        revived: true,
        targetId: target.id,
        health: target.hp,
      },
    ];
  }
  executeEncounterSupport(p, a, e, target) {
    const n = Date.now();
    a = this.transformedAbility(p, a);
    const actor = validateCombatActor(p, n);
    if (!actor[0]) return actor;
    if (a.revive) return this.executeRevive(p, a, e, target, n);
    const targetCheck = validateTargetRule(p, a, target, this.world);
    if (!targetCheck[0]) return targetCheck;
    const rc = validateResourceAndCooldown(
      p,
      a,
      n,
      this.abilityResourceCost(p, a),
    );
    if (!rc[0]) return rc;
    if (this.preflight) return [true, "preflight"];
    p.resolve -= this.abilityResourceCost(p, a);
    if (a.gain)
      p.resolve = Math.min(
        p.maxResolve,
        p.resolve + this.resourceGain(p, a.gain),
      );
    if (a.cooldown)
      p.cooldowns[a.id] =
        n + (a.cooldown * 1000) / (1 + this.cooldownHaste(p) / 100);
    if (a.gcd) p.combat.gcdReadyAt = n + this.gcdMs(p, a);
    const before = target.hp;
    const synergy = this.synergyBeforeAbility(p, a, target, n);
    if (a.heal) {
      const antiHeal = this.statusModifier(target, "healing");
      const effective = Math.max(0, 1 + antiHeal / 100);
      target.hp = Math.min(
        target.maxHp,
        target.hp +
          Math.round(
            target.maxHp *
              a.heal *
              this.healingMultiplier(p) *
              (1 + (p.bonuses?.healing || 0) / 100) *
              (1 + (p.bonuses?.gearAttunementHealing || 0) / 100) *
              effective *
              synergy.multiplier,
          ),
      );
    }
    if (a.cleanse) {
      const removed = this.cleanseStatuses(
        target,
        Number(a.cleanse),
        "harmful",
      );
      if (e && removed.some((x: any) => x?.id === "encounter_brand")) {
        this.recordPartyMetric(e, p, "cleanse");
        this.recordPartyTimeline(e, "mechanic_cleansed", {
          playerId: target.id,
          cleanserId: p.id,
        });
      }
    }
    if (a.dispel) this.cleanseStatuses(target, Number(a.dispel), "beneficial");
    if (a.hot) {
      target.statuses = target.statuses || [];
      const duration =
        a.hot.duration * (1 + Number(p.bonuses?.hotDuration || 0) / 100);
      target.statuses.push({
        id: `hot_${a.id}`,
        until: n + duration * 1000,
        tickHeal: a.hot.tickHeal,
        lastTick: n,
        sourcePlayerId: p.id,
        icon: a.icon,
        snapshotHealingMultiplier:
          this.healingMultiplier(p) / (p?.combat?.rootwardUntil > n ? 1.15 : 1),
        snapshotHealingBonus:
          Number(p.bonuses?.healing || 0) +
          Number(p.bonuses?.hotPower || 0) +
          Number(p.bonuses?.gearAttunementHealing || 0),
      });
    }
    const healed = Math.max(0, target.hp - before);
    this.gearAfterHeal(p, a, healed, n);
    pushFx(p, "skill", p.id, target.id, a.id);
    if (healed > 0) {
      this.recordPartyMetric(e, p, "healingDone", healed);
      e.threat[p.id] =
        (e.threat[p.id] || 0) +
        healingThreat(p, healed) * (1 + Number(p.bonuses?.threat || 0) / 100);
      this.log(
        e,
        `${a.icon} ${p.name} restores ${target.name} for ${healed} health.`,
      );
      pushFx(p, "heal", p.id, target.id, a.id, {
        amount: healed,
        abilityName: a.name,
        icon: a.icon,
        durationMs: 1050,
      });
    }
    if (a.cleanse) pushFx(p, "cleanse", p.id, target.id, a.id);
    this.synergyAfterAbility(p, a, n);
    this.trackRotation(p, a);
    return [
      true,
      {
        executed: true,
        abilityId: a.id,
        healTargetId: target.id,
        heal: healed,
        support: true,
      },
    ];
  }
  execute(p, e, a, n) {
    ensureCombatState(p);
    this.faceTarget(p, e?.enemy);
    a = this.transformedAbility(p, a);
    const actionId = String(
      p.combat.currentActionId || `${Date.now()}-${a.id}`,
    );
    const recoveryUntil =
      n + Math.max(0, Number(a?.combatFeel?.recoveryMs || 0));
    transitionCombat(p, "recovery", n, {
      actionId,
      abilityId: a.id,
      recoveryUntil,
      cancelWindowUntil: n + Number(a?.combatFeel?.cancelWindowMs || 0),
    });
    const gearCast = this.gearBeforeCast(p, a, e.enemy, n);
    if (this.preflight) return [true, "preflight"];
    p.resolve -= this.abilityResourceCost(p, a);
    if (a.gain)
      p.resolve = Math.min(
        p.maxResolve,
        p.resolve + this.resourceGain(p, a.gain),
      );
    if (a.cooldown)
      p.cooldowns[a.id] =
        n + (a.cooldown * 1000) / (1 + this.cooldownHaste(p) / 100);
    if (a.gcd) p.combat.gcdReadyAt = n + this.gcdMs(p, a);
    if (a.movement === "charge" || a.movement === "dash" || a.id === "blink") {
      const targetId = e.currentThreatTarget || e.ownerId || p.id;
      const targetPlayer = this.world?.players?.find((x) => x.id === targetId);
      if (targetPlayer && targetPlayer !== p) {
        const dx = targetPlayer.x - p.x,
          dy = targetPlayer.y - p.y,
          d = Math.hypot(dx, dy) || 1,
          stop = this.world.combatStopDistanceNormalized(p.zone);
        p.x = Math.max(0.01, Math.min(0.99, targetPlayer.x - (dx / d) * stop));
        p.y = Math.max(0.01, Math.min(0.99, targetPlayer.y - (dy / d) * stop));
      } else {
        const dash = normalizeGameDistance(
            a.movementDistance,
            Number(
              this.world?.worldMetersFor?.(p.zone) ||
                this.world?.byId?.[p.zone]?.worldMeters ||
                10000,
            ),
            this.rangeMeters(p, 12),
          ),
          dir = p.combat?.movementDirection || { x: 1, y: 0 };
        p.x = Math.max(0.01, Math.min(0.99, p.x + dir.x * dash));
        p.y = Math.max(0.01, Math.min(0.99, p.y + dir.y * dash));
      }
      p.targetX = p.x;
      p.targetY = p.y;
      p.moveState = "idle";
    }
    if (a.selfBuff) {
      pushFx(p, "skill", p.id, p.id, a.id, {
        abilityName: a.name,
        icon: a.icon,
      });
      const status = this.applySelfBuffStatus(p, a, n);
      const until = status?.until || n;
      if (a.selfBuff === "guard") p.combat.guardUntil = until;
      if (a.selfBuff === "shield_wall") p.combat.shieldWallUntil = until;
      if (a.selfBuff === "arcane_surge") p.combat.arcaneSurgeUntil = until;
      if (a.selfBuff === "arcane_echo") p.combat.arcaneEchoUntil = until;
      if (a.selfBuff === "trueshot") p.combat.trueshotUntil = until;
      if (a.selfBuff === "shadow_dance") p.combat.shadowDanceUntil = until;
      if (a.selfBuff === "barrier" || a.selfBuff === "smoke_bomb")
        p.combat.barrierUntil = until;
      if (a.selfBuff === "stealth") p.combat.stealthUntil = until;
      if (a.selfBuff === "rootward") p.combat.rootwardUntil = until;
      if (a.selfBuff === "barrier" || a.selfBuff === "smoke_bomb") {
        const st = p.statuses[p.statuses.length - 1];
        st.absorbRemaining = this.barrierAmount(p, a);
        st.absorbMax = st.absorbRemaining;
        st.until = until;
      }
      if (a.id === "frenzy") p.combat.frenzyUntil = until;
      if (a.taunt && p.encounterId) {
        const encounter = this.get(p.encounterId);
        if (encounter && encounter.state === "running") {
          const maxThreat = Math.max(
            1,
            ...Object.values(encounter.threat || {}).map(
              (v: any) => Number(v) || 0,
            ),
          );
          encounter.threat[p.id] = Math.max(
            Number(encounter.threat[p.id] || 0),
            maxThreat + 1,
          );
          encounter.forcedTarget = {
            id: p.id,
            until: Date.now() + Number(a.tauntDuration || 3) * 1000,
          };
          encounter.currentThreatTarget = p.id;
          for (const member of this.partyCombatants(encounter, p))
            member.combat.currentThreatTarget = p.id;
          this.log(
            encounter,
            `🛡️ ${p.name} taunts ${encounter.enemy.name} for 3 seconds.`,
          );
        }
      }
      if (a.selfBuff === "stealth") {
        for (const other of this.world?.zoneMobs?.(p.zone, p) || []) {
          if (other.aggroTarget === p.id) {
            other.ignoredAggroPlayers = other.ignoredAggroPlayers || {};
            other.ignoredAggroPlayers[p.id] = until;
            other.aggroTarget = null;
            delete other.attackers?.[p.id];
            other.state = "returning";
            other.returning = true;
            other.velocityX = 0;
            other.velocityY = 0;
          }
        }
        p.worldCombatMobId = null;
        p.combat.autoAttack = false;
        p.combat.autoApproach = false;
        p.combat.queuedWorldAbility = null;
      }
      this.trackRotation(p, a);
      return [true, { executed: true, abilityId: a.id, enemyId: e.enemy.id }];
    }
    if (a.heal) {
      const before = p.hp;
      p.hp = Math.min(
        p.maxHp,
        p.hp +
          Math.round(p.maxHp * a.heal * (1 + (p.bonuses?.healing || 0) / 100)),
      );
      return [
        true,
        {
          executed: true,
          abilityId: a.id,
          heal: p.hp - before,
          enemyId: e.enemy.id,
        },
      ];
    }
    pushFx(p, "skill", p.id, e.enemy.id, a.id);
    if (a.aoe?.radius)
      pushFx(p, "aoe", p.id, e.enemy.id, a.id, { radius: a.aoe.radius });
    if (
      Number(a.power) > 0 &&
      !a.selfBuff &&
      attackMisses(p, e.enemy, { boss: isBossLike(e.enemy) })
    ) {
      this.log(e, `${a.icon} ${p.name}'s ${a.name} misses ${e.enemy.name}.`);
      pushFx(p, "miss", p.id, e.enemy.id, a.id, {
        abilityName: a.name,
        icon: a.icon,
        durationMs: 900,
      });
      return [
        true,
        {
          executed: true,
          abilityId: a.id,
          enemyId: e.enemy.id,
          damage: 0,
          crit: false,
          missed: true,
        },
      ];
    }
    const synergy = this.synergyBeforeAbility(p, a, e.enemy, n);
    let power =
      a.power *
      this.buildAbilityMultiplier(p, a.id) *
      this.gearAbilityMultiplier(p, a.id) *
      synergy.multiplier *
      (1 + Number(p.combat.gearNextPowerPct || 0) / 100) *
      (1 + Number(gearCast.powerPct || 0) / 100);
    p.combat.gearNextPowerPct = 0;
    if (p.combat.arcaneSurgeUntil > n) power *= 1.3;
    if (p.combat.arcaneEchoUntil > n) power *= 1.2;
    if (p.combat.trueshotUntil > n) power *= 1.15;
    if (p.combat.shadowDanceUntil > n) power *= 1.2;
    if (p.combat.guardUntil > n) power *= 0.95;
    const offensiveStat =
      a.scaling === "spell"
        ? Number(p.spellPower || p.attack)
        : Number(p.attack || 0);
    const rolled = rollDamage({
      attack: offensiveStat,
      power,
      armor: e.enemy.armor || 0,
      attackerLevel: Number(p.level || 1),
      armorScale: mobArmorScale(e.enemy),
      critChance: Math.max(
        0,
        (p.bonuses?.crit || 0) +
          (p.combat.trueshotUntil > n ? 20 : 0) -
          critSuppression(p, e.enemy, { boss: isBossLike(e.enemy) }),
      ),
      damageBonus:
        Number(p.bonuses?.damage || 0) +
        Number(p.bonuses?.rangeDamage || 0) +
        Number(p.bonuses?.aoeDamage || 0) * (a.aoe?.radius ? 1 : 0) +
        ((this.classProfile(p).damage || 1) - 1) * 100,
    });
    let dmg = Math.max(
      1,
      Math.round(rolled.damage * this.targetDamageTakenMultiplier(e.enemy)),
    );
    pushFx(p, "damage", p.id, e.enemy.id, a.id, {
      amount: dmg,
      crit: !!rolled.crit,
      abilityName: a.name,
      icon: a.icon,
      school: a.scaling === "spell" ? "spell" : "weapon",
      impactFamily: a?.combatFeel?.impactFamily || "weapon",
      hitStopMs: a?.combatFeel?.hitStopMs || 42,
      durationMs: 1050,
    });
    const bossWard = (e.enemy.statuses || []).find(
      (st: any) =>
        st?.id === "encounter_boss_ward" &&
        Number(st.absorbRemaining || 0) > 0 &&
        Number(st.until || 0) > n,
    );
    if (bossWard) {
      const absorbed = Math.min(dmg, Number(bossWard.absorbRemaining || 0));
      bossWard.absorbRemaining -= absorbed;
      dmg -= absorbed;
      this.recordPartyTimeline(e, "boss_ward_absorbed", {
        abilityId: a.id,
        amount: absorbed,
        remaining: bossWard.absorbRemaining,
      });
      if (bossWard.absorbRemaining <= 0)
        e.enemy.statuses = e.enemy.statuses.filter((x: any) => x !== bossWard);
    }
    this.applyOffensiveDebuff(e.enemy, a, p, n);
    if (a.status) {
      const st = a.status;
      const duration =
        Number(st.duration || 5) *
        (1 +
          Number(
            p.bonuses?.[
              st.id === "bleeding" ? "bleedDuration" : "poisonDuration"
            ] || 0,
          ) /
            100);
      const snapshotDamage = Math.max(
        1,
        Math.round(
          Number(st.damage || 0) *
            (1 +
              (Number(
                p.bonuses?.[
                  st.id === "bleeding" ? "bleedDamage" : "poisonDamage"
                ] || 0,
              ) +
                Number(p.bonuses?.dotDamage || 0)) /
                100),
        ),
      );
      e.enemy.statuses = e.enemy.statuses || [];
      e.enemy.statuses = e.enemy.statuses.filter((x: any) => x.id !== st.id);
      e.enemy.statuses.push({
        id: st.id,
        until: n + duration * 1000,
        snapshotDamage,
        lastTick: n,
        sourcePlayerId: p.id,
        description: `${a.name} damage over time`,
        icon: a.icon,
      });
      pushFx(p, "status_apply", p.id, e.enemy.id, a.id, {
        status: st.id,
        statusName: String(st.id).replace(/_/g, " "),
        duration,
        damagePerTick: snapshotDamage,
        icon: a.icon,
        durationMs: 1100,
      });
    }
    if (p.combat.arcaneEchoUntil > n && a.power > 0)
      p.combat.arcaneEchoUntil = 0;
    const crit = rolled.crit;
    if (crit) {
      this.log(e, `🎯 Critical strike!`);
      if (Number(p.bonuses?.gearAttunementCritResourceGain || 0) > 0)
        p.resolve = Math.min(
          p.maxResolve,
          p.resolve + Number(p.bonuses.gearAttunementCritResourceGain),
        );
    }
    e.enemyHp = Math.max(0, e.enemyHp - dmg);
    const gearTriggers = this.gearAfterHit(
      p,
      a,
      e.enemy,
      { damage: dmg, crit, killed: e.enemyHp <= 0 },
      n,
    );
    this.recordPartyMetric(e, p, "damageDone", dmg);
    e.threat[p.id] =
      (e.threat[p.id] || 0) +
      combatThreat(p, dmg, Number(a.threatMultiplier || 1)) *
        (1 + Number(p.bonuses?.threat || 0) / 100);
    this.log(e, `${a.icon} ${p.name} uses ${a.name} for ${dmg} damage.`);
    if (a.stun) {
      const applied = this.applyEnemyControl(
        e,
        "stunned",
        Number(a.stun),
        n,
        p,
      );
      if (applied > 0) {
        this.log(
          e,
          `💫 ${e.enemy.name} is stunned for ${applied.toFixed(2)}s.`,
        );
        pushFx(p, "status", p.id, e.enemy.id, a.id, {
          status: "stunned",
          duration: applied,
        });
      } else this.log(e, `🛡️ ${e.enemy.name} is temporarily immune to stun.`);
    }
    if (a.interrupt && e.cast && e.cast.interruptible !== false) {
      this.log(e, `⛔ ${a.name} interrupts ${e.cast.name}.`);
      this.recordPartyMetric(e, p, "interrupt");
      this.recordPartyTimeline(e, "mechanic_interrupted", {
        playerId: p.id,
        abilityId: a.id,
        overlap: false,
      });
      e.partyExecution &&
        (e.partyExecution.metrics.mechanicsResolved++,
        e.partyExecution.metrics.mechanicsInterrupted);
      e.cast = null;
    } else if (a.interrupt && e.cast && e.cast.interruptible === false) {
      this.log(e, `🛡️ ${e.cast.name} cannot be interrupted.`);
    } else if (a.interrupt && Array.isArray(e.activeOverlapCasts)) {
      const idx = e.activeOverlapCasts.findIndex(
        (c: any) => c.interruptible !== false,
      );
      if (idx >= 0) {
        const c = e.activeOverlapCasts[idx];
        e.activeOverlapCasts.splice(idx, 1);
        this.log(e, `⛔ ${a.name} interrupts overlapping ${c.name}.`);
        this.recordPartyMetric(e, p, "interrupt");
        this.recordPartyTimeline(e, "mechanic_interrupted", {
          playerId: p.id,
          abilityId: a.id,
          overlap: true,
          name: c.name,
        });
        e.partyExecution &&
          (e.partyExecution.metrics.mechanicsResolved++,
          e.partyExecution.metrics.mechanicsInterrupted);
      }
    }
    this.synergyAfterAbility(p, a, n);
    if (e.enemyHp <= 0) {
      e.state = "won";
      const participants = (this.world?.players || [])
        .filter((x: any) => x && x.encounterId === e.id)
        .map((x: any) => x.id);
      e.participants = participants;
      for (const member of this.world?.players || [])
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
      return [
        true,
        {
          won: true,
          enemyId: e.enemy.id,
          enemyName: e.enemy.name,
          encounterId: e.id,
          participants,
        },
      ];
    }
    return [
      true,
      {
        executed: true,
        abilityId: a.id,
        enemyId: e.enemy.id,
        damage: dmg,
        crit,
      },
    ];
  }
  processQueue(p, n) {
    if (p?.combat?.casting) return null;
    ensureCombatState(p);
    finishRecoveryIfReady(p, n);
    if (
      p.encounterId &&
      p.combat.queuedAbilities?.length &&
      p.combat.gcdReadyAt <= n
    ) {
      const item = popQueuedAbility(p, n);
      if (!item) return null;
      const r = this.requestCast(p, item.abilityId);
      if (r?.[1] && typeof r[1] === "object")
        (r[1] as any).requestId = item.requestId;
      return r;
    }
    if (p.encounterId && p.combat.queuedAbility && p.combat.gcdReadyAt <= n) {
      const id = p.combat.queuedAbility;
      p.combat.queuedAbility = null;
      return this.requestCast(p, id);
    }
    return null;
  }
  autoAttack(p, n) {
    if (p?.combat?.casting) return null;
    if (!p.encounterId || !p.combat.autoAttack) return null;
    const e = this.get(p.encounterId);
    if (!e || e.state !== "running") return null;
    const a = this.abilities.basic_strike;
    if (p.combat.gcdReadyAt > n || p.combat.queuedAbility) return null;
    return this.execute(p, e, a, n);
  }
  executeWorldSupport(p, a, n, targetId = null) {
    if ((p.cooldowns[a.id] || 0) > n)
      return [false, `${a.name} is on cooldown.`];
    if (p.resolve < this.abilityResourceCost(p, a))
      return [false, `Not enough ${p.resourceName}.`];
    if (this.isStunned(p, n)) return [false, "You are stunned."];
    if (a.gcd > 0 && p.combat.gcdReadyAt > n) {
      if (a.queueable) {
        const q = queueAbility(
          p,
          a.id,
          String(p.combat.currentActionId || ""),
          Number(a?.combatFeel?.priority || 0),
          n,
          true,
        );
        return [true, { ...q, queued: true, abilityId: a.id }];
      }
      return [false, "Global cooldown is active."];
    }
    const party =
      this.world?.players?.filter(
        (x: any) =>
          x &&
          x.online &&
          !x.dead &&
          x.zone === p.zone &&
          x.partyId &&
          x.partyId === p.partyId,
      ) || [];
    const candidates = party.length ? party : [p];
    let target = targetId
      ? candidates.find((x: any) => x.id === targetId)
      : null;
    if (targetId && !target)
      return [false, "That player is not a valid party support target."];
    if (!target)
      target =
        candidates
          .slice()
          .sort((a: any, b: any) => a.hp / a.maxHp - b.hp / b.maxHp)[0] || p;
    if (
      Math.hypot(target.x - p.x, target.y - p.y) >
      this.abilityRangeNormalized(p, a)
    )
      return [false, `${a.name} is out of support range.`];
    if (this.preflight) return [true, "preflight"];
    p.resolve -= this.abilityResourceCost(p, a);
    if (a.gain)
      p.resolve = Math.min(
        p.maxResolve,
        p.resolve + this.resourceGain(p, a.gain),
      );
    if (a.cooldown)
      p.cooldowns[a.id] =
        n + (a.cooldown * 1000) / (1 + this.cooldownHaste(p) / 100);
    if (a.gcd) p.combat.gcdReadyAt = n + this.gcdMs(p, a);
    const synergy = this.synergyBeforeAbility(p, a, target, n);
    if (a.partyBuff) {
      const b = a.partyBuff;
      const duration = Math.max(
        1000,
        Number(b.duration || 10) *
          1000 *
          (1 + Number(p.bonuses?.buffDuration || 0) / 100),
      );
      target.statuses = (target.statuses || []).filter(
        (st: any) => st.id !== `buff_${b.id}`,
      );
      target.statuses.push({
        id: `buff_${b.id}`,
        until: n + duration,
        sourcePlayerId: p.id,
        description: `Blessed by ${p.name}.`,
        icon: a.icon,
        modifiers: { ...(b.modifiers || {}) },
      });
      p.worldCombatLog = p.worldCombatLog || [];
      p.worldCombatLog.push({
        t: new Date().toLocaleTimeString(),
        msg: `${a.icon} ${a.name} blesses ${target.name}.`,
      });
      p.worldCombatLog = p.worldCombatLog.slice(-80);
      this.synergyAfterAbility(p, a, n);
      return [
        true,
        {
          executed: true,
          abilityId: a.id,
          buffTargetId: target.id,
          support: true,
        },
      ];
    }
    const before = target.hp;
    const healingBonus =
      Number(p.bonuses?.healing || 0) + this.statusModifier(p, "healing", n);
    const antiHeal = this.statusModifier(target, "healing", n);
    const requestedHeal = Math.max(
      0,
      Math.round(
        target.maxHp *
          (a.heal || 0) *
          (1 + healingBonus / 100) *
          Math.max(0, 1 + antiHeal / 100) *
          synergy.multiplier,
      ),
    );
    target.hp = Math.min(target.maxHp, target.hp + requestedHeal);
    const actualHeal = Math.max(0, target.hp - before);
    if (this.world?.addHealingThreat && actualHeal > 0)
      this.world.addHealingThreat(target, p, actualHeal);
    if (actualHeal > 0) {
      for (const mob of this.world.zoneMobs(target.zone, target)) {
        if (mob.state === "dead") continue;
        if (mob.attackers?.[target.id] || mob.aggroTarget === target.id)
          this.world.addMobThreat(
            mob,
            p,
            Math.max(1, Math.round(actualHeal * 0.5)),
          );
      }
      if (
        p.encounterId &&
        target.encounterId === p.encounterId &&
        actualHeal > 0
      ) {
        const e = this.get(p.encounterId);
        if (e && e.state === "running")
          e.threat[p.id] = (e.threat[p.id] || 0) + healingThreat(p, actualHeal);
      }
    }
    if (a.cleanse) this.cleanseStatuses(target, Number(a.cleanse), "harmful");
    if (a.dispel) this.cleanseStatuses(target, Number(a.dispel), "beneficial");
    if (a.hot) {
      target.statuses = target.statuses || [];
      const hotDuration =
        a.hot.duration * (1 + Number(p.bonuses?.hotDuration || 0) / 100);
      target.statuses.push({
        id: `hot_${a.id}`,
        until: n + hotDuration * 1000,
        tickHeal: a.hot.tickHeal,
        lastTick: n,
        snapshotHealingMultiplier:
          this.healingMultiplier(p) / (p?.combat?.rootwardUntil > n ? 1.15 : 1),
        snapshotHealingBonus:
          Number(p.bonuses?.healing || 0) +
          Number(p.bonuses?.hotPower || 0) +
          Number(p.bonuses?.gearAttunementHealing || 0),
        snapshotSynergyMultiplier: synergy.multiplier,
        sourcePlayerId: p.id,
      });
      this.synergyAfterAbility(p, a, n);
    }
    p.worldCombatLog = p.worldCombatLog || [];
    p.worldCombatLog.push({
      t: new Date().toLocaleTimeString(),
      msg: `${a.icon} ${a.name} restores ${target.name} for ${actualHeal} health.`,
    });
    p.worldCombatLog = p.worldCombatLog.slice(-80);
    return [
      true,
      {
        executed: true,
        abilityId: a.id,
        healTargetId: target.id,
        heal: actualHeal,
        support: true,
      },
    ];
  }
  statusModifier(p, stat, n = Date.now()) {
    return (p?.statuses || [])
      .filter((s: any) => s && Number(s.until || 0) > n && s.modifiers)
      .reduce(
        (sum: number, s: any) => sum + Number(s.modifiers?.[stat] || 0),
        0,
      );
  }
  queueWorldProjectile(
    p: any,
    a: any,
    target: any,
    damage: number,
    crit: boolean,
    n: number,
    meta: any = {},
  ) {
    return this.projectiles.launch(p, a, target, damage, crit, n, meta);
  }
  applyWorldProjectileImpact(projectile: any, target: any, n: number) {
    return this.projectiles.impact(projectile, target, n);
  }
  tickProjectiles(n = Date.now()) {
    return this.projectiles.tick(n);
  }
  resolveWorldProjectileImpact(projectile: any, target: any, n: number) {
    const p = (this.world?.players || []).find(
      (x: any) => x.id === projectile.playerId,
    );
    if (
      !p ||
      !p.online ||
      p.dead ||
      p.zone !== projectile.zone ||
      !target ||
      target.state === "dead" ||
      target.zone !== projectile.zone
    )
      return [false, "Projectile expired."];
    const a = projectile.ability;
    let damage = Math.max(1, Number(projectile.damage || 1));
    if (projectile.avoidable) {
      const moved =
        Math.hypot(
          Number(target.x) - Number(projectile.launchTargetX),
          Number(target.y) - Number(projectile.launchTargetY),
        ) * Number(this.world?.worldMetersFor?.(target.zone) || 10000);
      if (moved > Number(projectile.collisionRadiusMeters || 1.25)) {
        pushFx(p, "projectile_miss", p.id, target.id, a.id, {
          durationMs: 520,
          reason: "evaded",
        });
        return [
          true,
          {
            executed: true,
            abilityId: a.id,
            projectileMiss: true,
            targetId: target.id,
          },
        ];
      }
    }
    const ward = (target.statuses || []).find(
      (st: any) =>
        st?.id === "encounter_boss_ward" &&
        Number(st.absorbRemaining || 0) > 0 &&
        Number(st.until || 0) > n,
    );
    if (ward) {
      const absorbed = Math.min(damage, Number(ward.absorbRemaining || 0));
      ward.absorbRemaining -= absorbed;
      damage -= absorbed;
      if (ward.absorbRemaining <= 0)
        target.statuses = target.statuses.filter((x: any) => x !== ward);
    }
    pushFx(p, "projectile_impact", p.id, target.id, a.id, {
      durationMs: 320,
      impactFamily: projectile.impactFamily,
      crit: !!projectile.crit,
    });
    if (damage > 0)
      pushFx(p, "damage", p.id, target.id, a.id, {
        amount: damage,
        crit: !!projectile.crit,
        abilityName: a.name,
        icon: a.icon,
        school: projectile.school,
        impactFamily: projectile.impactFamily,
        hitStopMs: a?.combatFeel?.hitStopMs || 42,
        durationMs: 1050,
      });
    const r: any = this.applyAoeDamage(p, target, damage);
    if (
      projectile.crit &&
      Number(p.bonuses?.gearAttunementCritResourceGain || 0) > 0
    )
      p.resolve = Math.min(
        p.maxResolve,
        p.resolve + Number(p.bonuses.gearAttunementCritResourceGain),
      );
    this.gearAfterHit(
      p,
      a,
      target,
      { damage, crit: !!projectile.crit, killed: !!r?.[1]?.killed },
      n,
    );
    if (a.stun && target.state !== "dead") {
      const applied = this.applyMobControl(
        target,
        "stunned",
        Number(a.stun) * (1 + Number(p.bonuses?.stunDuration || 0) / 100),
        n,
      );
      if (applied > 0)
        pushFx(p, "status_apply", p.id, target.id, a.id, {
          status: "stunned",
          statusName: "stunned",
          duration: applied,
          icon: "💫",
          durationMs: 1100,
        });
    }
    if (a.status && target.state !== "dead") {
      target.statuses = target.statuses || [];
      target.statuses = target.statuses.filter(
        (x: any) => x.id !== a.status.id,
      );
      const durationBonus =
        a.status.id === "bleeding"
          ? "bleedDuration"
          : a.status.id === "poisoned"
            ? "poisonDuration"
            : "dotDuration";
      const damageBonus =
        a.status.id === "bleeding"
          ? "bleedDamage"
          : a.status.id === "poisoned"
            ? "poisonDamage"
            : "dotDamage";
      const duration =
        Number(a.status.duration || 5) *
        (1 + Number(p.bonuses?.[durationBonus] || 0) / 100);
      const tickDamage = Math.max(
        1,
        Math.round(
          Number(a.status.damage || 0) *
            (1 + Number(p.bonuses?.[damageBonus] || 0) / 100),
        ),
      );
      target.statuses.push({
        id: a.status.id,
        until: n + duration * 1000,
        damage: tickDamage,
        lastTick: n,
        sourcePlayerId: p.id,
        description: `${a.name} deals ${tickDamage} damage each second for ${duration.toFixed(1)} seconds.`,
        icon: a.icon,
        name: a.status.name || a.status.id,
        damagePerTick: tickDamage,
        duration,
        modifiers: { ...(a.status.modifiers || {}) },
      });
      pushFx(p, "status_apply", p.id, target.id, a.id, {
        status: a.status.id,
        statusName: String(a.status.id).replace(/_/g, " "),
        duration,
        damagePerTick: tickDamage,
        icon: a.icon,
        durationMs: 1100,
      });
    }
    this.applyOffensiveDebuff(target, a, p, n);
    this.synergyAfterAbility(p, a, n);
    if (r?.[1]?.killed) {
      p.lastCombat = { outcome: "victory", enemy: target.name, at: n };
      p.combat.queuedWorldAbility = null;
    }
    return [
      true,
      {
        executed: true,
        abilityId: a.id,
        worldMob: true,
        damage,
        killed: !!r?.[1]?.killed,
        crit: !!projectile.crit,
        targetId: target.id,
        projectileId: projectile.id,
        projectileImpact: true,
        lootPile: r?.[1]?.lootPile,
        participants: r?.[1]?.participants,
        x: target.x,
        y: target.y,
        enemyId: target.type,
        enemyName: target.name,
        xp: target.xp,
        gold: target.gold,
      },
    ];
  }
  requestWorldCastNow(p, id, mob, targetId = null, options: any = {}) {
    let a = this.abilities[id];
    const rangedClass = RANGED_CLASSES;
    if (id === "basic_strike" && rangedClass.has(String(p?.classId || ""))) {
      a = {
        ...a,
        range: 72,
        combatFeel: {
          ...(a?.combatFeel || {}),
          projectile: true,
          projectileKind: "arrow",
          projectileHoming: true,
          projectileTrail: true,
        },
      };
    }
    const actor = validateCombatActor(p);
    if (!actor[0]) return actor;
    const own = validateAbilityOwnership(p, id, a);
    if (!own[0]) return own;
    const n = Date.now();
    a = this.transformedAbility(p, a);
    const selfCenteredAoe = !!(a.aoe?.radius && a.aoe?.center === "self");
    if (a.selfBuff) {
      const rc = validateResourceAndCooldown(
        p,
        a,
        n,
        this.abilityResourceCost(p, a),
      );
      if (!rc[0]) return rc;
      if (a.gcd > 0 && Number(p.combat?.gcdReadyAt || 0) > n)
        return [false, "Global cooldown is active."];
      return this.executeWorld(p, a, mob || null, n);
    }
    if (a.heal || a.partyBuff || a.hot)
      return this.executeWorldSupport(p, a, n, targetId);
    if (["time_stop", "fear"].includes(a.id))
      a.combatAudit = { ...(a.combatAudit || {}), targetRule: "enemy" };
    if (selfCenteredAoe) {
      if ((p.cooldowns[id] || 0) > n)
        return [false, `${a.name} is on cooldown.`];
      if (p.resolve < this.abilityResourceCost(p, a))
        return [false, `Not enough ${p.resourceName}.`];
      if (this.isStunned(p, n)) return [false, "You are stunned."];
      if (a.requiresShield && !p.equipment?.shield)
        return [false, "You need a shield equipped."];
      if (a.requiresBlock && p.combat.revengeUntil < n)
        return [false, "Revenge requires a recent block."];
      if (a.gcd > 0 && p.combat.gcdReadyAt > n) {
        if (a.queueable) {
          const q = queueAbility(
            p,
            id,
            String(p.combat.currentActionId || ""),
            Number(a?.combatFeel?.priority || 0),
            n,
            true,
          );
          return [true, { ...q, queued: true, abilityId: id }];
        }
        return [false, "Global cooldown is active."];
      }
      return this.executeWorld(p, a, null, n, { selfCentered: true });
    }
    if (!mob || mob.state === "dead" || mob.zone !== p.zone)
      return [false, "No valid world target."];
    if ((p.cooldowns[id] || 0) > n) return [false, `${a.name} is on cooldown.`];
    if (p.resolve < this.abilityResourceCost(p, a))
      return [false, `Not enough ${p.resourceName}.`];
    if (this.isStunned(p, n)) return [false, "You are stunned."];
    if (a.requiresShield && !p.equipment.shield)
      return [false, "You need a shield equipped."];
    if (a.requiresBlock && p.combat.revengeUntil < n)
      return [false, "Revenge requires a recent block."];
    const dist = Math.hypot(p.x - mob.x, p.y - mob.y),
      range = this.abilityRangeNormalized(p, a);
    if (!a.selfBuff && !["blink"].includes(a.id) && dist > range) {
      p.targetMobId = mob.id;
      p.targetPlayerId = null;
      p.combat.autoAttack = true;
      p.combat.approachRangeMeters = Math.max(
        1.5,
        this.abilityRangeMeters(p, a),
      );
      const q = queueAbility(
        p,
        id,
        String(p.combat.currentActionId || ""),
        Number(a?.combatFeel?.priority || 0),
        n,
        true,
      );
      const activelySteering = !!p.moveInput;
      if (options?.automatic && p.combat.manualMove) {
        p.combat.autoApproach = false;
        return null;
      }
      if (p.combat.manualMove && !activelySteering) {
        p.combat.manualMove = false;
        p.combat.autoApproach = true;
        p.movementIntent = "combat";
      }
      if (p.combat.manualMove && activelySteering) {
        p.combat.autoApproach = false;
        return [
          true,
          {
            ...q,
            queued: true,
            approaching: false,
            abilityId: a.id,
            targetId: mob.id,
            message: `${a.name} queued. Manual movement remains in control.`,
          },
        ];
      }
      p.combat.autoApproach = true;
      p.movementIntent = "combat";
      const ap = this.world?.approachPoint?.(
        p,
        mob,
        p.combat.approachRangeMeters,
      ) || { x: p.x, y: p.y };
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [
        true,
        {
          ...q,
          queued: true,
          approaching: true,
          abilityId: a.id,
          targetId: mob.id,
          message: `Approaching ${mob.name} to use ${a.name}.`,
        },
      ];
    }
    const isBasicAttack = id === "basic_strike";
    if (isBasicAttack) {
      if (Number(p.combat?.autoAttackNextAt || 0) > n)
        return [false, "Auto-attack is on cooldown."];
      if (Number(p.combat?.gcdReadyAt || 0) > n)
        return [false, "Global cooldown is active."];
    }
    if (!isBasicAttack && a.gcd > 0 && p.combat.gcdReadyAt > n) {
      if (a.queueable) {
        const q = queueAbility(
          p,
          id,
          String(p.combat.currentActionId || ""),
          Number(a?.combatFeel?.priority || 0),
          n,
          true,
        );
        return [true, { ...q, queued: true, abilityId: id }];
      }
      return [false, "Global cooldown is active."];
    }
    return this.executeWorld(p, a, mob, n, { autoAttack: isBasicAttack });
  }
  classProfile(p: any) {
    return p?.combatProfile || {};
  }
  offensiveMultiplier(p: any) {
    return Math.max(0.5, Number(this.classProfile(p).damage || 1));
  }
  healingMultiplier(p: any) {
    let m = Math.max(0.5, Number(this.classProfile(p).healing || 1));
    m *= this.gearActiveMultiplier(p, "healingPct");
    if (p?.combat?.rootwardUntil > Date.now()) m *= 1.15;
    return m;
  }
  barrierAmount(p: any, a: any) {
    const ratio =
      Number(a?.barrierRatio || 0) ||
      {
        barrier: 0.16,
        barkskin: 0.18,
        sanctuary: 0.2,
        holy_aegis: 0.22,
        radiant_barrier: 0.24,
      }[a?.id] ||
      0.15;
    return Math.max(
      1,
      Math.round(
        Number(p.maxHp || 0) *
          ratio *
          (1 + Number(p.bonuses?.healing || 0) / 100) *
          (1 + Number(p.bonuses?.barrierPower || 0) / 100),
      ),
    );
  }
  targetDamageTakenMultiplier(target: any) {
    const now = Date.now();
    return Math.max(
      0.25,
      (target?.statuses || [])
        .filter((s: any) => s && s.until > now && s.modifiers)
        .reduce(
          (m: number, s: any) =>
            m * (1 + Number(s.modifiers.damageTaken || 0) / 100),
          1,
        ),
    );
  }
  applyOffensiveDebuff(target: any, a: any, p: any, n: number) {
    if (!target || target.state === "dead" || !a?.debuff) return;
    const d = a.debuff;
    const duration = Math.max(
      1000,
      Number(d.duration || 5) *
        1000 *
        (1 + Number(p.bonuses?.debuffDuration || 0) / 100),
    );
    target.statuses = target.statuses || [];
    target.statuses = target.statuses.filter((s: any) => s.id !== d.id);
    target.statuses.push({
      id: d.id,
      until: n + duration,
      sourcePlayerId: p.id,
      description: `${a.name} debuff.`,
      icon: a.icon,
      modifiers: { ...(d.modifiers || {}) },
      snapshotDamage:
        d.damage != null
          ? Math.max(
              1,
              Math.round(
                Number(d.damage) * (1 + Number(p.bonuses?.damage || 0) / 100),
              ),
            )
          : undefined,
      lastTick: n,
    });
  }
  executeWorld(p, a, mob, n, options: any = {}) {
    const selfCenteredAoe =
      !!(a.aoe?.center === "self" && a.aoe?.radius) ||
      !!(options?.selfCentered && a.aoe?.radius);
    if (a?.combatFeel?.facing && mob && !selfCenteredAoe)
      this.faceTarget(p, mob);
    if (
      !selfCenteredAoe &&
      !a.selfBuff &&
      !a.heal &&
      !["blink"].includes(a.id) &&
      (!mob ||
        Math.hypot(p.x - mob.x, p.y - mob.y) >
          this.abilityRangeNormalized(p, a))
    )
      return [false, `You are out of range for ${a.name}.`];
    let anchorMob: any = null;
    if (selfCenteredAoe) {
      const radiusNorm = this.rangeMeters(p, Number(a.aoe.radius));
      anchorMob =
        (mob &&
        mob.state !== "dead" &&
        mob.zone === p.zone &&
        Math.hypot(mob.x - p.x, mob.y - p.y) <= radiusNorm
          ? mob
          : null) ||
        (this.world.zoneMobs(p.zone, p) || []).find(
          (x: any) =>
            x.state !== "dead" &&
            Math.hypot(x.x - p.x, x.y - p.y) <= radiusNorm,
        ) ||
        null;
      if (!anchorMob) return [false, "No enemies are within range."];
      p.worldCombatMobId = null;
      p.targetMobId = null;
      p.combat.autoApproach = false;
      p.combat.queuedWorldAbility = null;
    } else if (mob) {
      p.worldCombatMobId = mob.id;
      p.targetMobId = mob.id;
      p.combat.autoAttack = true;
      if (!p.combat.manualMove) {
        p.combat.autoApproach = false;
      }
      p.combat.approachSatisfied = true;
      p.combat.approachRangeMeters = Math.max(
        1.5,
        this.abilityRangeMeters(p, a),
      );
      this.world.engageMobAgainstPlayer(p, mob);
      this.world.enterWorldCombat(p, mob);
    }
    const isAutoAttack =
      options?.autoAttack === true && a.id === "basic_strike";
    const gearCast = this.gearBeforeCast(p, a, anchorMob, n);
    if (this.preflight && !isAutoAttack) return [true, "preflight"];
    const swingSnapshot: any = isAutoAttack
      ? { next: p.combat.autoAttackNextAt, gcd: p.combat.gcdReadyAt }
      : null;
    const spendSnapshot: any = !isAutoAttack
      ? {
          resolve: p.resolve,
          hadCooldown: Object.prototype.hasOwnProperty.call(
            p.cooldowns || {},
            a.id,
          ),
          cooldown: p.cooldowns?.[a.id],
          gcd: p.combat.gcdReadyAt,
        }
      : null;
    if (!isAutoAttack) {
      p.resolve -= this.abilityResourceCost(p, a);
      if (a.gain)
        p.resolve = Math.min(
          p.maxResolve,
          p.resolve + this.resourceGain(p, a.gain),
        );
      if (a.cooldown)
        p.cooldowns[a.id] =
          n + (a.cooldown * 1000) / (1 + this.cooldownHaste(p) / 100);
      if (a.gcd) p.combat.gcdReadyAt = n + this.gcdMs(p, a);
    } else {
      const ranged = RANGED_CLASSES.has(String(p.classId));
      const intervalMs = this.swingMs(
        p,
        Number(a?.combatFeel?.autoAttackIntervalMs || (ranged ? 1800 : 1500)),
      );
      p.combat.autoAttackNextAt = n + intervalMs;
      if (Number(a.gcd || 0) > 0) p.combat.gcdReadyAt = n + this.gcdMs(p, a);
    }
    if (!anchorMob) anchorMob = mob || null;
    p.worldCombatLog = p.worldCombatLog || [];
    const push = (msg) => {
      p.worldCombatLog.push({ t: new Date().toLocaleTimeString(), msg });
      p.worldCombatLog = p.worldCombatLog.slice(-80);
    };
    if (a.purge) {
      const removed = this.cleanseStatuses(mob, Number(a.purge), "beneficial");
      push(
        `🌀 ${a.name} removes ${removed.length} beneficial effect(s) from ${mob.name}.`,
      );
      return [
        true,
        {
          executed: true,
          abilityId: a.id,
          purged: removed.map((x: any) => x.id),
          worldMob: true,
        },
      ];
    }
    if (a.movement === "charge" || a.movement === "dash" || a.id === "blink") {
      const dx = mob.x - p.x,
        dy = mob.y - p.y,
        d = Math.hypot(dx, dy) || 1;
      if (a.id === "blink" && d > 0) {
        const dashFull = normalizeGameDistance(
          a.movementDistance,
          Number(
            this.world?.worldMetersFor?.(p.zone) ||
              this.world?.byId?.[p.zone]?.worldMeters ||
              10000,
          ),
          this.rangeMeters(p, 12),
        );
        const dash = Math.max(
          0,
          Math.min(
            dashFull,
            d - this.world.combatStopDistanceNormalized(p.zone),
          ),
        );
        p.x = Math.max(0.01, Math.min(0.99, p.x + (dx / d) * dash));
        p.y = Math.max(0.01, Math.min(0.99, p.y + (dy / d) * dash));
      } else {
        const stop = this.world.combatStopDistanceNormalized(p.zone);
        p.x = Math.max(0.01, Math.min(0.99, mob.x - (dx / d) * stop));
        p.y = Math.max(0.01, Math.min(0.99, mob.y - (dy / d) * stop));
      }
      p.targetX = p.x;
      p.targetY = p.y;
      p.moveState = "idle";
    }
    if (a.selfBuff) {
      pushFx(p, "skill", p.id, p.id, a.id, {
        abilityName: a.name,
        icon: a.icon,
      });
      const status = this.applySelfBuffStatus(p, a, n);
      const until = status?.until || n;
      if (a.selfBuff === "guard") p.combat.guardUntil = until;
      if (a.selfBuff === "shield_wall") p.combat.shieldWallUntil = until;
      if (a.selfBuff === "arcane_surge") p.combat.arcaneSurgeUntil = until;
      if (a.selfBuff === "arcane_echo") p.combat.arcaneEchoUntil = until;
      if (a.selfBuff === "trueshot") p.combat.trueshotUntil = until;
      if (a.selfBuff === "shadow_dance") p.combat.shadowDanceUntil = until;
      if (a.selfBuff === "barrier" || a.selfBuff === "smoke_bomb")
        p.combat.barrierUntil = until;
      if (a.selfBuff === "stealth") p.combat.stealthUntil = until;
      if (a.selfBuff === "rootward") p.combat.rootwardUntil = until;
      if (a.selfBuff === "barrier" || a.selfBuff === "smoke_bomb") {
        const st = p.statuses[p.statuses.length - 1];
        st.absorbRemaining = this.barrierAmount(p, a);
        st.absorbMax = st.absorbRemaining;
        st.until = until;
      }
      if (a.id === "frenzy") p.combat.frenzyUntil = until;
      if (a.taunt && p.encounterId) {
        const encounter = this.get(p.encounterId);
        if (encounter && encounter.state === "running") {
          const maxThreat = Math.max(
            1,
            ...Object.values(encounter.threat || {}).map(
              (v: any) => Number(v) || 0,
            ),
          );
          encounter.threat[p.id] = Math.max(
            Number(encounter.threat[p.id] || 0),
            maxThreat + 1,
          );
          encounter.forcedTarget = {
            id: p.id,
            until: Date.now() + Number(a.tauntDuration || 3) * 1000,
          };
          encounter.currentThreatTarget = p.id;
          for (const member of this.partyCombatants(encounter, p))
            member.combat.currentThreatTarget = p.id;
          this.log(
            encounter,
            `🛡️ ${p.name} taunts ${encounter.enemy.name} for 3 seconds.`,
          );
        }
      }
      if (a.selfBuff === "stealth") {
        for (const other of this.world?.zoneMobs?.(p.zone, p) || []) {
          if (other.aggroTarget === p.id) {
            other.ignoredAggroPlayers = other.ignoredAggroPlayers || {};
            other.ignoredAggroPlayers[p.id] = until;
            other.aggroTarget = null;
            delete other.attackers?.[p.id];
            other.state = "returning";
            other.returning = true;
            other.velocityX = 0;
            other.velocityY = 0;
          }
        }
        p.worldCombatMobId = null;
        p.combat.autoAttack = false;
        p.combat.autoApproach = false;
        p.combat.queuedWorldAbility = null;
      }
      push(`${a.icon} You use ${a.name}.`);
      return [true, { executed: true, abilityId: a.id }];
    }
    pushFx(p, "skill", p.id, anchorMob?.id || p.id, a.id, {
      abilityName: a.name,
      icon: a.icon,
    });
    if (a.aoe?.radius)
      pushFx(p, "aoe", p.id, anchorMob?.id || p.id, a.id, {
        radius: a.aoe.radius,
        centerX: selfCenteredAoe ? p.x : anchorMob?.x,
        centerY: selfCenteredAoe ? p.y : anchorMob?.y,
      });
    const synergy = this.synergyBeforeAbility(p, a, mob, n);
    let power =
      a.power *
      this.buildAbilityMultiplier(p, a.id) *
      this.gearAbilityMultiplier(p, a.id) *
      synergy.multiplier *
      (1 + Number(p.combat.gearNextPowerPct || 0) / 100) *
      (1 + Number(gearCast.powerPct || 0) / 100);
    p.combat.gearNextPowerPct = 0;
    if (p.combat.arcaneSurgeUntil > n) power *= 1.3;
    if (p.combat.arcaneEchoUntil > n) power *= 1.2;
    if (p.combat.trueshotUntil > n) power *= 1.15;
    if (p.combat.shadowDanceUntil > n) power *= 1.2;
    if (p.combat.frenzyUntil > n) power *= 1.25;
    if (p.combat.guardUntil > n) power *= 0.95;
    if (
      a.id === "eviscerate" &&
      anchorMob &&
      anchorMob.hp / anchorMob.maxHp <= 0.35
    )
      power *= 1.5;
    if (a.id === "ambush" && p.combat.stealthUntil > n) power *= 1.4;
    if (
      a.id === "execution" &&
      anchorMob &&
      anchorMob.hp / anchorMob.maxHp <= 0.3
    )
      power *= 1.65;
    if (
      a.tags?.includes("shadowblade") &&
      a.id !== "ambush" &&
      p.combat.stealthUntil > n
    )
      power *= 1.5;
    if (
      a.id === "doom" &&
      anchorMob &&
      anchorMob.hp / anchorMob.maxHp <= Number(a.executeThreshold || 0.25)
    )
      power *= Number(a.executeMultiplier || 1.4);
    if (a.tags?.includes("range-discipline") && anchorMob) {
      const distance =
        Math.hypot(
          (anchorMob.x || 0) - (p.x || 0),
          (anchorMob.y || 0) - (p.y || 0),
        ) * Number(this.world?.byId?.[p.zone]?.worldMeters || 10000);
      if (distance >= 12) power *= 1.12;
      else if (distance < 5) power *= 0.9;
    }
    const center = selfCenteredAoe ? { x: p.x, y: p.y } : mob;
    const targets: any[] = [];
    if (a.aoe?.radius) {
      const candidates: any[] = [];
      if (anchorMob) candidates.push(anchorMob);
      for (const other of this.world.zoneMobs(p.zone, p) || []) {
        if (!candidates.some((x: any) => x.id === other.id))
          candidates.push(other);
      }
      for (const other of candidates) {
        if (other.state === "dead") continue;
        if (
          Math.hypot(other.x - center.x, other.y - center.y) >
          this.rangeMeters(p, Number(a.aoe.radius))
        )
          continue;
        if (!selfCenteredAoe && targets.length >= (a.aoe.maxTargets || 6))
          break;
        targets.push(other);
      }
      if (!targets.length && !selfCenteredAoe)
        return [false, "No enemies are within range."];
    } else if (mob) targets.push(mob);
    if (!targets.length) return [false, "No valid world target."];
    const killed: any[] = [];
    let totalDamage = 0;
    let anyCrit = false;
    const missed: any[] = [];
    let hitAny = false,
      launched = 0,
      lastFailure = "";
    for (const target of targets) {
      if (
        Number(a.power) > 0 &&
        !a.selfBuff &&
        attackMisses(p, target, { boss: isBossLike(target) })
      ) {
        missed.push(target);
        pushFx(p, "miss", p.id, target.id, a.id, {
          abilityName: a.name,
          icon: a.icon,
          durationMs: 900,
        });
        try {
          this.world.provokeMob?.(p, target);
        } catch {}
        continue;
      }
      const offensiveStat =
        a.scaling === "spell"
          ? Number(p.spellPower || p.attack)
          : Number(p.attack || 0);
      const rolled = rollDamage({
        attack: offensiveStat,
        power,
        armor: target.armor || 0,
        attackerLevel: Number(p.level || 1),
        armorScale: mobArmorScale(target),
        critChance: Math.max(
          0,
          (p.bonuses?.crit || 0) +
            (p.combat.trueshotUntil > n ? 20 : 0) -
            critSuppression(p, target, { boss: isBossLike(target) }),
        ),
        damageBonus:
          Number(p.bonuses?.damage || 0) +
          this.statusModifier(p, "damage") +
          ((this.classProfile(p).damage || 1) - 1) * 100,
      });
      let damage = Math.max(
        1,
        Math.round(rolled.damage * this.targetDamageTakenMultiplier(target)),
      );
      let crit = rolled.crit;
      if (a?.combatFeel?.projectile && !selfCenteredAoe && a.power > 0) {
        this.queueWorldProjectile(p, a, target, damage, crit, n, {
          distanceMeters:
            Math.hypot(target.x - p.x, target.y - p.y) *
            Number(this.world?.worldMetersFor?.(p.zone) || 10000),
        });
        totalDamage += 0;
        hitAny = true;
        launched++;
        anyCrit = anyCrit || crit;
        continue;
      }
      pushFx(p, "damage", p.id, target.id, a.id, {
        amount: damage,
        crit: !!crit,
        abilityName: a.name,
        icon: a.icon,
        school: a.scaling === "spell" ? "spell" : "weapon",
        impactFamily: a?.combatFeel?.impactFamily || "weapon",
        hitStopMs: a?.combatFeel?.hitStopMs || 42,
        durationMs: 1050,
      });
      if (crit) {
        anyCrit = true;
        if (Number(p.bonuses?.gearAttunementCritResourceGain || 0) > 0)
          p.resolve = Math.min(
            p.maxResolve,
            p.resolve + Number(p.bonuses.gearAttunementCritResourceGain),
          );
      }
      const r =
        target.id === anchorMob?.id
          ? this.world.attackMob(
              p,
              target.id,
              damage,
              this.abilityRangeMeters(p, a),
            )
          : this.applyAoeDamage(p, target, damage);
      if (!r?.[0]) {
        lastFailure = String(r?.[1] || "");
        if (
          p.combatFx?.length &&
          p.combatFx[p.combatFx.length - 1]?.type === "damage"
        )
          p.combatFx.pop();
        continue;
      }
      hitAny = true;
      {
        totalDamage += damage;
        if (r[1]?.killed) killed.push(r[1]);
        this.gearAfterHit(
          p,
          a,
          target,
          { damage, crit, killed: !!r[1]?.killed },
          n,
        );
      }
      if (a.stun && target.state !== "dead") {
        const applied = this.applyMobControl(
          target,
          "stunned",
          Number(a.stun) * (1 + Number(p.bonuses?.stunDuration || 0) / 100),
          n,
        );
        if (applied > 0)
          pushFx(p, "status_apply", p.id, target.id, a.id, {
            status: "stunned",
            statusName: "stunned",
            duration: applied,
            icon: "💫",
            durationMs: 1100,
          });
      }
      if (a.status && target.state !== "dead") {
        target.statuses = target.statuses.filter(
          (x: any) => x.id !== a.status.id,
        );
        const durationBonus =
          a.status.id === "bleeding"
            ? "bleedDuration"
            : a.status.id === "poisoned"
              ? "poisonDuration"
              : "dotDuration";
        const damageBonus =
          a.status.id === "bleeding"
            ? "bleedDamage"
            : a.status.id === "poisoned"
              ? "poisonDamage"
              : "dotDamage";
        const duration =
          Number(a.status.duration || 5) *
          (1 + Number(p.bonuses?.[durationBonus] || 0) / 100);
        const damage = Math.max(
          1,
          Math.round(
            Number(a.status.damage || 0) *
              (1 + Number(p.bonuses?.[damageBonus] || 0) / 100),
          ),
        );
        target.statuses.push({
          id: a.status.id,
          until: n + duration * 1000,
          damage,
          lastTick: n,
          sourcePlayerId: p.id,
          description: `${a.name} deals ${damage} damage each second for ${duration.toFixed(1)} seconds.`,
          icon: a.icon,
          name: a.status.name || a.status.id,
          damagePerTick: damage,
          duration,
          modifiers: { ...(a.status.modifiers || {}) },
        });
        pushFx(p, "status_apply", p.id, target.id, a.id, {
          status: a.status.id,
          statusName: String(a.status.id).replace(/_/g, " "),
          duration,
          damagePerTick: damage,
          icon: a.icon,
          durationMs: 1100,
        });
      }
      this.applyOffensiveDebuff(target, a, p, n);
    }
    if (!hitAny && !missed.length) {
      if (swingSnapshot) {
        p.combat.autoAttackNextAt = swingSnapshot.next;
        p.combat.gcdReadyAt = swingSnapshot.gcd;
      }
      if (spendSnapshot) {
        p.resolve = spendSnapshot.resolve;
        if (spendSnapshot.hadCooldown)
          p.cooldowns[a.id] = spendSnapshot.cooldown;
        else delete p.cooldowns[a.id];
        p.combat.gcdReadyAt = spendSnapshot.gcd;
      }
      return [false, lastFailure || "Your attack did not connect."];
    }
    if (p.combat.arcaneEchoUntil > n && !a.selfBuff && a.power > 0)
      p.combat.arcaneEchoUntil = 0;
    if (p.combat.stealthUntil > n && !a.selfBuff) {
      p.combat.stealthUntil = 0;
      p.statuses = p.statuses.filter(
        (x: any) => (typeof x === "string" ? x : x?.id) !== "stealth",
      );
    }
    if (a.selfHeal) {
      const healed = Math.max(
        0,
        Math.min(
          p.maxHp - p.hp,
          Math.round(
            p.maxHp * Number(a.selfHeal || 0) * this.healingMultiplier(p),
          ),
        ),
      );
      if (healed > 0) {
        p.hp += healed;
        this.gearAfterHeal(p, a, healed, n);
        push(`💚 ${a.name} restores ${healed} health to you.`);
      }
    }
    this.synergyAfterAbility(p, a, n);
    if (missed.length === targets.length && missed.length > 0)
      push(
        `${a.icon} ${a.name} misses ${missed.length > 1 ? `${missed.length} targets` : missed[0].name || "the target"}.`,
      );
    else if (launched > 0 && totalDamage === 0)
      push(
        `${a.icon} You use ${a.name}${missed.length ? ` (${missed.length} missed)` : ""}.`,
      );
    else
      push(
        `${a.icon} You use ${a.name} for ${totalDamage}${targets.length > 1 ? ` across ${targets.length} targets` : ""}${missed.length ? ` (${missed.length} missed)` : ""}.`,
      );
    if (a.interrupt) push(`⛔ ${a.name} interrupts the target.`);
    if (killed.length) {
      const primary = killed[0];
      p.lastCombat = {
        outcome: "victory",
        enemy: mob?.name || primary?.enemyId || "Nearby enemies",
        log: [...p.worldCombatLog],
      };
      p.combat.queuedWorldAbility = null;
      return [
        true,
        {
          killed: true,
          worldMob: true,
          damage: totalDamage,
          killedTargets: killed,
          enemyId: mob?.type || primary?.enemyId,
          enemyName: mob?.name || primary?.enemyName || "Nearby enemies",
        },
      ];
    }
    const pendingProjectiles = targets.filter(
      (target: any) =>
        a?.combatFeel?.projectile && !selfCenteredAoe && a.power > 0,
    ).length;
    return [
      true,
      {
        executed: true,
        abilityId: a.id,
        worldMob: true,
        damage: totalDamage,
        crit: anyCrit,
        targets: targets.map((x) => x.id),
        pendingProjectiles,
        projectile: pendingProjectiles > 0,
      },
    ];
  }
  applyAoeDamage(p, target, damage) {
    if (!target || target.state === "dead") return [false, "dead"];
    this.world.addMobThreat(target, p, Math.max(1, damage));
    target.state = "engaged";
    target.returning = false;
    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) return this.world.finalizeMobDeath(p, target);
    return [true, { killed: false, mob: { id: target.id, hp: target.hp } }];
  }
  processWorldQueue(p, n, mob) {
    if (p?.combat?.casting) return null;
    const state = ensureCombatState(p);
    finishRecoveryIfReady(p, n);
    if (p.combat.gcdReadyAt > n) return null;
    if (!state.queuedAbilities?.length && state.queuedWorldAbility) {
      queueAbility(
        p,
        state.queuedWorldAbility,
        String(state.currentActionId || ""),
        0,
        n,
        true,
      );
    }
    const item = state.queuedAbilities?.[0] || null;
    if (!item) return null;
    if (Number(item.expiresAt || 0) <= n) {
      clearCombatQueue(p);
      return null;
    }
    if (!item.world) {
      const r = this.requestCast(p, item.abilityId);
      if (r?.[1] && typeof r[1] === "object")
        (r[1] as any).requestId = item.requestId;
      if (r?.[0]) clearCombatQueue(p);
      return r;
    }
    const ability = this.abilities[item.abilityId];
    const targetless = ability?.aoe?.center === "self" || !!ability?.selfBuff;
    const target = targetless ? null : mob;
    if (!targetless) {
      if (!target || target.state === "dead" || target.zone !== p.zone) {
        clearCombatQueue(p);
        return [false, "No valid world target."];
      }
      const range = this.abilityRangeNormalized(p, ability);
      if (Math.hypot(p.x - target.x, p.y - target.y) > range) {
        return [
          true,
          {
            queued: true,
            approaching: true,
            abilityId: item.abilityId,
            targetId: target.id,
            requestId: item.requestId,
          },
        ];
      }
    }
    const r = this.requestWorldCast(
      p,
      item.abilityId,
      targetless ? null : target,
    );
    if (r?.[1] && typeof r[1] === "object")
      (r[1] as any).requestId = item.requestId;
    if (r?.[0]) clearCombatQueue(p);
    return r;
  }
  autoAttackWorld(p, n, mob, force = false) {
    if (!mob || mob.state === "dead" || !p.worldCombatMobId) return null;
    if (!force && !p.combat.autoAttack) return null;
    if (Number(p.combat?.autoAttackNextAt || 0) > n) return null;
    return this.requestWorldCast(p, "basic_strike", mob, null, {
      automatic: true,
    });
  }
  processMobStatuses(mob, n, p, log) {
    if (!mob?.statuses?.length || mob._statusTickAt === n)
      return { killed: false };
    mob._statusTickAt = n;
    let source = p || null;
    let killingSource = null;
    for (const s of [...mob.statuses]) {
      if (n >= s.until) {
        mob.statuses = mob.statuses.filter((x) => x !== s);
        continue;
      }
      if (n - (s.lastTick || 0) >= 1000) {
        s.lastTick = n;
        if (s.sourcePlayerId && this.world?.players)
          source =
            this.world.players.find((x) => x.id === s.sourcePlayerId) || source;
        const tickDamage = Math.max(0, Number(s.damage || 0));
        if (tickDamage > 0) {
          mob.hp = Math.max(0, mob.hp - tickDamage);
          if (source)
            pushFx(source, "dot", source.id, mob.id, null, {
              amount: tickDamage,
              status: s.id,
              statusName: String(s.id).replace(/_/g, " "),
              icon: s.icon || "🩸",
              durationMs: 950,
            });
          if (source?.worldCombatMobId === mob.id)
            log.push({
              t: new Date().toLocaleTimeString(),
              msg: `${s.id} deals ${tickDamage} damage.`,
            });
          if (mob.hp <= 0) {
            killingSource = source;
            break;
          }
        }
      }
    }
    return { killed: mob.hp <= 0, source: killingSource || source };
  }
  handleDeath(p, log, enemyName) {
    const n = Date.now();
    const encounterId = p.encounterId;
    const worldMobId = p.worldCombatMobId || p.targetMobId;
    p.hp = 0;
    p.dead = true;
    if (encounterId) {
      const e = this.get(encounterId);
      if (e) {
        this.recordPartyMetric(e, p, "death");
        this.recordPartyTimeline(e, "death", { playerId: p.id, name: p.name });
      }
    }
    p.respawnAt = n + 4000;
    p.statuses = (p.statuses || []).filter(
      (s: any) => s && s.modifiers && !String(s.id || "").startsWith("hot_"),
    );
    p.combat.ccDiminishing = p.combat.ccDiminishing || {};
    p.respawnReady = false;
    p.respawnMessage = `You were slain by ${enemyName}.`;
    p.encounterId = null;
    p.worldCombatMobId = null;
    p.targetMobId = null;
    p.targetPlayerId = null;
    p.moveState = "idle";
    p.combat.autoAttack = false;
    clearCombatQueue(p);
    p.combat.autoApproach = false;
    if (encounterId) {
      const e = this.get(encounterId);
      if (e?.threat) delete e.threat[p.id];
      if (e?.currentThreatTarget === p.id) e.currentThreatTarget = null;
      if (e?.cast) {
        e.cast.targetPlayerIds = (e.cast.targetPlayerIds || []).filter(
          (id: any) => id !== p.id,
        );
        if (e.cast.targetPlayerId === p.id) e.cast.targetPlayerId = null;
      }
    }
    if (worldMobId) {
      const mob = this.world?.byIdMob?.(worldMobId);
      if (mob?.attackers) delete mob.attackers[p.id];
      if (mob?.aggroTarget === p.id) mob.aggroTarget = null;
    }
    if (encounterId) {
      const e = this.get(encounterId);
      const party = p.dungeon?.instanceId
        ? (this.world?.players || []).filter(
            (x: any) =>
              x &&
              x.online &&
              x.partyId === p.partyId &&
              x.dungeon?.instanceId === p.dungeon?.instanceId,
          )
        : [p];
      const allDead = party.length > 0 && party.every((x: any) => x.dead);
      if (e && allDead && e.state === "running") {
        e.state = "wiped";
        e.cast = null;
        for (const member of party) {
          if (member.dungeon) {
            member.dungeon.wipePending = true;
            member.dungeon.wipeReason = "party_defeat";
            member.dungeon.recoveryState = "WIPE_PENDING";
          }
          member.combat.autoAttack = false;
          member.combat.autoApproach = false;
          member.combat.queuedAbility = null;
          member.combat.queuedWorldAbility = null;
        }
        e.partyExecution = e.partyExecution || {
          recovery: { state: "ACTIVE", wipeCount: 0 },
          timeline: [],
          metrics: {},
        };
        e.partyExecution.recovery = e.partyExecution.recovery || {
          state: "ACTIVE",
          wipeCount: 0,
        };
        e.partyExecution.recovery.state = "WIPE_PENDING";
        e.partyExecution.recovery.wipeReason = "party_defeat";
        this.recordPartyTimeline(e, "wipe_pending", {
          reason: "party_defeat",
          stage: e.stage,
        });
        this.log(
          e,
          "💀 The entire dungeon party has fallen. Recovery is now available.",
        );
      }
    }
    if (log)
      log.push({
        t: new Date().toLocaleTimeString(),
        msg: "💀 You have died.",
      });
  }
}
export { CombatEngine };
