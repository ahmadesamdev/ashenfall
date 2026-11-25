import crypto from "node:crypto";

export type FactionGoal = "defend" | "trade" | "expand" | "contain" | "recover";
export type FactionOperationKind =
  | "patrol"
  | "trade_restriction"
  | "contract"
  | "raid"
  | "reinforcement"
  | "diplomacy"
  | "territorial_pressure";
export type FactionRelation =
  "allied" | "friendly" | "neutral" | "strained" | "hostile";

export type FactionDefinition = {
  id: string;
  name: string;
  goals: FactionGoal[];
  startingResources: number;
  preferredRegions: string[];
  relationships: Record<string, FactionRelation>;
};

export type FactionOperation = {
  id: string;
  factionId: string;
  regionId: string;
  kind: FactionOperationKind;
  goal: FactionGoal;
  createdTick: number;
  expiresTick: number;
  strength: number;
  causeEventIds: string[];
  status: "active" | "resolved";
};

export type FactionState = {
  resources: number;
  influenceByRegion: Record<string, number>;
  pressureByRegion: Record<string, number>;
  goals: FactionGoal[];
  activeOperations: FactionOperation[];
  lastActionTick: number;
  version: number;
};

export type FactionSimulationState = {
  schemaVersion: number;
  factions: Record<string, FactionState>;
  tick: number;
};

const STATE_ID = "world-factions-v1";
const MAX_OPERATIONS_PER_FACTION = 4;
const MAX_TOTAL_OPERATIONS = 40;
const OPERATION_COOLDOWN_TICKS = 25;
const OPERATION_DURATION_TICKS = 90;
const ACTION_COST = 8;
const MIN_RESOURCES = 10;
const MAX_RESOURCES = 1000;
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

export const DEFAULT_FACTIONS: FactionDefinition[] = [
  {
    id: "lantern_guard",
    name: "Lantern Guard",
    goals: ["defend", "contain", "recover"],
    startingResources: 500,
    preferredRegions: ["gloamwood", "briarfen"],
    relationships: {
      stonehold_council: "friendly",
      veil_wardens: "neutral",
      ashen_covenant: "strained",
      the_hollow: "hostile",
    },
  },
  {
    id: "stonehold_council",
    name: "Stonehold Council",
    goals: ["trade", "defend", "expand"],
    startingResources: 700,
    preferredRegions: [
      "stonehold",
      "eastern_reach",
      "marches_of_dawn",
      "sunscar_steppe",
    ],
    relationships: {
      lantern_guard: "friendly",
      veil_wardens: "neutral",
      ashen_covenant: "strained",
      the_hollow: "hostile",
    },
  },
  {
    id: "ashen_covenant",
    name: "Ashen Covenant",
    goals: ["contain", "recover", "defend"],
    startingResources: 550,
    preferredRegions: ["ashen_wastes"],
    relationships: {
      lantern_guard: "strained",
      stonehold_council: "strained",
      veil_wardens: "friendly",
      the_hollow: "hostile",
    },
  },
  {
    id: "veil_wardens",
    name: "Veil Wardens",
    goals: ["contain", "defend", "recover"],
    startingResources: 600,
    preferredRegions: [
      "old_kingdom",
      "crownfall_expanse",
      "veilscar_highlands",
      "hollow_expanse",
    ],
    relationships: {
      lantern_guard: "neutral",
      stonehold_council: "neutral",
      ashen_covenant: "friendly",
      the_hollow: "hostile",
    },
  },
  {
    id: "the_hollow",
    name: "The Hollow",
    goals: ["expand", "contain"],
    startingResources: 450,
    preferredRegions: ["nightveil_coast", "black_citadel"],
    relationships: {
      lantern_guard: "hostile",
      stonehold_council: "hostile",
      ashen_covenant: "hostile",
      veil_wardens: "hostile",
    },
  },
];

const stableHash = (seed: string) =>
  crypto.createHash("sha256").update(seed).digest("hex");
const score = (seed: string) =>
  parseInt(stableHash(seed).slice(0, 8), 16) / 0xffffffff;

export function createFactionState(def: FactionDefinition): FactionState {
  return {
    resources: def.startingResources,
    influenceByRegion: {},
    pressureByRegion: {},
    goals: [...def.goals],
    activeOperations: [],
    lastActionTick: -OPERATION_COOLDOWN_TICKS,
    version: 1,
  };
}

