import crypto from "node:crypto";

const uid = (p: string) => `${p}_${crypto.randomBytes(4).toString("hex")}`;

export const WORLD_EVENT_DEFS: any[] = [
  {
    id: "caravan_under_fire",
    name: "Caravan Under Fire",
    kind: "caravan",
    zone: "eastern_reach",
    durationMs: 180000,
    minLevel: 10,
    maxLevel: 24,
    goal: 12,
    enemyTypes: ["reach_roadbandit"],
    reward: { xp: 220, gold: 90 },
    description:
      "Roadbandits are attacking an Eastwatch supply caravan. Drive them back.",
  },
  {
    id: "corrupted_expedition",
    name: "Corrupted Expedition",
    kind: "expedition",
    zone: "gloamwood",
    durationMs: 180000,
    minLevel: 3,
    maxLevel: 15,
    goal: 10,
    enemyTypes: ["gloam_cultist"],
    reward: { xp: 260, gold: 110 },
    description:
      "A mining expedition has been twisted by the Veil. Purge the corrupted creatures.",
  },
  {
    id: "undead_invasion",
    name: "Undead Invasion",
    kind: "invasion",
    zone: "old_kingdom",
    durationMs: 240000,
    minLevel: 28,
    maxLevel: 60,
    goal: 18,
    enemyTypes: ["kingdom_crownwraith", "kingdom_hollow_knight"],
    reward: { xp: 420, gold: 180 },
    description: "The dead are rising around the ruins. Hold the settlement.",
  },
  {
    id: "village_defense",
    name: "Village Defense",
    kind: "defense",
    zone: "briarfen",
    durationMs: 180000,
    minLevel: 6,
    maxLevel: 22,
    goal: 14,
    enemyTypes: ["reach_roadbandit"],
    reward: { xp: 300, gold: 130 },
    description:
      "Beast packs are closing on the frontier settlement. Protect the villagers.",
  },
  {
    id: "hollow_breach",
    name: "Hollow Breach",
    kind: "invasion",
    zone: "hollow_expanse",
    durationMs: 240000,
    minLevel: 42,
    maxLevel: 60,
    goal: 20,
    enemyTypes: [
      "ashbound_executioner",
      "veilscarred_arcanist",
      "kingdom_hollow_knight",
    ],
    reward: { xp: 700, gold: 280 },
    description:
      "A seal breaks on the apex road. Hold the breach before the Hollow spills into the frontier.",
  },
  {
    id: "veil_anomaly",
    name: "Veil Anomaly",
    kind: "anomaly",
    zone: "ashen_wastes",
    durationMs: 240000,
    minLevel: 24,
    maxLevel: 45,
    goal: 16,
    enemyTypes: ["ashen_reaver", "ashen_hyena"],
    reward: { xp: 500, gold: 220 },
    description:
      "A Veil anomaly is spawning creatures from the ash. Collapse the manifestation.",
  },
  {
    id: "fen_reclamation",
    name: "Fen Reclamation",
    kind: "expedition",
    zone: "briarfen",
    durationMs: 210000,
    minLevel: 9,
    maxLevel: 18,
    goal: 14,
    enemyTypes: ["fen_stalker", "thorn_hag", "marshbone_hound"],
    reward: { xp: 340, gold: 145 },
    description:
      "Reclaim the drowned causeways before the marsh closes over the last lantern posts.",
  },
  {
    id: "sunscar_caravan",
    name: "Sunscar Caravan War",
    kind: "caravan",
    zone: "sunscar_steppe",
    durationMs: 240000,
    minLevel: 17,
    maxLevel: 28,
    goal: 16,
    enemyTypes: ["sunscar_raider", "redmaw_hyena", "ashwing_vulture"],
    reward: { xp: 460, gold: 190 },
    description:
      "Protect the frontier caravan as raiders sweep across the red grasslands.",
  },
  {
    id: "crownfall_rebellion",
    name: "Crownfall Rebellion",
    kind: "invasion",
    zone: "crownfall_expanse",
    durationMs: 240000,
    minLevel: 28,
    maxLevel: 40,
    goal: 18,
    enemyTypes: ["crownfall_revenant", "royal_boneguard", "ashbound_reclaimer"],
    reward: { xp: 620, gold: 250 },
    description:
      "The dead royal court is marching again. Break the uprising before it reaches the living camps.",
  },
  {
    id: "highland_storm",
    name: "Highland Storm",
    kind: "anomaly",
    zone: "veilscar_highlands",
    durationMs: 270000,
    minLevel: 38,
    maxLevel: 52,
    goal: 18,
    enemyTypes: ["veilscar_raider", "aether_wraith", "stormbound_arcanist"],
    reward: { xp: 820, gold: 330 },
    description:
      "An aether storm has opened a wound in the highlands. Survive the storm and collapse its anchor.",
  },
  {
    id: "nightveil_tide",
    name: "Nightveil Black Tide",
    kind: "invasion",
    zone: "nightveil_coast",
    durationMs: 300000,
    minLevel: 50,
    maxLevel: 60,
    goal: 20,
    enemyTypes: ["nightveil_drowned", "nightveil_reaver", "hollowtide_witch"],
    reward: { xp: 1100, gold: 450 },
    description:
      "The black tide has exposed drowned warbands along the coast. Hold Nightveil until the waters recede.",
  },
];

