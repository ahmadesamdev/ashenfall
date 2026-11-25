import crypto from "node:crypto";

export type WorldEventSeverity =
  "transient" | "local" | "regional" | "historical";
export type WorldEventRecord = {
  id: string;
  type: string;
  source: string;
  actorId: string | null;
  regionId: string | null;
  simulationTick: number;
  worldTime: number;
  payload: Record<string, unknown>;
  causes: string[];
  consequenceIds: string[];
  severity: WorldEventSeverity;
};

export type RegionalState = {
  population: Record<string, number>;
  resources: Record<string, number>;
  danger: number;
  corruption: number;
  economy: Record<string, number>;
  weather: string;
  factionPressure: Record<string, number>;
  discoveries: Record<string, number>;
  version: number;
  updatedTick: number;
};

export type WorldSimulationState = {
  schemaVersion: number;
  simulationTick: number;
  worldTime: number;
  seed: string;
  regions: Record<string, RegionalState>;
  lastCheckpoint: number;
};

const STATE_ID = "world-simulation-v1";
const LEDGER_ID = "world-event-ledger-v1";
const MAX_LEDGER = 10000;
const MAX_QUEUE = 1000;
const MAX_EVENTS_PER_TICK = 250;

const hashSeed = (seed: string) =>
  crypto.createHash("sha256").update(seed).digest("hex");
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function createRegionalState(): RegionalState {
  return {
    population: {},
    resources: {},
    danger: 0,
    corruption: 0,
    economy: {},
    weather: "clear",
    factionPressure: {},
    discoveries: {},
    version: 1,
    updatedTick: 0,
  };
}

export function reduceRegionalState(
  previous: RegionalState,
  event: WorldEventRecord,
): RegionalState {
  const next: RegionalState = {
    ...previous,
    population: { ...previous.population },
    resources: { ...previous.resources },
    economy: { ...previous.economy },
    factionPressure: { ...previous.factionPressure },
    discoveries: { ...previous.discoveries },
    version: previous.version + 1,
    updatedTick: event.simulationTick,
  };
  const p = event.payload || {};
  if (Number.isFinite(Number(p.dangerDelta)))
    next.danger = clamp(next.danger + finite(p.dangerDelta), 0, 100);
  if (Number.isFinite(Number(p.corruptionDelta)))
    next.corruption = clamp(
      next.corruption + finite(p.corruptionDelta),
      0,
      100,
    );
  if (typeof p.weather === "string") next.weather = p.weather;
  if (p.population && typeof p.population === "object")
    for (const [k, v] of Object.entries(
      p.population as Record<string, unknown>,
    )) {
      const delta = Number(v);
      if (Number.isFinite(delta))
        next.population[k] = Math.max(0, finite(next.population[k], 0) + delta);
    }
  if (p.resources && typeof p.resources === "object")
    for (const [k, v] of Object.entries(
      p.resources as Record<string, unknown>,
    )) {
      const delta = Number(v);
      if (Number.isFinite(delta))
        next.resources[k] = Math.max(0, finite(next.resources[k], 0) + delta);
    }
  if (p.economy && typeof p.economy === "object")
    for (const [k, v] of Object.entries(p.economy as Record<string, unknown>)) {
      const delta = Number(v);
      if (Number.isFinite(delta))
        next.economy[k] = Math.max(0, finite(next.economy[k], 0) + delta);
    }
  if (p.factionPressure && typeof p.factionPressure === "object")
    for (const [k, v] of Object.entries(
      p.factionPressure as Record<string, unknown>,
    )) {
      const delta = Number(v);
      if (Number.isFinite(delta))
        next.factionPressure[k] = clamp(
          finite(next.factionPressure[k], 0) + delta,
          0,
          100,
        );
    }
  if (p.discovery && typeof p.discovery === "string")
    next.discoveries[p.discovery] =
      finite(next.discoveries[p.discovery], 0) + 1;
  return next;
}

export class WorldSimulation {
  private repo: any;
  private state: WorldSimulationState;
  private ledger: WorldEventRecord[];
  private applied = new Set<string>();
  private queue: WorldEventRecord[] = [];
  private dirty = false;
  private lastLedgerPersistAt = Date.now();
  private lastPersistAt = 0;
  private readonly persistEveryMs = 10000;
  private memory: any = null;
  private factions: any = null;
  private npcMemory: any = null;
  chronicle: any = null;

