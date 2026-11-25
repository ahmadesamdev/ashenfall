import crypto from "node:crypto";

export type EcologyRole =
  "prey" | "predator" | "scavenger" | "apex" | "non_ecological";
export type EcologySpeciesState = {
  population: number;
  carryingCapacity: number;
  health: number;
  pressure: number;
  lastChangeTick: number;
  lastObservedDeaths: number;
};
export type EcologyRegionState = {
  forage: number;
  water: number;
  carcass: number;
  disturbance: number;
  recovery: number;
  species: Record<string, EcologySpeciesState>;
  version: number;
  updatedTick: number;
};
export type EcologyState = {
  schemaVersion: number;
  tick: number;
  regions: Record<string, EcologyRegionState>;
  adjacency: Record<string, string[]>;
};

const STATE_ID = "world-ecology-v1";
const TICK_INTERVAL = 20;
const MAX_POPULATION = 10000;
const MIN_POPULATION = 0;
const MAX_DISTURBANCE = 100;
const MAX_EVENT_PER_TICK = 12;
const ACTIVE_FIDELITY = 1;
const INACTIVE_FIDELITY = 0.35;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const unit = (s: string) => parseInt(hash(s).slice(0, 8), 16) / 0xffffffff;

const ROLE_OVERRIDES: Record<string, EcologyRole> = {
  hollow_wolf: "predator",
  ashen_hyena: "predator",
  dreadstalker: "predator",
  veilbound_howler: "predator",
  dreadfang_alpha: "apex",
  reach_thornstag: "prey",
  redmaw_hyena: "predator",
  ashwing_vulture: "scavenger",
  feral_ravager: "predator",
  crowsworn_scavenger: "scavenger",
  gloomroot_spider: "predator",
  fen_stalker: "predator",
  marshbone_hound: "predator",
  nightveil_drowned: "non_ecological",
  nightveil_reaver: "non_ecological",
  hollowtide_witch: "non_ecological",
  nightveil_behemoth: "apex",
  grave_brute: "non_ecological",
  ashen_reaver: "non_ecological",
  catacomb_stalker: "predator",
  gloam_cultist: "non_ecological",
  gloam_huntmaster: "non_ecological",
  risen_guardian: "non_ecological",
  ashbound_executioner: "non_ecological",
  veilscarred_arcanist: "non_ecological",
  reach_roadbandit: "non_ecological",
  reach_mirewing: "predator",
  eastwatch_colossus: "apex",
  kingdom_hollow_knight: "non_ecological",
  kingdom_crownwraith: "non_ecological",
  kingdom_basilisk: "predator",
  kingdom_revenant: "non_ecological",
  citadel_breachwarden: "non_ecological",
  hollow_herald: "apex",
  thorn_hag: "non_ecological",
  fen_revenant: "non_ecological",
  sunscar_raider: "non_ecological",
  steppe_colossus: "apex",
  crownfall_revenant: "non_ecological",
  royal_boneguard: "non_ecological",
  ashbound_reclaimer: "non_ecological",
  crownless_witch: "non_ecological",
  veilscar_raider: "non_ecological",
  aether_wraith: "non_ecological",
  highland_gargoyle: "non_ecological",
  stormbound_arcanist: "non_ecological",
};

const roleFor = (def: any): EcologyRole =>
  ROLE_OVERRIDES[String(def?.type || "")] ||
  (def?.temper === "neutral" ? "prey" : "predator");

export class WorldEcology {
  repo: any;
  defs: any[];
  state: EcologyState;
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 10000;
  private deathCursor = new Set<string>();
  private definitions = new Map<string, any>();
  private roleBySpecies = new Map<string, EcologyRole>();
  private zonesBySpecies = new Map<string, string[]>();
  private regionAdjacency: Record<string, string[]> = {};