export function relationMultiplier(relation: FactionRelation): number {
  return relation === "allied"
    ? 1.25
    : relation === "friendly"
      ? 1.1
      : relation === "strained"
        ? 0.9
        : relation === "hostile"
          ? 0.75
          : 1;
}

export class FactionSimulation {
  repo: any;
  definitions: Map<string, FactionDefinition>;
  state: FactionSimulationState;
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 1000;
  constructor(repo: any, definitions: FactionDefinition[] = DEFAULT_FACTIONS) {
    this.repo = repo;
    this.definitions = new Map(definitions.map((x) => [x.id, x]));
    const raw = repo?.loadWorldState?.(STATE_ID);
    this.state = this.restore(raw);
  }
  private restore(raw: any): FactionSimulationState {
    const factions: any = {};
    for (const def of this.definitions.values()) {
      const r = raw?.factions?.[def.id];
      factions[def.id] = {
        ...createFactionState(def),
        ...(r || {}),
        influenceByRegion: { ...(r?.influenceByRegion || {}) },
        pressureByRegion: { ...(r?.pressureByRegion || {}) },
        goals: Array.isArray(r?.goals)
          ? r.goals.filter((x: any) => def.goals.includes(x))
          : [...def.goals],
        activeOperations: Array.isArray(r?.activeOperations)
          ? r.activeOperations.slice(-MAX_OPERATIONS_PER_FACTION)
          : [],
      };
    }
    return {
      schemaVersion: Math.max(1, Number(raw?.schemaVersion || 1)),
      factions,
      tick: Number(raw?.tick || 0),
    };
  }
  snapshot() {
    return structuredClone(this.state);
  }
  metrics() {
    const ops = Object.values(this.state.factions).reduce(
      (n: any, f: any) => n + f.activeOperations.length,
      0,
    );
    return {
      factions: Object.keys(this.state.factions).length,
      activeOperations: ops,
      tick: this.state.tick,
    };
  }
  faction(id: string) {
    return (
      this.state.factions[id] ||
      (this.state.factions[id] = createFactionState(
        this.definitions.get(id) ||
          ({
            id,
            name: id,
            goals: ["defend"],
            startingResources: 100,
            preferredRegions: [],
            relationships: {},
          } as any),
      ))
    );
  }
  definitionsSnapshot() {
    return [...this.definitions.values()].map((x) => structuredClone(x));
  }
  snapshotForRegion(regionId: string) {
    const rid = String(regionId);
    return [...this.definitions.values()]
      .map((def) => {
        const f = this.faction(def.id);
        return {
          id: def.id,
          name: def.name,
          influence: Number(f.influenceByRegion[rid] || 0),
          pressure: Number(f.pressureByRegion[rid] || 0),
          resources: f.resources,
          relationToOthers: def.relationships,
          activeOperations: f.activeOperations
            .filter((o) => o.regionId === rid)
            .map((o) => ({ ...o })),
        };
      })
      .sort((a, b) => b.influence - a.influence);
  }
  ingestEvent(event: any) {
    if (!event?.id) return false;
    const regionId = String(event.regionId || "");
    if (!regionId) return false;
    const actorFaction = String(event.payload?.factionId || "");
    const directDelta = Number(event.payload?.factionPressureDelta || 0);
    const delta = Number.isFinite(directDelta) ? directDelta : 0;
    let changed = false;
    for (const def of this.definitions.values()) {
      const f = this.faction(def.id);
      const preferred = def.preferredRegions.includes(regionId);
      let influenceDelta = 0,
        pressureDelta = 0;
      if (actorFaction === def.id) {
        influenceDelta = 5;
        pressureDelta = -3;
      } else if (preferred && event.severity === "regional") {
        pressureDelta += 2;
      }
      if (delta && actorFaction === def.id) pressureDelta += delta;
      if (!influenceDelta && !pressureDelta) continue;
      f.influenceByRegion[regionId] = clamp(
        Number(f.influenceByRegion[regionId] || 0) + influenceDelta,
        0,
        100,
      );
      f.pressureByRegion[regionId] = clamp(
        Number(f.pressureByRegion[regionId] || 0) + pressureDelta,
        0,
        100,
      );
      changed = true;
    }
    if (changed) this.dirty = true;
    return changed;
  }
  private chooseRegion(def: FactionDefinition, regional: any, seed: string) {
    const candidates = Object.keys(regional || {}).filter((r) =>
      def.preferredRegions.includes(r),
    );
    if (!candidates.length)
      return Object.keys(regional || {}).sort()[0] || null;
    return candidates.slice().sort((a, b) => {
      const fa = this.faction(def.id),
        pa = Number(fa.pressureByRegion[a] || 0),
        pb = Number(fa.pressureByRegion[b] || 0);
      const sa = pa + score(`${seed}:${a}`) * 5,
        sb = pb + score(`${seed}:${b}`) * 5;
      return sb - sa;
    })[0];
  }
  private operationKind(
    def: FactionDefinition,
    pressure: number,
    danger: number,
  ): FactionOperationKind {
    if (danger >= 70 && def.goals.includes("defend")) return "reinforcement";
    if (pressure >= 70 && def.goals.includes("contain")) return "patrol";
    if (def.goals.includes("trade") && pressure >= 45)
      return "trade_restriction";
    if (def.goals.includes("expand") && pressure >= 55)
      return "territorial_pressure";
    if (def.goals.includes("recover")) return "contract";
    return "patrol";
  }
  tick(worldSnapshot: any, simulationTick: number): FactionOperation[] {
    const tick = Math.max(this.state.tick, Number(simulationTick) || 0);
    this.state.tick = tick;
    const regions = worldSnapshot?.regions || {};
    const created: FactionOperation[] = [];
    const allOps = () =>
      Object.values(this.state.factions).reduce(
        (n: any, f: any) => n + f.activeOperations.length,
        0,
      );
    for (const def of this.definitions.values()) {
      const f = this.faction(def.id);
      f.activeOperations = f.activeOperations.filter(
        (o: any) => o.status === "active" && o.expiresTick > tick,
      );
      if (
        f.resources < MIN_RESOURCES ||
        f.activeOperations.length >= MAX_OPERATIONS_PER_FACTION ||
        allOps() >= MAX_TOTAL_OPERATIONS
      )
        continue;
      if (tick - f.lastActionTick < OPERATION_COOLDOWN_TICKS) continue;
      const regionId = this.chooseRegion(def, regions, `${tick}:${def.id}`);
      if (!regionId) continue;
      const r = regions[regionId] || {};
      const pressure = Number(f.pressureByRegion[regionId] || 0);
      const danger = Number(r.danger || 0);
      const influence = Number(f.influenceByRegion[regionId] || 0);
      if (pressure < 35 && danger < 55 && influence < 35) continue;
      const kind = this.operationKind(def, pressure, danger);
      const strength = clamp(
        Math.round(10 + pressure * 0.25 + danger * 0.15 + influence * 0.1),
        10,
        50,
      );
      const op: FactionOperation = {
        id: `fo_${stableHash(`${def.id}:${regionId}:${tick}:${kind}`).slice(0, 16)}`,
        factionId: def.id,
        regionId,
        kind,
        goal: def.goals[0] || "defend",
        createdTick: tick,
        expiresTick: tick + OPERATION_DURATION_TICKS,
        strength,
        causeEventIds: [],
        status: "active",
      };
      f.resources = clamp(f.resources - ACTION_COST, 0, MAX_RESOURCES);
      f.lastActionTick = tick;
      f.activeOperations.push(op);
      f.version++;
      created.push(op);
      this.dirty = true;
    }
    this.persist(false);
    return created;
  }
  resolveOperation(id: string) {
    for (const f of Object.values(this.state.factions) as any[]) {
      const o = f.activeOperations.find((x) => x.id === id);
      if (o) {
        if (o.status === "resolved") return true;
        o.status = "resolved";
        f.resources = clamp(
          f.resources + Math.round(o.strength * 0.2),
          0,
          MAX_RESOURCES,
        );
        this.dirty = true;
        return true;
      }
    }
    return false;
  }
  persist(force = false, now = Date.now()) {
    if (!this.dirty && !force) return;
    if (!force && now - this.lastPersistAt < this.persistEveryMs) return;
    this.repo?.saveWorldState?.(this.snapshot(), STATE_ID);
    this.lastPersistAt = now;
    this.dirty = false;
  }
}
export const WORLD_FACTIONS_ID = STATE_ID;