  constructor(
    repo: any,
    regionIds: string[] = [],
    seed = "ashenfall-v1",
    memory: any = null,
    factions: any = null,
    npcMemory: any = null,
  ) {
    this.repo = repo;
    this.memory = memory;
    this.factions = factions;
    this.npcMemory = npcMemory;
    const raw = repo?.loadWorldState?.(STATE_ID);
    this.state = this.normalizeState(raw, regionIds, seed);
    const ledgerRaw = repo?.loadWorldState?.(LEDGER_ID);
    this.ledger = Array.isArray(ledgerRaw?.events)
      ? ledgerRaw.events.slice(-MAX_LEDGER)
      : [];
    for (const event of this.ledger) this.applied.add(String(event.id));
  }

  private normalizeState(
    raw: any,
    regionIds: string[],
    seed: string,
  ): WorldSimulationState {
    const base = raw && typeof raw === "object" ? raw : {};
    const regions: Record<string, RegionalState> = {};
    const rawRegions =
      base.regions && typeof base.regions === "object" ? base.regions : {};
    for (const id of new Set([...regionIds, ...Object.keys(rawRegions)])) {
      const r = rawRegions[id];
      const baseRegion = createRegionalState();
      const source = r && typeof r === "object" ? r : {};
      const sanitizeMap = (value: any) =>
        Object.fromEntries(
          Object.entries(value && typeof value === "object" ? value : {}).map(
            ([k, v]) => [String(k), Math.max(0, finite(v, 0))],
          ),
        );
      regions[id] = {
        ...baseRegion,
        danger: clamp(finite(source.danger, 0), 0, 100),
        corruption: clamp(finite(source.corruption, 0), 0, 100),
        weather: typeof source.weather === "string" ? source.weather : "clear",
        version: Math.max(1, finite(source.version, 1)),
        updatedTick: Math.max(0, finite(source.updatedTick, 0)),
        population: sanitizeMap(source.population),
        resources: sanitizeMap(source.resources),
        economy: sanitizeMap(source.economy),
        factionPressure: Object.fromEntries(
          Object.entries(
            source.factionPressure && typeof source.factionPressure === "object"
              ? source.factionPressure
              : {},
          ).map(([k, v]) => [String(k), clamp(finite(v, 0), 0, 100)]),
        ),
        discoveries: sanitizeMap(source.discoveries),
      };
    }
    return {
      schemaVersion: Math.max(1, finite(base.schemaVersion, 1)),
      simulationTick: Math.max(0, finite(base.simulationTick, 0)),
      worldTime: Math.max(0, finite(base.worldTime, 0)),
      seed: String(base.seed || hashSeed(seed)),
      regions,
      lastCheckpoint: Math.max(0, finite(base.lastCheckpoint, 0)),
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }
  ledgerSnapshot(limit = 100) {
    return this.ledger
      .slice(-Math.max(1, Math.min(MAX_LEDGER, limit)))
      .map((e) => ({
        ...e,
        payload: { ...e.payload },
        causes: [...e.causes],
        consequenceIds: [...e.consequenceIds],
      }));
  }
  region(regionId: string) {
    return (
      this.state.regions[regionId] ||
      (this.state.regions[regionId] = createRegionalState())
    );
  }
  factionSnapshot(regionId?: string) {
    return regionId
      ? this.factions?.snapshotForRegion?.(regionId) || []
      : this.factions?.snapshot?.() || null;
  }
  metrics() {
    return {
      simulationTick: this.state.simulationTick,
      worldTime: this.state.worldTime,
      regions: Object.keys(this.state.regions).length,
      ledgerSize: this.ledger.length,
      queueDepth: this.queue.length,
      appliedEvents: this.applied.size,
      memory: this.memory?.metrics?.() || null,
      npcMemory: this.npcMemory?.metrics?.() || null,
      factions: this.factions?.metrics?.() || null,
    };
  }

  enqueue(event: Omit<WorldEventRecord, "id"> & { id?: string }): boolean {
    if (this.queue.length >= MAX_QUEUE) return false;
    const id = String(
      event.id || `we_${crypto.randomBytes(8).toString("hex")}`,
    );
    if (this.applied.has(id) || this.queue.some((x) => x.id === id))
      return false;
    const regionId =
      event.regionId == null || event.regionId === ""
        ? null
        : String(event.regionId);
    const simulationTick = Math.max(
      this.state.simulationTick,
      finite(event.simulationTick, this.state.simulationTick),
      regionId ? this.region(regionId).updatedTick : 0,
    );
    const worldTime = Math.max(
      this.state.worldTime,
      finite(event.worldTime, this.state.worldTime),
    );
    this.queue.push({
      ...event,
      id,
      regionId,
      simulationTick,
      worldTime,
      payload: { ...(event.payload || {}) },
      causes: [...(event.causes || [])],
      consequenceIds: [...(event.consequenceIds || [])],
    });
    return true;
  }

  record(event: Omit<WorldEventRecord, "id"> & { id?: string }): boolean {
    const id = String(
      event.id || `we_${crypto.randomBytes(8).toString("hex")}`,
    );
    if (this.applied.has(id)) return false;
    if (this.queue.some((x) => x.id === id)) return false;
    const normalized: WorldEventRecord = {
      ...event,
      id,
      simulationTick: Math.max(
        this.state.simulationTick,
        event.regionId ? this.region(String(event.regionId)).updatedTick : 0,
        finite(event.simulationTick, this.state.simulationTick),
      ),
      worldTime: Math.max(
        this.state.worldTime,
        finite(event.worldTime, this.state.worldTime),
      ),
      payload: { ...(event.payload || {}) },
      causes: [...(event.causes || [])],
      consequenceIds: [...(event.consequenceIds || [])],
    };
    this.apply(normalized);
    return true;
  }

  private apply(event: WorldEventRecord) {
    if (this.applied.has(event.id)) return false;
    if (event.regionId)
      this.state.regions[event.regionId] = reduceRegionalState(
        this.region(event.regionId),
        event,
      );
    this.factions?.ingestEvent?.(event);
    this.ledger.push(event);
    if (this.ledger.length > MAX_LEDGER)
      this.ledger.splice(0, this.ledger.length - MAX_LEDGER);
    this.applied.add(event.id);
    this.memory?.ingest?.(event);
    this.npcMemory?.ingest?.(event);
    this.chronicle?.ingest?.(event);
    this.dirty = true;
    return true;
  }

  tick(simulationTick: number, worldTime: number) {
    const tick = Math.max(
      this.state.simulationTick,
      finite(simulationTick, this.state.simulationTick),
    );
    this.state.simulationTick = tick;
    this.state.worldTime = Math.max(
      this.state.worldTime,
      finite(worldTime, this.state.worldTime),
    );
    let processed = 0;
    while (this.queue.length && processed < MAX_EVENTS_PER_TICK) {
      const event = this.queue.shift()!;
      this.apply({
        ...event,
        simulationTick: Math.max(tick, finite(event.simulationTick, tick)),
        worldTime: Math.max(
          this.state.worldTime,
          finite(event.worldTime, this.state.worldTime),
        ),
      });
      processed++;
    }
    if (processed || this.state.simulationTick !== tick) this.dirty = true;
    this.persist(false);
    return processed;
  }

  checkpoint(now = Date.now()) {
    // Final flush (shutdown): write everything.
    this.state.lastCheckpoint = now;
    this.persist(true, now, true);
  }

  // Periodic checkpoint: write only when something changed (rate-limited), plus a slow safety write of the small state document.
  checkpointIfDirty(now = Date.now()) {
    if (!this.lastPersistAt && !this.dirty) {
      this.lastPersistAt = now;
      return;
    }
    if (
      this.dirty
        ? now - this.lastPersistAt < this.persistEveryMs
        : now - this.lastPersistAt < 300_000
    )
      return;
    this.state.lastCheckpoint = now;
    this.persist(true, now, false);
  }

  private persist(force: boolean, now = Date.now(), final = false) {
    if (!this.dirty && !force) return;
    if (!force && now - this.lastPersistAt < this.persistEveryMs) return;
    const changed = this.dirty;
    this.repo?.saveWorldState?.(this.state, STATE_ID);
    // The ledger (up to 10k events) is the big document: rewrite it only when it changed, at most every 15 minutes (always on final flush).
    if (final || (changed && now - this.lastLedgerPersistAt >= 900_000)) {
      this.repo?.saveWorldState?.(
        { version: 1, events: this.ledger },
        LEDGER_ID,
      );
      this.lastLedgerPersistAt = now;
    }
    this.memory?.persist?.(final, now);
    this.npcMemory?.persist?.(final, now);
    this.chronicle?.persist?.(final, now);
    this.lastPersistAt = now;
    this.dirty = false;
  }

  explain(regionId: string) {
    const region = this.region(regionId);
    const recent = this.ledger
      .filter((e) => e.regionId === regionId)
      .slice(-10);
    return {
      regionId,
      state: structuredClone(region),
      recentTransitions: recent,
      why: recent.map((e) => ({
        eventId: e.id,
        type: e.type,
        causes: e.causes,
        severity: e.severity,
      })),
    };
  }
}

export const WORLD_SIMULATION_IDS = { STATE_ID, LEDGER_ID };