import { WorldConsequenceEngine } from "./WorldConsequenceEngine.js";
import { rollbackOwnedChanges } from "../shared/OwnedRollback.js";

export class WorldEvents {
  defs: any[];
  active: any;
  lastStartAt = 0;
  cooldownMs = 120000;
  world: any;
  repo: any;
  reward: any;
  quest: any;
  simulation: any;
  state: any;
  stateId = "global";
  persistEveryMs = 1500;
  lastPersistAt = 0;
  consequence: any;
  playerMutations: any;
  completingEvents = new Set<string>();
  constructor(
    world: any,
    repo: any,
    rewardFn: any,
    questEngine: any = null,
    consequenceConfig: any = null,
    simulation: any = null,
    playerMutations: any = null,
  ) {
    this.world = world;
    this.repo = repo;
    this.reward = rewardFn;
    this.quest = questEngine;
    this.simulation = simulation;
    this.playerMutations = playerMutations;
    this.consequence = new WorldConsequenceEngine(consequenceConfig || {});
    this.defs = WORLD_EVENT_DEFS.map((def: any) => ({
      ...def,
      enemyTypes: Array.isArray(def.enemyTypes) ? [...def.enemyTypes] : [],
      reward: { ...(def.reward || {}) },
    }));
    this.state = this.normalizeState(repo?.loadWorldState?.(this.stateId));
    this.world.worldEventState = this.state.regions;
    this.lastStartAt = Number(this.state.lastStartAt || 0);
    if (this.state.active) this.restoreActiveEvent();
  }
  syncWorldState() {
    this.world.worldEventState = this.state.regions;
    return this.state.regions;
  }
  normalizeState(raw: any) {
    const base = raw && typeof raw === "object" ? raw : {};
    return {
      version: 3,
      lastStartAt: Number(base.lastStartAt || 0),
      active:
        base.active && typeof base.active === "object" ? base.active : null,
      history: Array.isArray(base.history) ? base.history.slice(-100) : [],
      eventCooldowns:
        base.eventCooldowns && typeof base.eventCooldowns === "object"
          ? base.eventCooldowns
          : {},
      regions:
        base.regions && typeof base.regions === "object" ? base.regions : {},
    };
  }
  persist(force = false, now = Date.now()) {
    if (!force && now - this.lastPersistAt < this.persistEveryMs) return;
    const snapshot = {
      ...this.state,
      active: this.active ? this.serializableEvent(this.active) : null,
      lastStartAt: this.lastStartAt,
    };
    try {
      const result = this.repo?.saveWorldState?.(snapshot, this.stateId);
      if (result && typeof result.then === "function")
        void result.catch((error: any) =>
          console.warn(
            "[world-events] queued state persistence failed:",
            String(error?.message || error),
          ),
        );
      this.lastPersistAt = now;
    } catch (error: any) {
      console.warn(
        "[world-events] queued state persistence failed:",
        String(error?.message || error),
      );
    }
  }
  async persistNow(now = Date.now()) {
    const snapshot = {
      ...this.state,
      active: this.active ? this.serializableEvent(this.active) : null,
      lastStartAt: this.lastStartAt,
    };
    if (typeof this.repo?.saveWorldStateNow === "function")
      await this.repo.saveWorldStateNow(snapshot, this.stateId);
    else if (typeof this.repo?.saveWorldState === "function") {
      await this.repo.saveWorldState(snapshot, this.stateId);
      if (typeof this.repo?.checkpoint === "function")
        await this.repo.checkpoint();
    } else
      throw new Error("Durable world-event state persistence is unavailable.");
    this.lastPersistAt = now;
  }
  private retryCompletion(e: any, reason: string) {
    const id = String(e?.id || "unknown");
    void this.complete(e).catch((error: any) =>
      console.warn(
        `[world-events] ${reason} failed; event remains recoverable (${id}):`,
        String(error?.message || error),
      ),
    );
  }
  serializableEvent(e: any) {
    if (!e) return null;
    return {
      id: e.id,
      defId: e.defId || e.id,
      name: e.name,
      kind: e.kind,
      zone: e.zone,
      durationMs: e.durationMs,
      minLevel: e.minLevel,
      maxLevel: e.maxLevel,
      goal: e.goal,
      enemyTypes: [...(e.enemyTypes || [])],
      reward: { ...(e.reward || {}) },
      description: e.description,
      progress: Number(e.progress || 0),
      phase: e.phase || "opening",
      startedAt: Number(e.startedAt || 0),
      endsAt: Number(e.endsAt || 0),
      participants: [...(e.participants || [])],
      contributions: { ...(e.contributions || {}) },
      completed: !!e.completed,
      failed: !!e.failed,
      failureReason: e.failureReason || null,
      rewardedParticipantIds: [...(e.rewardedParticipantIds || [])].map(String),
      outcomeRecorded: !!e.outcomeRecorded,
      mobIds: [],
    };
  }
  restoreActiveEvent() {
    const now = Date.now();
    const saved = this.state.active;
    if (!saved) return;
    if (saved.completed) {
      this.active = {
        ...saved,
        mobIds: [],
        completed: true,
        failed: !!saved.failed,
        rewardedParticipantIds: Array.isArray(saved.rewardedParticipantIds)
          ? saved.rewardedParticipantIds.map(String)
          : [],
        outcomeRecorded: !!saved.outcomeRecorded,
      };
      if (
        !this.active.failed &&
        (this.active.participants || []).some(
          (id: string) =>
            !this.active.rewardedParticipantIds.includes(String(id)),
        )
      )
        this.retryCompletion(this.active, "startup reward recovery");
      return;
    }
    if (Number(saved.endsAt || 0) <= now) {
      this.active = { ...saved, mobIds: [], completed: false };
      this.fail("server_restart_expired", now);
      return;
    }
    this.active = { ...saved, mobIds: [], completed: false };
    const r = this.regionState(this.active.zone);
    r.status = "active";
    this.consequence.active(r, this.active, now);
    this.syncWorldState();
    this.spawnEventMobs(this.active);
  }
  regionState(zone: string) {
    if (!this.state.regions[zone])
      this.state.regions[zone] = {
        status: "calm",
        completedCount: 0,
        failedCount: 0,
        lastEventId: null,
        lastOutcome: null,
        lastCompletedAt: 0,
        nextEligibleAt: 0,
      };
    return this.state.regions[zone];
  }