  constructor(repo: any, worldMobDefs: any[] = [], regionIds: string[] = []) {
    this.repo = repo;
    this.defs = Array.isArray(worldMobDefs) ? worldMobDefs : [];
    for (const d of this.defs) {
      const id = String(d?.type || "");
      if (!id) continue;
      this.definitions.set(id, d);
      this.roleBySpecies.set(id, roleFor(d));
      this.zonesBySpecies.set(id, (d?.zones || []).map(String));
    }
    this.regionAdjacency = this.buildAdjacency(regionIds.map(String));
    const raw = repo?.loadWorldState?.(STATE_ID);
    this.state = this.restore(raw, regionIds.map(String));
  }
  private buildAdjacency(regionIds: string[]) {
    const out: Record<string, Set<string>> = {};
    for (const r of regionIds) out[r] = new Set<string>();
    const zoneSets = [...this.zonesBySpecies.values()];
    for (const zones of zoneSets) {
      const rs = zones.filter((z) => out[z]);
      for (const a of rs) for (const b of rs) if (a !== b) out[a].add(b);
    }
    return Object.fromEntries(
      Object.entries(out).map(([k, v]) => [k, [...v].sort().slice(0, 4)]),
    );
  }
  private baseSpeciesState(
    regionId: string,
    speciesId: string,
  ): EcologySpeciesState {
    const def = this.definitions.get(speciesId);
    const areas = def?.spawnareas?.[regionId] || [];
    const configured = Math.max(
      0,
      areas.reduce((n: any, a: any) => n + Number(a?.count || 0), 0),
    );
    const capacity = clamp(
      Math.round(Math.max(5, configured * 2.5)),
      5,
      MAX_POPULATION,
    );
    return {
      population: clamp(configured, MIN_POPULATION, capacity),
      carryingCapacity: capacity,
      health: 75,
      pressure: 0,
      lastChangeTick: 0,
      lastObservedDeaths: 0,
    };
  }
  private createRegion(regionId: string): EcologyRegionState {
    const species: any = {};
    for (const [id, def] of this.definitions) {
      if (this.roleBySpecies.get(id) === "non_ecological") continue;
      if ((this.zonesBySpecies.get(id) || []).includes(regionId))
        species[id] = this.baseSpeciesState(regionId, id);
    }
    return {
      forage: 70,
      water: 70,
      carcass: 15,
      disturbance: 0,
      recovery: 70,
      species,
      version: 1,
      updatedTick: 0,
    };
  }
  private restore(raw: any, regionIds: string[]): EcologyState {
    const regions: any = {};
    const rawRegions =
      raw?.regions && typeof raw.regions === "object" ? raw.regions : {};
    for (const id of new Set([...regionIds, ...Object.keys(rawRegions)])) {
      const base = this.createRegion(id),
        r = rawRegions[id] || {};
      regions[id] = {
        ...base,
        ...r,
        species: { ...base.species, ...(r.species || {}) },
      };
      for (const [sid, s] of Object.entries(regions[id].species))
        regions[id].species[sid] = {
          ...this.baseSpeciesState(id, sid),
          ...(s as any),
        };
    }
    return {
      schemaVersion: Math.max(1, Number(raw?.schemaVersion || 1)),
      tick: Number(raw?.tick || 0),
      regions,
      adjacency: { ...this.regionAdjacency, ...(raw?.adjacency || {}) },
    };
  }
  snapshot() {
    return structuredClone(this.state);
  }
  metrics() {
    let species = 0;
    let population = 0;
    for (const r of Object.values(this.state.regions) as any[]) {
      species += Object.keys(r.species).length;
      for (const s of Object.values(r.species) as any[])
        population += Number(s.population || 0);
    }
    return {
      tick: this.state.tick,
      regions: Object.keys(this.state.regions).length,
      species,
      population,
    };
  }
  region(regionId: string) {
    return (
      this.state.regions[regionId] ||
      (this.state.regions[regionId] = this.createRegion(regionId))
    );
  }
  regionSummary(regionId: string) {
    const r = this.region(String(regionId));
    return {
      regionId: String(regionId),
      forage: r.forage,
      water: r.water,
      carcass: r.carcass,
      disturbance: r.disturbance,
      recovery: r.recovery,
      species: Object.entries(r.species)
        .map(([id, s]: any) => ({
          id,
          role: this.roleBySpecies.get(id) || "prey",
          population: s.population,
          capacity: s.carryingCapacity,
          health: s.health,
          pressure: s.pressure,
        }))
        .sort((a, b) => b.population - a.population),
    };
  }
  private recordDeath(world: any, simulationTick: number) {
    const deaths: any[] = [];
    for (const m of world?.mobs?.values?.() || []) {
      if (!m || m.state !== "dead" || m.dungeonId) continue;
      const key = `${m.id}:${Number(m.deathAt || m.deadUntil || 0)}`;
      if (this.deathCursor.has(key)) continue;
      this.deathCursor.add(key);
      const role = this.roleBySpecies.get(String(m.type));
      if (!role || role === "non_ecological") continue;
      const region = String(m.zone || "");
      if (!this.state.regions[region]) continue;
      deaths.push({
        region,
        species: String(m.type),
        role,
        player: !!m.attackers,
      });
      if (deaths.length >= MAX_EVENT_PER_TICK) break;
    }
    if (this.deathCursor.size > 10000) {
      const keep = [...this.deathCursor].slice(-5000);
      this.deathCursor = new Set(keep);
    }
    return deaths;
  }
  ingestWorld(
    world: any,
    simulationTick: number,
    activeZones: Set<string> = new Set(),
  ): any[] {
    const tick = Math.max(this.state.tick, Number(simulationTick) || 0);
    this.state.tick = tick;
    if (tick % TICK_INTERVAL !== 0) return [];
    const deaths = this.recordDeath(world, tick);
    const changes: any[] = [];
    for (const d of deaths) {
      const r = this.region(d.region),
        s = r.species[d.species];
      if (!s) continue;
      const loss = Math.max(1, Math.round(Math.max(1, s.population * 0.12)));
      s.population = clamp(s.population - loss, 0, s.carryingCapacity);
      s.pressure = clamp(s.pressure + 2, 0, 100);
      r.disturbance = clamp(
        r.disturbance + (d.role === "apex" ? 4 : 2),
        0,
        100,
      );
      r.carcass = clamp(r.carcass + Math.max(1, loss * 0.5), 0, 100);
      s.lastObservedDeaths++;
      s.lastChangeTick = tick;
      changes.push({
        regionId: d.region,
        speciesId: d.species,
        kind: "mortality",
        delta: -loss,
      });
      this.dirty = true;
    }
    for (const [regionId, r] of Object.entries(this.state.regions) as any) {
      const active = activeZones.has(regionId);
      const fidelity = active ? ACTIVE_FIDELITY : INACTIVE_FIDELITY;
      r.disturbance = clamp(r.disturbance * (1 - 0.0025 * fidelity), 0, 100);
      r.carcass = clamp(r.carcass * (1 - 0.008 * fidelity), 0, 100);
      r.forage = clamp(
        r.forage +
          0.025 * fidelity * (r.recovery / 100) -
          r.disturbance * 0.0015,
        0,
        100,
      );
      r.water = clamp(
        r.water + 0.01 * fidelity - r.disturbance * 0.0005,
        0,
        100,
      );
      r.recovery = clamp(
        r.recovery + 0.05 * fidelity - r.disturbance * 0.02,
        0,
        100,
      );
      for (const [sid, s] of Object.entries(r.species) as any) {
        const role = this.roleBySpecies.get(sid) || "prey";
        const resourceFactor = clamp(
          (r.forage * 0.65 + r.water * 0.35) / 100,
          0,
          1.2,
        );
        const density = s.population / Math.max(1, s.carryingCapacity);
        let growth = 0.012 * resourceFactor * (1 - density);
        if (role === "predator" || role === "apex") growth *= 0.72;
        if (role === "scavenger")
          growth *= clamp((r.carcass + 25) / 100, 0.4, 1.4);
        const pressurePenalty = s.pressure * 0.0015;
        const recoveryBonus = r.recovery * 0.0004;
        s.population = clamp(
          Math.round(
            s.population *
              (1 + (growth + recoveryBonus - pressurePenalty) * fidelity),
          ),
          0,
          s.carryingCapacity,
        );
        s.health = clamp(
          s.health +
            (resourceFactor - 0.65) * 1.5 * fidelity -
            s.pressure * 0.01,
          5,
          100,
        );
        s.pressure = clamp(s.pressure * (1 - 0.01 * fidelity), 0, 100);
        if (role === "prey" && s.population > 0)
          r.carcass = clamp(
            r.carcass + s.population * 0.00001 * fidelity,
            0,
            100,
          );
      }
      const prey = Object.entries(r.species)
        .filter(([id]) => this.roleBySpecies.get(id) === "prey")
        .reduce((n: any, [, s]: any) => n + Number(s.population || 0), 0);
      const predators = Object.entries(r.species)
        .filter(([id]) =>
          ["predator", "apex"].includes(this.roleBySpecies.get(id)),
        )
        .reduce((n: any, [, s]: any) => n + Number(s.population || 0), 0);
      if (prey && predators) {
        const ratio = predators / Math.max(1, prey);
        if (ratio > 0.35) {
          for (const [id, s] of Object.entries(r.species) as any) {
            if (this.roleBySpecies.get(id) === "prey")
              s.pressure = clamp(
                s.pressure + (ratio - 0.35) * 0.4 * fidelity,
                0,
                100,
              );
          }
        }
      }
      for (const [sid, s] of Object.entries(r.species) as any) {
        if (s.population < 5) continue;
        const neighbors = this.state.adjacency[regionId] || [];
        if (!neighbors.length) continue;
        const stress = clamp(
          (s.pressure + (100 - s.health) * 0.4 + (50 - r.forage) * 0.35) / 100,
          0,
          1,
        );
        if (stress < 0.45) continue;
        const candidates = neighbors.filter((n) => this.region(n).species[sid]);
        if (!candidates.length) continue;
        const idx = Math.floor(
          unit(`${this.state.tick}:${regionId}:${sid}`) * candidates.length,
        );
        const targetId = candidates[idx];
        const target = this.region(targetId);
        const targetSpecies = target.species[sid];
        if (!targetSpecies) continue;
        const move = Math.min(
          Math.max(1, Math.round(s.population * 0.005 * fidelity)),
          Math.max(
            0,
            targetSpecies.carryingCapacity - targetSpecies.population,
          ),
        );
        if (move > 0) {
          s.population -= move;
          targetSpecies.population += move;
          s.lastChangeTick = tick;
          targetSpecies.lastChangeTick = tick;
          changes.push({
            regionId,
            speciesId: sid,
            kind: "migration",
            delta: -move,
            to: targetId,
          });
          this.dirty = true;
        }
      }
      r.version++;
      r.updatedTick = tick;
    }
    this.persist(false);
    const meaningful = changes
      .filter(
        (x) => x.kind === "migration" || Math.abs(Number(x.delta || 0)) >= 2,
      )
      .slice(0, MAX_EVENT_PER_TICK);
    return meaningful;
  }
  applyWorldContractOutcome(
    regionId: string,
    outcome: string,
    simulationTick: number,
  ) {
    const r = this.region(String(regionId));
    const success = String(outcome) === "success";
    r.disturbance = clamp(r.disturbance + (success ? -5 : 8), 0, 100);
    r.recovery = clamp(r.recovery + (success ? 3 : -6), 0, 100);
    r.forage = clamp(r.forage + (success ? 2 : -4), 0, 100);
    for (const s of Object.values(r.species) as any[]) {
      s.pressure = clamp(
        Number(s.pressure || 0) + (success ? -2.5 : 5),
        0,
        100,
      );
      s.health = clamp(Number(s.health || 75) + (success ? 1.5 : -2), 5, 100);
      s.lastChangeTick = Math.max(
        Number(s.lastChangeTick || 0),
        Number(simulationTick) || 0,
      );
    }
    r.updatedTick = Math.max(r.updatedTick, Number(simulationTick) || 0);
    r.version++;
    this.dirty = true;
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

export const WORLD_ECOLOGY_ID = STATE_ID;
