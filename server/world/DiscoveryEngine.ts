import crypto from "node:crypto";

export type DiscoveryKind =
  "ecological" | "factional" | "aftermath" | "historical" | "recovery";
export type DynamicDiscovery = {
  id: string;
  regionId: string;
  kind: DiscoveryKind;
  name: string;
  description: string;
  icon: string;
  x: number;
  y: number;
  createdTick: number;
  expiresTick: number;
  sourceEventIds: string[];
  severity: "local" | "regional" | "historical";
  rarity: "uncommon" | "rare" | "legendary";
  discoveredBy: string[];
};

const STATE_ID = "world-discovery-v1";
const MAX_DISCOVERIES = 240;
const MAX_DISCOVERED_BY = 250;
const GENERATION_COOLDOWN = 80;
const DISCOVERY_RADIUS_METERS = 14;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const unit = (s) => parseInt(hash(s).slice(0, 8), 16) / 0xffffffff;

const KIND_PRIORITY: Record<string, number> = {
  historical: 4,
  factional: 3,
  ecological: 2,
  aftermath: 2,
  recovery: 1,
};

export class DiscoveryEngine {
  repo: any;
  world: any;
  simulation: any;
  ecology: any;
  factions: any;
  regions: any[];
  discoveries = new Map<string, DynamicDiscovery>();
  lastGenerated = new Map<string, number>();
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 1000;
  constructor(
    repo: any,
    world: any,
    simulation: any,
    ecology: any,
    factions: any,
    regions: any[] = [],
  ) {
    this.repo = repo;
    this.world = world;
    this.simulation = simulation;
    this.ecology = ecology;
    this.factions = factions;
    this.regions = regions || [];
    this.restore(repo?.loadWorldState?.(STATE_ID));
  }
  private restore(raw: any) {
    for (const d of Array.isArray(raw?.discoveries)
      ? raw.discoveries.slice(-MAX_DISCOVERIES)
      : []) {
      if (!d?.id || !d?.regionId || !d?.kind) continue;
      this.discoveries.set(String(d.id), {
        ...d,
        sourceEventIds: Array.isArray(d.sourceEventIds)
          ? d.sourceEventIds.slice(-8).map(String)
          : [],
        discoveredBy: Array.isArray(d.discoveredBy)
          ? d.discoveredBy.slice(-MAX_DISCOVERED_BY).map(String)
          : [],
      });
    }
    for (const [k, v] of Object.entries(raw?.lastGenerated || {}))
      this.lastGenerated.set(String(k), Number(v) || 0);
  }
  private regionIds() {
    return this.regions.map((r) => String(r.id)).filter(Boolean);
  }
  private anchor(regionId, kind, tick) {
    const candidates = (this.world?.layoutFor?.(regionId)?.roads || [])
      .flatMap((r: any[]) => r || [])
      .filter((p: any) => Array.isArray(p) && p.length >= 2);
    const h = unit(
      `${regionId}:${kind}:${Math.floor(tick / GENERATION_COOLDOWN)}`,
    );
    if (candidates.length) {
      const p = candidates[Math.floor(h * candidates.length)];
      return {
        x: clamp(
          Number(p[0]) + (unit(`${regionId}:${kind}:x`) - 0.5) * 0.06,
          0.06,
          0.94,
        ),
        y: clamp(
          Number(p[1]) + (unit(`${regionId}:${kind}:y`) - 0.5) * 0.06,
          0.06,
          0.94,
        ),
      };
    }
    return {
      x: 0.15 + 0.7 * unit(`${regionId}:${kind}:x`),
      y: 0.15 + 0.7 * unit(`${regionId}:${kind}:y`),
    };
  }
  private active(regionId, kind, tick) {
    return [...this.discoveries.values()].some(
      (d) => d.regionId === regionId && d.kind === kind && d.expiresTick > tick,
    );
  }
  private create(regionId, kind, tick, worldTime, sourceEventIds, condition) {
    if (this.active(regionId, kind, tick)) return null;
    const anchor = this.anchor(regionId, kind, tick);
    const id = `disc_${hash(`${regionId}:${kind}:${Math.floor(tick / GENERATION_COOLDOWN)}`).slice(0, 18)}`;
    const definitions: any = {
      ecological: {
        name: "Wilds in Motion",
        icon: "🐾",
        description:
          "The land bears signs of an ecological shift. Tracks, feeding grounds and altered populations point to something larger moving through the region.",
        severity: "regional",
        rarity: "rare",
      },
      factional: {
        name: "Signs of a Factional Push",
        icon: "⚑",
        description:
          "Fresh marks, abandoned supplies and patrol traces reveal that a faction has changed its presence in this region.",
        severity: "regional",
        rarity: "rare",
      },
      aftermath: {
        name: "Echoes of the Crisis",
        icon: "⚠️",
        description:
          "The recent upheaval left evidence behind. Investigating the site reveals what changed and who was affected.",
        severity: "regional",
        rarity: "uncommon",
      },
      historical: {
        name: "A Buried Chapter",
        icon: "📜",
        description:
          "A trace of an older event has surfaced in the changed landscape. The evidence connects the present to a remembered history.",
        severity: "historical",
        rarity: "legendary",
      },
      recovery: {
        name: "A Path Returns",
        icon: "🌱",
        description:
          "The region is recovering. A route, resource pocket or forgotten place has become accessible again.",
        severity: "local",
        rarity: "uncommon",
      },
    };
    const def = definitions[kind];
    if (!def) return null;
    const d: DynamicDiscovery = {
      id,
      regionId,
      kind,
      name: def.name,
      description: def.description,
      icon: def.icon,
      x: anchor.x,
      y: anchor.y,
      createdTick: tick,
      expiresTick:
        tick +
        (kind === "historical" ? 3600 : kind === "recovery" ? 1200 : 900),
      sourceEventIds: [...(sourceEventIds || [])].slice(-8),
      severity: def.severity,
      rarity: def.rarity,
      discoveredBy: [],
    };
    this.discoveries.set(id, d);
    this.lastGenerated.set(`${regionId}:${kind}`, tick);
    this.dirty = true;
    this.trim();
    return d;
  }
  private trim() {
    if (this.discoveries.size <= MAX_DISCOVERIES) return;
    const rows = [...this.discoveries.values()].sort(
      (a, b) => a.expiresTick - b.expiresTick || a.createdTick - b.createdTick,
    );
    for (const d of rows.slice(0, this.discoveries.size - MAX_DISCOVERIES))
      this.discoveries.delete(d.id);
  }
  private evaluate(regionId, tick) {
    const r = this.simulation?.region?.(regionId) || {};
    const e = this.ecology?.regionSummary?.(regionId) || {};
    const fs = this.factions?.snapshotForRegion?.(regionId) || [];
    const recent = (this.simulation?.ledgerSnapshot?.(100) || []).filter(
      (x: any) => x.regionId === regionId,
    );
    const historical = recent
      .filter((x: any) => x.severity === "historical")
      .slice(-2);
    const top = fs
      .slice()
      .sort((a, b) => Number(b.pressure || 0) - Number(a.pressure || 0));
    const species = e.species || [];
    const highPressure = species
      .filter((s: any) => Number(s.pressure || 0) >= 55)
      .sort((a, b) => b.pressure - a.pressure);
    const ecologyPressure = Math.max(
      Number(e.disturbance || 0),
      ...species.map((s: any) => Number(s.pressure || 0)),
      0,
    );
    const factionPressure = Math.max(
      ...fs.map((f: any) => Number(f.pressure || 0)),
      0,
    );
    const out: any[] = [];
    if (historical.length)
      out.push(["historical", historical.map((x) => x.id), 5]);
    if (Number(r.danger || 0) >= 72 || Number(r.corruption || 0) >= 68)
      out.push([
        "aftermath",
        recent
          .filter((x) =>
            [
              "regional_crisis",
              "ecological_transition",
              "faction_operation",
            ].includes(String(x.type)),
          )
          .slice(-3)
          .map((x) => x.id),
        4,
      ]);
    if (ecologyPressure >= 58 && highPressure.length)
      out.push([
        "ecological",
        highPressure.slice(0, 3).map((s: any) => s.id),
        3,
      ]);
    if (
      factionPressure >= 62 &&
      top.length >= 2 &&
      Math.abs(Number(top[0].influence || 0) - Number(top[1].influence || 0)) <=
        35
    )
      out.push([
        "factional",
        top
          .slice(0, 2)
          .flatMap((f: any) => f.activeOperations || [])
          .map((o: any) => o.id),
        3,
      ]);
    if (Number(e.recovery || 0) >= 84 && Number(r.danger || 0) <= 30)
      out.push(["recovery", [], 1]);
    return out.sort((a, b) => b[2] - a[2]);
  }
  tick(players: any[] = [], simulationTick = 0, worldTime = Date.now()) {
    const tick = Math.max(0, Number(simulationTick) || 0);
    const results: any[] = [];
    for (const regionId of this.regionIds()) {
      const candidates = this.evaluate(regionId, tick);
      for (const [kind, causes] of candidates) {
        const key = `${regionId}:${kind}`;
        if (
          tick - Number(this.lastGenerated.get(key) || -GENERATION_COOLDOWN) <
          GENERATION_COOLDOWN
        )
          continue;
        const d = this.create(regionId, kind, tick, worldTime, causes, {});
        if (d) break;
      }
    }
    const nowPlayers = (players || []).filter(
      (p: any) => p?.online && p?.hasCharacter && !p?.dungeon,
    );
    for (const p of nowPlayers) {
      const list = [...this.discoveries.values()].filter(
        (d) =>
          d.regionId === String(p.zone) &&
          d.expiresTick > tick &&
          !d.discoveredBy.includes(String(p.id)),
      );
      for (const d of list) {
        if (
          Math.hypot(Number(p.x) - d.x, Number(p.y) - d.y) >
          this.world.normalizedMeters(p.zone, DISCOVERY_RADIUS_METERS)
        )
          continue;
        results.push({
          type: "dynamic_discovery",
          player: p,
          discovery: d,
          xp: d.rarity === "legendary" ? 450 : d.rarity === "rare" ? 260 : 150,
          gold: d.rarity === "legendary" ? 120 : d.rarity === "rare" ? 70 : 35,
        });
      }
    }
    for (const [id, d] of this.discoveries) {
      if (d.expiresTick <= tick && d.discoveredBy.length === 0)
        this.discoveries.delete(id);
    }
    this.persist(false, worldTime);
    return results;
  }
  markDiscovered(discoveryId: string, playerId: string) {
    const d = this.discoveries.get(String(discoveryId));
    if (!d) return false;
    const id = String(playerId);
    if (d.discoveredBy.includes(id)) return false;
    d.discoveredBy.push(id);
    d.discoveredBy = d.discoveredBy.slice(-MAX_DISCOVERED_BY);
    this.dirty = true;
    try {
      this.persist(true, Date.now());
    } catch (error: any) {
      console.warn(
        "[discovery] discovered-by checkpoint failed; durable reward ledger will reconcile on retry:",
        String(error?.message || error),
      );
    }
    return true;
  }
  snapshotForRegion(regionId, tick = Infinity) {
    return [...this.discoveries.values()]
      .filter((d) => d.regionId === String(regionId) && d.expiresTick > tick)
      .map((d) => ({ ...structuredClone(d), discoveredBy: undefined }));
  }
  snapshot() {
    return {
      version: 1,
      discoveries: [...this.discoveries.values()].map((d) =>
        structuredClone(d),
      ),
      lastGenerated: Object.fromEntries(this.lastGenerated),
    };
  }
  persist(force = false, now = Date.now()) {
    if (
      !this.dirty ||
      (!force && now - this.lastPersistAt < this.persistEveryMs)
    )
      return;
    const snapshot = this.snapshot();
    try {
      const result = this.repo?.saveWorldState?.(snapshot, STATE_ID);
      this.lastPersistAt = now;
      this.dirty = false;
      if (result && typeof result.then === "function")
        void result.catch((error: any) => {
          this.dirty = true;
          console.warn(
            "[discovery] world-state save failed; checkpoint will retry:",
            String(error?.message || error),
          );
        });
    } catch (error) {
      this.dirty = true;
      throw error;
    }
  }
  checkpoint(now = Date.now()) {
    this.persist(true, now);
  }
  metrics() {
    return {
      discoveries: this.discoveries.size,
      active: [...this.discoveries.values()].filter(
        (d) =>
          d.expiresTick >
          Number(this.simulation?.snapshot?.().simulationTick || 0),
      ).length,
    };
  }
}
export const WORLD_DISCOVERY_ID = STATE_ID;