  spawnEventMobs(e: any) {
    e.mobIds = [];
    const defs = (this.world.mobDefs || []).filter(
      (d: any) =>
        (e.enemyTypes || []).includes(d.type) &&
        (d.zones || []).includes(e.zone),
    );
    if (!defs.length) return;
    const plan =
      this.consequence.profile(e.defId || e.id, "active")?.regionalWorld
        ?.spawnPlan || {};
    const center =
      e.center &&
      Number.isFinite(Number(e.center.x)) &&
      Number.isFinite(Number(e.center.y))
        ? {
            x: Number(e.center.x),
            y: Number(e.center.y),
            r: Number(e.center.r || 0.12),
          }
        : { x: 0.5, y: 0.5, r: 0.18 };
    const initialCount = Math.max(
      1,
      Math.min(Number(plan.maxEventMobs || 10), Number(plan.initialCount || 6)),
    );
    for (let i = 0; i < initialCount; i++) {
      const def = defs[i % defs.length];
      const m = this.world.spawnMob(def, e.zone, 90000 + i, {
        ...center,
        id: `world_event_${e.id}_${i}`,
      });
      m.worldEventId = e.id;
      m.worldEvent = true;
      m.rare = false;
      m.temper = "aggressive";
      const tuning =
        e.kind === "caravan"
          ? { damage: 1.18, speed: 1.12, aggro: 1.25 }
          : e.kind === "expedition"
            ? { damage: 1.12, speed: 1.05, aggro: 1.15 }
            : e.kind === "invasion"
              ? { damage: 1.2, speed: 1.08, aggro: 1.35 }
              : e.kind === "anomaly"
                ? { damage: 1.25, speed: 1.15, aggro: 1.3 }
                : { damage: 1.1, speed: 1.05, aggro: 1.15 };
      m.baseRuntimeDamageMultiplier = tuning.damage;
      m.baseRuntimeSpeedMultiplier = tuning.speed;
      m.runtimeDamageMultiplier = tuning.damage;
      m.runtimeSpeedMultiplier = tuning.speed;
      m.aggroRangeMeters = Number(m.aggroRangeMeters || 50) * tuning.aggro;
      m.baseAggroRangeMeters = m.aggroRangeMeters;
      m.homeX = m.x;
      m.homeY = m.y;
      m.respawn = 0;
      m.deadUntil = Infinity;
      e.mobIds.push(m.id);
    }
  }
  cleanupEventMobs(e: any) {
    for (const id of e?.mobIds || []) this.world.mobs.delete(id);
    e.mobIds = [];
  }
  snapshotFor(p: any) {
    if (!p?.zone) return null;
    const e = this.active;
    const r = this.regionState(p.zone);
    if (e && e.zone === p.zone)
      return {
        id: e.id,
        name: e.name,
        kind: e.kind,
        zone: e.zone,
        description: e.description,
        goal: e.goal,
        progress: e.progress,
        startedAt: e.startedAt,
        endsAt: e.endsAt,
        participants: e.participants?.length || 0,
        contribution: Number(e.contributions?.[p.id] || 0),
        completed: e.completed || false,
        phase: e.phase || "opening",
        regionalWorld: r.worldState?.regionalWorld || null,
        region: {
          status: r.status,
          completedCount: r.completedCount,
          failedCount: r.failedCount,
          lastOutcome: r.lastOutcome,
          lastEventId: r.lastEventId,
        },
      };
    return {
      id: null,
      name: null,
      kind: null,
      zone: p.zone,
      description: null,
      goal: 0,
      progress: 0,
      startedAt: 0,
      endsAt: 0,
      participants: 0,
      contribution: 0,
      completed: false,
      phase: "calm",
      regionalWorld: r.worldState?.regionalWorld || null,
      region: {
        status: r.status,
        completedCount: r.completedCount,
        failedCount: r.failedCount,
        lastOutcome: r.lastOutcome,
        lastEventId: r.lastEventId,
        lastCompletedAt: r.lastCompletedAt,
        nextEligibleAt: r.nextEligibleAt,
      },
    };
  }
  globalSnapshot() {
    const e = this.active;
    if (!e) return { active: null, regions: this.state.regions };
    return {
      active: {
        id: e.id,
        name: e.name,
        kind: e.kind,
        zone: e.zone,
        goal: e.goal,
        progress: e.progress,
        startedAt: e.startedAt,
        endsAt: e.endsAt,
        completed: !!e.completed,
        phase: e.phase || "opening",
      },
      regions: this.state.regions,
    };
  }
  start(now = Date.now(), forcedId?: string) {
    if (this.active) return false;
    if (now - this.lastStartAt < this.cooldownMs) return false;
    const activePlayers = (this.world.players || []).filter(
      (p: any) => p?.online && p?.hasCharacter && !p.dead,
    );
    const candidates = this.defs.filter((d) => {
      if (!d.zone || !this.world.byId[d.zone]) return false;
      const r = this.regionState(d.zone);
      if (Number(r.nextEligibleAt || 0) > now) return false;
      if (Number(this.state.eventCooldowns[d.id] || 0) > now) return false;
      return activePlayers.some(
        (p: any) =>
          p.zone === d.zone &&
          Number(p.level || 1) >= Number(d.minLevel || 1) &&
          Number(p.level || 1) <= Number(d.maxLevel || 60),
      );
    });
    if (!candidates.length) return false;
    let def = forcedId ? candidates.find((d) => d.id === forcedId) : null;
    if (!def) {
      const recent = new Set(
        this.state.history.slice(-3).map((h: any) => h.defId),
      );
      const fresh = candidates.filter((d) => !recent.has(d.id));
      const pool = fresh.length ? fresh : candidates;
      def = pool[Math.floor(Math.random() * pool.length)];
    }
    this.active = {
      ...def,
      defId: def.id,
      id: uid(`event_${def.id}`),
      progress: 0,
      phase: "opening",
      startedAt: now,
      endsAt: now + def.durationMs,
      participants: [],
      contributions: {},
      completed: false,
      rewardedParticipantIds: [],
      outcomeRecorded: false,
      mobIds: [],
    };
    const r = this.regionState(def.zone);
    r.status = "active";
    r.lastEventId = this.active.id;
    r.lastOutcome = null;
    this.consequence.active(r, this.active, now);
    this.syncWorldState();
    this.spawnEventMobs(this.active);
    this.simulation?.record?.({
      type: "world_event_started",
      source: "WorldEvents",
      actorId: null,
      regionId: def.zone,
      simulationTick: Math.floor(now / 50),
      worldTime: now,
      payload: {
        dangerDelta: 4,
        corruptionDelta: def.kind === "anomaly" ? 3 : 1,
      },
      causes: [`event:${def.id}`],
      consequenceIds: [`region:${def.zone}:active`],
      severity: "regional",
      id: `world-event-start:${this.active.id}`,
    });
    this.lastStartAt = now;
    this.state.lastStartAt = now;
    this.persist(true, now);
    return true;
  }
  onKill(p: any, info: any = {}) {
    const e = this.active;
    if (!e || e.completed || p.zone !== e.zone) return null;
    const enemyId = String(info.enemyId || "");
    if (e.enemyTypes?.length && !e.enemyTypes.includes(enemyId)) return null;
    const ids = [p.id, ...(info.participants || []).map(String)];
    const unique = [...new Set(ids)];
    let gained = 0;
    for (const id of unique) {
      const m = this.repo.getPlayer(id);
      if (!m || !m.online || m.dead || m.zone !== e.zone) continue;
      const level = Number(m.level || 1);
      if (level < Number(e.minLevel || 1) || level > Number(e.maxLevel || 60))
        continue;
      if (!e.participants.includes(m.id)) e.participants.push(m.id);
      e.contributions[m.id] = (e.contributions[m.id] || 0) + 1;
      gained++;
    }
    if (gained) {
      e.progress = Math.min(e.goal, e.progress + 1);
      const ratio = e.goal ? e.progress / e.goal : 1;
      const phase =
        ratio >= 0.75 ? "final" : ratio >= 0.5 ? "escalated" : "opening";
      if (phase !== e.phase) {
        e.phase = phase;
        const r = this.regionState(e.zone);
        this.consequence.updateActivePhase(r, e, phase, Date.now());
        this.syncWorldState();
        if (phase === "escalated" || phase === "final") this.escalate(e, phase);
      }
    }
    this.state.active = this.serializableEvent(e);
    this.persist(true, Date.now());
    if (e.progress >= e.goal) {
      this.retryCompletion(e, "event completion");
    }
    return {
      progress: e.progress,
      goal: e.goal,
      phase: e.phase || "opening",
      completed: !!e.completed,
    };
  }
  escalate(e: any, phase: string) {
    if (!e) return;
    for (const id of e.mobIds || []) {
      const m = this.world.mobs.get(id);
      if (!m || m.state === "dead") continue;
      m.baseRuntimeDamageMultiplier = Math.max(
        Number(m.baseRuntimeDamageMultiplier || 1),
        phase === "final" ? 1.35 : 1.28,
      );
      m.baseRuntimeSpeedMultiplier = Math.max(
        Number(m.baseRuntimeSpeedMultiplier || 1),
        phase === "final" ? 1.22 : 1.16,
      );
    }
    if (phase === "final") {
      const plan =
        this.consequence.profile(e.defId || e.id, "active")?.regionalWorld
          ?.spawnPlan || {};
      const maxMobs = Math.max(1, Number(plan.maxEventMobs || 10));
      const requested = Math.max(0, Number(plan.finalReinforcements || 0));
      const available = Math.max(
        0,
        maxMobs -
          (e.mobIds || []).filter(
            (id: any) => this.world.mobs.get(id)?.state !== "dead",
          ).length,
      );
      const count = Math.min(requested, available);
      const defs = (this.world.mobDefs || []).filter(
        (d: any) =>
          (e.enemyTypes || []).includes(d.type) &&
          (d.zones || []).includes(e.zone),
      );
      if (count > 0 && defs.length) {
        for (let i = 0; i < count; i++) {
          const base = defs[(i + 1) % defs.length];
          const m = this.world.spawnMob(
            base,
            e.zone,
            90000 + e.mobIds.length + i,
            { x: 0.5, y: 0.5, r: 0.12, id: `event_reinforcement_${e.id}_${i}` },
          );
          m.worldEventId = e.id;
          m.worldEvent = true;
          m.rare = false;
          m.temper = "aggressive";
          m.baseRuntimeDamageMultiplier = 1.4;
          m.baseRuntimeSpeedMultiplier = 1.2;
          m.runtimeDamageMultiplier = 1.4;
          m.runtimeSpeedMultiplier = 1.2;
          m.homeX = m.x;
          m.homeY = m.y;
          m.respawn = 0;
          m.deadUntil = Infinity;
          e.mobIds.push(m.id);
        }
      }
    }
  }

