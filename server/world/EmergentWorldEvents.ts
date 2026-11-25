import crypto from "node:crypto";

export type EmergentEventKind =
  | "ecological_crisis"
  | "predator_surge"
  | "predator_return"
  | "trade_crisis"
  | "faction_conflict"
  | "regional_crisis"
  | "regional_recovery"
  | "migration_wave";

export type EmergentWorldEvent = {
  id: string;
  kind: EmergentEventKind;
  regionId: string;
  createdTick: number;
  expiresTick: number;
  severity: "local" | "regional" | "historical";
  title: string;
  description: string;
  causes: string[];
  metrics: Record<string, number>;
  status: "active" | "resolved" | "expired";
};

export type EmergentState = {
  schemaVersion: number;
  tick: number;
  active: EmergentWorldEvent[];
  history: EmergentWorldEvent[];
  cooldowns: Record<string, number>;
};

const STATE_ID = "world-emergent-events-v1";
const MAX_ACTIVE = 24;
const MAX_HISTORY = 200;
const MAX_CREATED_PER_TICK = 3;
const EVENT_COOLDOWN = 300;
const EVENT_DURATION = 6000;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function finite(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

export class EmergentWorldEvents {
  repo: any;
  simulation: any;
  ecology: any;
  factions: any;
  state: EmergentState;
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 10000;
  private recentKinds = new Map<string, number>();

  constructor(repo: any, simulation: any, ecology: any, factions: any) {
    this.repo = repo;
    this.simulation = simulation;
    this.ecology = ecology;
    this.factions = factions;
    const raw = repo?.loadWorldState?.(STATE_ID);
    this.state = this.restore(raw);
    for (const [k, v] of Object.entries(this.state.cooldowns || {}))
      this.recentKinds.set(k, Number(v));
  }

  private restore(raw: any): EmergentState {
    return {
      schemaVersion: Math.max(1, finite(raw?.schemaVersion, 1)),
      tick: Math.max(0, finite(raw?.tick, 0)),
      active: Array.isArray(raw?.active) ? raw.active.slice(-MAX_ACTIVE) : [],
      history: Array.isArray(raw?.history)
        ? raw.history.slice(-MAX_HISTORY)
        : [],
      cooldowns: { ...(raw?.cooldowns || {}) },
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }
  metrics() {
    return {
      tick: this.state.tick,
      active: this.state.active.length,
      history: this.state.history.length,
      cooldowns: Object.keys(this.state.cooldowns).length,
    };
  }

  snapshotForRegion(regionId: string) {
    const id = String(regionId);
    return {
      active: this.state.active
        .filter((e) => e.regionId === id)
        .map((e) => ({
          ...e,
          causes: [...e.causes],
          metrics: { ...e.metrics },
        })),
      recent: this.state.history
        .filter((e) => e.regionId === id)
        .slice(-10)
        .map((e) => ({
          ...e,
          causes: [...e.causes],
          metrics: { ...e.metrics },
        })),
    };
  }

  private key(kind: string, regionId: string) {
    return `${kind}:${regionId}`;
  }
  private canCreate(kind: string, regionId: string, tick: number) {
    const key = this.key(kind, regionId);
    return tick >= finite(this.state.cooldowns[key], 0);
  }

  private speciesTotals(region: any) {
    let prey = 0,
      predators = 0,
      scavengers = 0,
      lowSpecies = 0;
    const species = region?.species || {};
    for (const s of Object.values(species) as any[]) {
      const pop = finite(s.population),
        cap = Math.max(1, finite(s.carryingCapacity, 1));
      const ratio = pop / cap;
      if (s.role === "prey") prey += pop;
      else if (s.role === "predator" || s.role === "apex") predators += pop;
      else if (s.role === "scavenger") scavengers += pop;
      if (ratio <= 0.15) lowSpecies++;
    }
    return { prey, predators, scavengers, lowSpecies };
  }

  private candidate(
    regionId: string,
    tick: number,
    world: any,
  ): EmergentWorldEvent | null {
    const sim = this.simulation?.snapshot?.() || {};
    const r = sim.regions?.[regionId] || {};
    const eco = this.ecology?.regionSummary?.(regionId) || {};
    const totals = this.speciesTotals(eco);
    const factionRows = this.factions?.snapshotForRegion?.(regionId) || [];
    const topFaction = factionRows[0];
    const secondFaction = factionRows[1];
    const danger = Number(finite(r.danger)),
      corruption = Number(finite(r.corruption));
    const disturbance = Number(finite(eco.disturbance)),
      recovery = Number(finite(eco.recovery));
    const forage = Number(finite(eco.forage)),
      water = Number(finite(eco.water));
    const pressure = finite(topFaction?.pressure);
    const factionGap = Math.abs(
      finite(topFaction?.influence) - finite(secondFaction?.influence),
    );
    const activePlayers = (world?.players || []).filter(
      (p: any) => p?.online && p?.zone === regionId,
    ).length;
    const baseCauses: string[] = [];

    if (danger >= 82 && corruption >= 65) {
      baseCauses.push(
        `danger:${Math.round(danger)}`,
        `corruption:${Math.round(corruption)}`,
      );
      return this.make(
        "regional_crisis",
        regionId,
        tick,
        "regional",
        "Regional Crisis",
        "Danger and corruption have compounded into a sustained regional crisis.",
        baseCauses,
        { danger, corruption, activePlayers },
        1.2,
      );
    }

    if (
      totals.predators >= Math.max(10, totals.prey * 0.55) &&
      totals.prey > 0
    ) {
      baseCauses.push(
        `predator-prey:${totals.predators.toFixed(0)}:${totals.prey.toFixed(0)}`,
      );
      return this.make(
        "predator_surge",
        regionId,
        tick,
        "regional",
        "Predator Surge",
        "Predator pressure has grown severe enough to threaten the region's prey populations.",
        baseCauses,
        {
          predators: totals.predators,
          prey: totals.prey,
          disturbance,
          recovery,
        },
        1.0,
      );
    }

    if (totals.lowSpecies >= 2 && disturbance >= 35) {
      baseCauses.push(
        `species-collapse:${totals.lowSpecies}`,
        `disturbance:${Math.round(disturbance)}`,
      );
      return this.make(
        "ecological_crisis",
        regionId,
        tick,
        "regional",
        "Ecological Collapse",
        "Multiple wildlife populations are under severe pressure after sustained disturbance.",
        baseCauses,
        { lowSpecies: totals.lowSpecies, disturbance, forage, water },
        1.0,
      );
    }

    if (pressure >= 75 && factionGap <= 25 && danger >= 45 && topFaction) {
      baseCauses.push(
        `faction-pressure:${Math.round(pressure)}`,
        `danger:${Math.round(danger)}`,
      );
      return this.make(
        "faction_conflict",
        regionId,
        tick,
        "regional",
        "Factional Flashpoint",
        `${topFaction.name} is under intense pressure in a contested region, creating a flashpoint.`,
        baseCauses,
        { pressure, danger, factionGap },
        0.9,
      );
    }

    const economy: number = Number(
      Object.values(r.economy || {}).reduce(
        (n: number, v: unknown) => n + Math.abs(Number(finite(Number(v)))),
        0,
      ),
    );
    if (economy >= 70 && (forage < 35 || water < 35 || danger >= 60)) {
      baseCauses.push(
        `economic-stress:${Math.round(economy)}`,
        `resources:${Math.round(Math.min(forage, water))}`,
      );
      return this.make(
        "trade_crisis",
        regionId,
        tick,
        "regional",
        "Trade Route Crisis",
        "Economic stress and regional scarcity are converging on local trade routes.",
        baseCauses,
        { economy, forage, water, danger },
        0.8,
      );
    }

    if (recovery >= 88 && danger <= 20 && disturbance <= 10) {
      baseCauses.push(`recovery:${Math.round(recovery)}`);
      return this.make(
        "regional_recovery",
        regionId,
        tick,
        "local",
        "Signs of Recovery",
        "The region has recovered enough for a new period of growth and opportunity.",
        baseCauses,
        { recovery, danger, disturbance },
        0.55,
      );
    }

    return null;
  }

  private make(
    kind: EmergentEventKind,
    regionId: string,
    tick: number,
    severity: any,
    title: string,
    description: string,
    causes: string[],
    metrics: any,
    multiplier: number,
  ): EmergentWorldEvent {
    const id = `eme_${hash(`${kind}:${regionId}:${tick}:${causes.join("|")}`).slice(0, 20)}`;
    return {
      id,
      kind,
      regionId,
      createdTick: tick,
      expiresTick: tick + Math.round(EVENT_DURATION * multiplier),
      severity,
      title,
      description,
      causes: [...causes],
      metrics: Object.fromEntries(
        Object.entries(metrics).map(([k, v]) => [k, finite(v)]),
      ),
      status: "active",
    };
  }

  tick(simulationTick: number, world: any): EmergentWorldEvent[] {
    const tick = Math.max(this.state.tick, finite(simulationTick));
    this.state.tick = tick;
    let changed = false;
    for (const event of this.state.active) {
      if (event.status === "active" && tick >= event.expiresTick) {
        event.status = "expired";
        changed = true;
      }
    }
    const before = this.state.active.length;
    this.state.active = this.state.active.filter((e) => e.status === "active");
    if (this.state.active.length !== before) changed = true;
    if (tick % 20 !== 0) {
      if (changed) this.persist(false);
      return [];
    }

    const regions = Object.keys(
      this.simulation?.snapshot?.().regions || {},
    ).sort();
    const created: EmergentWorldEvent[] = [];
    for (const regionId of regions) {
      if (
        created.length >= MAX_CREATED_PER_TICK ||
        this.state.active.length >= MAX_ACTIVE
      )
        break;
      const candidate = this.candidate(regionId, tick, world);
      if (!candidate) continue;
      if (!this.canCreate(candidate.kind, regionId, tick)) continue;
      const duplicate = this.state.active.some(
        (e) => e.regionId === regionId && e.kind === candidate.kind,
      );
      if (duplicate) continue;
      const recent = this.state.history.some(
        (e) =>
          e.regionId === regionId &&
          e.kind === candidate.kind &&
          tick - e.createdTick < EVENT_COOLDOWN,
      );
      if (recent) continue;
      this.state.active.push(candidate);
      this.state.history.push(structuredClone(candidate));
      this.state.cooldowns[this.key(candidate.kind, regionId)] =
        tick + EVENT_COOLDOWN;
      this.recentKinds.set(
        this.key(candidate.kind, regionId),
        tick + EVENT_COOLDOWN,
      );
      this.state.history = this.state.history.slice(-MAX_HISTORY);
      created.push(candidate);
      changed = true;

      const payload: any = {
        emergentEventId: candidate.id,
        emergentKind: candidate.kind,
        title: candidate.title,
        description: candidate.description,
        dangerDelta: 0,
        corruptionDelta: 0,
      };
      if (candidate.kind === "regional_crisis") {
        payload.dangerDelta = 4;
        payload.corruptionDelta = 2;
      }
      if (candidate.kind === "predator_surge") {
        payload.dangerDelta = 3;
        payload.population = { wildlife: -1 };
      }
      if (candidate.kind === "ecological_crisis") {
        payload.dangerDelta = 2;
        payload.resources = { forage: -2 };
      }
      if (candidate.kind === "faction_conflict") {
        payload.dangerDelta = 3;
        payload.factionPressure = { contested: 2 };
      }
      if (candidate.kind === "trade_crisis") {
        payload.economy = { trade_route_stress: 2 };
        payload.dangerDelta = 1;
      }
      if (candidate.kind === "regional_recovery") {
        payload.dangerDelta = -2;
        payload.corruptionDelta = -1;
        payload.resources = { recovery: +1 };
      }
      this.simulation?.record?.({
        id: `emergent:${candidate.id}`,
        type: "emergent_world_event",
        source: "emergent_world_events",
        actorId: null,
        regionId,
        simulationTick: tick,
        worldTime: finite(this.simulation?.snapshot?.().worldTime, Date.now()),
        payload,
        causes: candidate.causes,
        consequenceIds: [`emergent:${candidate.kind}`],
        severity: candidate.severity,
      });
    }
    if (changed) this.persist(false);
    return created;
  }

  resolve(id: string, outcome: "resolved" | "expired" = "resolved") {
    const e = this.state.active.find((x) => x.id === id);
    if (!e) return false;
    e.status = outcome;
    this.state.active = this.state.active.filter((x) => x.id !== id);
    this.dirty = true;
    this.persist(false);
    return true;
  }

  persist(force = false, now = Date.now()) {
    if (!this.dirty && !force) return;
    if (!force && now - this.lastPersistAt < this.persistEveryMs) return;
    this.repo?.saveWorldState?.(this.snapshot(), STATE_ID);
    this.lastPersistAt = now;
    this.dirty = false;
  }
  checkpoint(now = Date.now()) {
    this.persist(true, now);
  }
  checkpointIfDirty(now = Date.now()) {
    if (!this.lastPersistAt && !this.dirty) {
      this.lastPersistAt = now;
      return;
    }
    if (
      this.dirty
        ? now - this.lastPersistAt < this.persistEveryMs
        : now - this.lastPersistAt < 300000
    )
      return;
    this.persist(true, now);
  }
}

export const WORLD_EMERGENT_EVENTS_ID = STATE_ID;