  recordOutcome(outcome: string, now = Date.now()) {
    const e = this.active;
    if (!e) return false;
    const r = this.regionState(e.zone);
    if (
      String(r.lastEventId || "") === String(e.id || "") &&
      String(r.lastOutcome || "") === outcome
    )
      return false;
    r.status = "recovering";
    r.lastOutcome = outcome;
    r.lastEventId = e.id;
    r.lastCompletedAt = now;
    r.completedCount =
      Number(r.completedCount || 0) + (outcome === "completed" ? 1 : 0);
    r.failedCount = Number(r.failedCount || 0) + (outcome === "failed" ? 1 : 0);
    r.nextEligibleAt = now + (outcome === "completed" ? 300000 : 120000);
    this.state.eventCooldowns[e.defId || e.id] = now + 600000;
    this.state.history.push({
      id: e.id,
      defId: e.defId || e.id,
      zone: e.zone,
      kind: e.kind,
      outcome,
      startedAt: e.startedAt,
      endedAt: now,
      progress: Number(e.progress || 0),
      goal: Number(e.goal || 0),
      participants: (e.participants || []).length,
    });
    this.state.history = this.state.history.slice(-100);
    return true;
  }
  async complete(event = this.active) {
    const e = event;
    if (!e || e !== this.active) return;
    const eventId = String(e.id || "");
    if (this.completingEvents.has(eventId)) return;
    this.completingEvents.add(eventId);
    try {
      if (!e.completed) {
        e.completed = true;
        this.cleanupEventMobs(e);
        this.state.active = this.serializableEvent(e);
        await this.persistNow(Date.now());
      }
      if (!Array.isArray(e.rewardedParticipantIds))
        e.rewardedParticipantIds = [];
      for (const rawId of e.participants || []) {
        const id = String(rawId);
        if (e.rewardedParticipantIds.includes(id)) continue;
        const commit = async () => {
          if (e.rewardedParticipantIds.includes(id)) return;
          const p = this.repo.getPlayer(id);
          if (!p || !p.hasCharacter) {
            e.rewardedParticipantIds.push(id);
            this.state.active = this.serializableEvent(e);
            await this.persistNow(Date.now());
            return;
          }
          const rewardKey = `world-event:${String(e.id)}:${id}:reward`;
          if (
            Array.isArray(p._rewardLedger) &&
            p._rewardLedger.includes(rewardKey)
          ) {
            e.rewardedParticipantIds.push(id);
            this.state.active = this.serializableEvent(e);
            await this.persistNow(Date.now());
            return;
          }
          const before = structuredClone(p);
          let attempted: any = null;
          let playerRewardCommitted = false;
          const contribution = Math.max(
            1,
            Number(e.contributions?.[p.id] || 0),
          );
          const bonus = Math.min(0.2, Math.max(0, contribution - 1) * 0.02);
          const xp = Math.round(Number(e.reward?.xp || 0) * (1 + bonus));
          const gold = Math.round(Number(e.reward?.gold || 0) * (1 + bonus));
          try {
            this.reward(p, xp, gold);
            if (this.quest) {
              this.quest.onWorldEvent(p, e.defId || e.id, 1);
              this.quest.onWorldEventConsequence(
                p,
                e.defId || e.id,
                "completed",
                1,
              );
            }
            p.lastWorldEventReward = {
              eventId: e.id,
              eventName: e.name,
              xp,
              gold,
              contribution,
              at: Date.now(),
            };
            attempted = structuredClone(p);
            if (typeof this.repo.savePlayerRewardOnce !== "function")
              throw new Error(
                "Durable world-event reward persistence is unavailable.",
              );
            const committed = await this.repo.savePlayerRewardOnce(
              p,
              rewardKey,
            );
            if (!committed) {
              rollbackOwnedChanges(p, before, attempted);
              e.rewardedParticipantIds.push(id);
              this.state.active = this.serializableEvent(e);
              this.persist(true, Date.now());
              return;
            }
            playerRewardCommitted = true;
            e.rewardedParticipantIds.push(id);
            this.state.active = this.serializableEvent(e);
            await this.persistNow(Date.now());
          } catch (error) {
            e.rewardedParticipantIds = e.rewardedParticipantIds.filter(
              (rewardedId: string) => rewardedId !== id,
            );
            if (!playerRewardCommitted) {
              if (attempted) rollbackOwnedChanges(p, before, attempted);
              else rollbackOwnedChanges(p, before, structuredClone(p));
            }
            throw error;
          }
        };
        try {
          if (this.playerMutations?.withPlayer)
            await this.playerMutations.withPlayer(id, commit);
          else await commit();
        } catch (error) {
          this.repo?.log?.("world_event_reward_failed", {
            eventId,
            playerId: id,
            message: String((error as any)?.message || error),
          });
        }
      }
      const rewardsPending = (e.participants || []).some(
        (id: string) => !e.rewardedParticipantIds.includes(String(id)),
      );
      if (!rewardsPending && !e.outcomeRecorded) {
        const now = Date.now();
        const newOutcome = this.recordOutcome("completed", now);
        if (newOutcome) {
          const r = this.regionState(e.zone);
          this.consequence.apply(r, e, "completed", now);
          this.syncWorldState();
          this.simulation?.record?.({
            type: "world_event_completed",
            source: "WorldEvents",
            actorId: null,
            regionId: e.zone,
            simulationTick: Math.floor(now / 50),
            worldTime: now,
            payload: {
              dangerDelta: -6,
              corruptionDelta: e.kind === "anomaly" ? -8 : -3,
              outcome: "completed",
              participantIds: [...(e.participants || [])],
            },
            causes: [`event:${e.defId || e.id}`],
            consequenceIds: [`region:${e.zone}:completed`],
            severity: "historical",
            id: `world-event-completed:${e.id}`,
          });
        }
        e.outcomeRecorded = true;
      }
      e.endsAt = rewardsPending
        ? Date.now() + 5000
        : Math.min(Number(e.endsAt || Date.now()), Date.now() + 10000);
      this.state.active = this.serializableEvent(e);
      await this.persistNow(Date.now());
    } finally {
      this.completingEvents.delete(eventId);
    }
  }

  fail(reason = "expired", now = Date.now()) {
    const e = this.active;
    if (!e || e.completed) return;
    e.completed = true;
    e.failed = true;
    e.failureReason = reason;
    e.outcomeRecorded = true;
    this.cleanupEventMobs(e);
    const newOutcome = this.recordOutcome("failed", now);
    if (newOutcome) {
      const r = this.regionState(e.zone);
      this.consequence.apply(r, e, "failed", now);
      this.syncWorldState();
      this.simulation?.record?.({
        type: "world_event_failed",
        source: "WorldEvents",
        actorId: null,
        regionId: e.zone,
        simulationTick: Math.floor(now / 50),
        worldTime: now,
        payload: {
          dangerDelta: 10,
          corruptionDelta: e.kind === "anomaly" ? 8 : 4,
          outcome: "failed",
          participantIds: [...(e.participants || [])],
        },
        causes: [`event:${e.defId || e.id}`, `failure:${reason}`],
        consequenceIds: [`region:${e.zone}:failed`],
        severity: "regional",
        id: `world-event-failed:${e.id}`,
      });
    }
    e.endsAt = now + 10000;
    this.persist(true, now);
    void this.persistNow(now).catch((error: any) =>
      console.warn(
        `[world-events] failed-event checkpoint failed (${String(e.id || "unknown")}):`,
        String(error?.message || error),
      ),
    );
  }

  tick(now = Date.now()) {
    if (this.active) {
      if (!this.active.completed && now >= this.active.endsAt) {
        this.fail("time_expired", now);
        return;
      }
      if (this.active.completed && now >= this.active.endsAt) {
        const pendingRewards = (this.active.participants || []).some(
          (id: string) =>
            !(this.active.rewardedParticipantIds || []).includes(String(id)),
        );
        if (pendingRewards) {
          this.retryCompletion(this.active, "pending reward retry");
          this.active.endsAt = now + 5000;
          this.state.active = this.serializableEvent(this.active);
          this.persist(true, now);
          return;
        }
        this.cleanupEventMobs(this.active);
        const r = this.regionState(this.active.zone);
        if (r.status === "recovering" && now >= Number(r.nextEligibleAt || 0)) {
          r.status = "calm";
          this.consequence.apply(r, this.active, "recovering", now);
          this.syncWorldState();
        }
        this.active = null;
        this.state.active = null;
        this.persist(true, now);
        return;
      }
      const r = this.regionState(this.active.zone);
      this.consequence.active(r, this.active, now);
      this.syncWorldState();
      this.state.active = this.serializableEvent(this.active);
      this.persist(false, now);
      return;
    }
    if (now - this.lastStartAt >= this.cooldownMs) {
      this.start(now);
    }
    this.persist(false, now);
  }
}
