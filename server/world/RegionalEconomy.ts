import crypto from "node:crypto";

const STATE_ID = "regional-economy-v1";
const MAX_CARAVANS = 48;
const MAX_HISTORY = 1200;
const TICK_INTERVAL = 20;
const RESOURCE_BASE = 100;
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const finite = (n: any, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d);

export type RegionalMarket = {
  supply: Record<string, number>;
  demand: Record<string, number>;
  prices: Record<string, number>;
  prosperity: number;
  scarcity: number;
  updatedTick: number;
};
export type Caravan = {
  id: string;
  from: string;
  to: string;
  resource: string;
  amount: number;
  progress: number;
  risk: number;
  createdTick: number;
  etaTick: number;
  state: "traveling" | "arrived" | "lost";
  ownerFactionId: string | null;
  sourceEventIds: string[];
};

export class RegionalEconomy {
  repo: any;
  regions: any[];
  state: any;
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 10000;
  adjacency: Record<string, string[]> = {};
  materialByRegion: Record<string, string[]> = {};
  constructor(repo: any, regions: any[] = []) {
    this.repo = repo;
    this.regions = Array.isArray(regions) ? regions : [];
    for (const r of this.regions)
      this.materialByRegion[String(r.id)] = Array.isArray(r.materials)
        ? r.materials.map(String)
        : [];
    this.adjacency = this.buildAdjacency();
    this.state = this.restore(repo?.loadWorldState?.(STATE_ID));
  }
  buildAdjacency() {
    const out: any = {};
    for (const r of this.regions) out[String(r.id)] = new Set();
    for (const a of this.regions) {
      for (const b of this.regions) {
        if (a.id === b.id) continue;
        const overlap = (this.materialByRegion[a.id] || []).filter((x) =>
          (this.materialByRegion[b.id] || []).includes(x),
        ).length;
        if (overlap > 0) out[a.id].add(String(b.id));
      }
    }
    return Object.fromEntries(
      Object.entries(out).map(([k, v]: any) => [k, [...v].sort().slice(0, 5)]),
    );
  }
  baseMarket(regionId: string) {
    const materials = this.materialByRegion[regionId] || [];
    const supply: any = {},
      demand: any = {},
      prices: any = {};
    for (const m of materials) {
      supply[m] = RESOURCE_BASE;
      demand[m] = RESOURCE_BASE;
      prices[m] = 10;
    }
    return {
      supply,
      demand,
      prices,
      prosperity: 60,
      scarcity: 0,
      updatedTick: 0,
    };
  }
  restore(raw: any) {
    const markets: any = {};
    for (const r of this.regions) {
      const id = String(r.id);
      const b = this.baseMarket(id),
        x = raw?.markets?.[id] || {};
      markets[id] = {
        ...b,
        ...x,
        supply: { ...b.supply, ...(x.supply || {}) },
        demand: { ...b.demand, ...(x.demand || {}) },
        prices: { ...b.prices, ...(x.prices || {}) },
      };
    }
    return {
      schemaVersion: 1,
      tick: finite(raw?.tick),
      markets,
      caravans: Array.isArray(raw?.caravans)
        ? raw.caravans.slice(-MAX_CARAVANS)
        : [],
      history: Array.isArray(raw?.history)
        ? raw.history.slice(-MAX_HISTORY)
        : [],
    };
  }
  snapshot() {
    return structuredClone(this.state);
  }
  region(id: string) {
    const k = String(id);
    if (!this.state.markets[k]) this.state.markets[k] = this.baseMarket(k);
    return this.state.markets[k];
  }
  price(regionId: string, resource: string) {
    const m = this.region(regionId),
      s = Math.max(1, finite(m.supply[resource], RESOURCE_BASE)),
      d = Math.max(1, finite(m.demand[resource], RESOURCE_BASE));
    const base = finite(m.prices[resource], 10);
    return Number(clamp(base * Math.pow(d / s, 0.72), 1, 500).toFixed(2));
  }
  observeHarvest(
    regionId: string,
    resource: string,
    qty: number,
    playerId: string,
    tick: number,
  ) {
    const q = clamp(Math.floor(finite(qty)), 1, 50);
    const m = this.region(regionId);
    if (!(resource in m.supply)) return false;
    m.supply[resource] = clamp(
      finite(m.supply[resource], RESOURCE_BASE) - q,
      0,
      500,
    );
    m.demand[resource] = clamp(
      finite(m.demand[resource], RESOURCE_BASE) + Math.ceil(q * 0.15),
      0,
      500,
    );
    m.scarcity = clamp(m.scarcity + q * 0.45, 0, 100);
    m.updatedTick = Math.max(m.updatedTick, tick);
    this.state.history.push({
      id: `harvest:${tick}:${regionId}:${resource}:${playerId}:${hash(`${tick}:${regionId}:${resource}:${playerId}`).slice(0, 8)}`,
      type: "harvest",
      regionId: String(regionId),
      resource,
      qty: q,
      playerId: String(playerId),
      tick,
    });
    this.trim();
    this.dirty = true;
    return true;
  }
  observeTrade(
    regionId: string,
    resource: string,
    qty: number,
    value: number,
    tick: number,
  ) {
    const m = this.region(regionId);
    const q = clamp(Math.floor(finite(qty)), 1, 100);
    m.demand[resource] = clamp(
      finite(m.demand[resource], RESOURCE_BASE) - q * 0.35,
      0,
      500,
    );
    m.supply[resource] = clamp(
      finite(m.supply[resource], RESOURCE_BASE) + q * 0.25,
      0,
      500,
    );
    m.prosperity = clamp(
      m.prosperity + clamp(finite(value) / 1000, -2, 2),
      0,
      100,
    );
    m.updatedTick = tick;
    this.dirty = true;
  }
  applyWorldContractOutcome(
    regionId: string,
    resource: string,
    qty: number,
    outcome: string,
    tick: number,
    caravanId: string | null = null,
  ) {
    const m = this.region(regionId);
    const q = clamp(Math.floor(finite(qty)), 1, 100);
    if (resource && !(resource in m.supply)) return false;
    if (String(outcome) === "success") {
      if (resource)
        m.demand[resource] = clamp(
          finite(m.demand[resource], RESOURCE_BASE) - q * 0.15,
          0,
          500,
        );
      m.scarcity = clamp(m.scarcity - q * 0.35, 0, 100);
      m.prosperity = clamp(m.prosperity + 0.75, 0, 100);
    } else {
      if (resource) {
        m.supply[resource] = clamp(
          finite(m.supply[resource], RESOURCE_BASE) - q * 0.6,
          0,
          500,
        );
        m.demand[resource] = clamp(
          finite(m.demand[resource], RESOURCE_BASE) + q * 0.5,
          0,
          500,
        );
      }
      m.scarcity = clamp(m.scarcity + q * 0.55, 0, 100);
      m.prosperity = clamp(m.prosperity - 0.9, 0, 100);
    }
    m.updatedTick = Math.max(m.updatedTick, tick);
    this.state.history.push({
      id: `world-contract:${caravanId || regionId}:${tick}:${outcome}`,
      type: "world_contract_outcome",
      regionId: String(regionId),
      resource: resource || null,
      qty: q,
      outcome: String(outcome),
      caravanId: caravanId || null,
      tick,
    });
    this.trim();
    this.dirty = true;
    return true;
  }
  resolveWorldContractCaravan(
    caravanId: string,
    outcome: string,
    tick: number,
  ) {
    const id = String(caravanId || "");
    if (!id) return false;
    const c = this.state.caravans.find((x) => String(x.id) === id);
    if (!c) return false;
    if (c.state !== "traveling")
      return c.state === (String(outcome) === "success" ? "arrived" : "lost");
    if (String(outcome) === "success") {
      c.risk = clamp(Number(c.risk || 0) - 25, 0, 100);
      c.escortProtectedTick = Math.max(
        Number(c.escortProtectedTick || 0),
        tick + 100,
      );
    } else {
      c.state = "lost";
      c.progress = clamp(Number(c.progress || 0), 0, 1);
    }
    this.dirty = true;
    return true;
  }
  tick(simulationTick: number, now = Date.now(), worldPlayers: any[] = []) {
    const tick = Math.max(this.state.tick, Math.floor(finite(simulationTick)));
    this.state.tick = tick;
    if (tick % TICK_INTERVAL !== 0) return [];
    const active = new Set(
      (worldPlayers || [])
        .filter((p) => p?.online && p?.hasCharacter && !p?.dead)
        .map((p) => String(p.zone || "")),
    );
    const events: any[] = [];
    for (const [rid, m] of Object.entries(this.state.markets) as any) {
      const base = RESOURCE_BASE;
      for (const resource of Object.keys(m.supply)) {
        const base = RESOURCE_BASE;
        const pressure = (m.demand[resource] - m.supply[resource]) / base;
        m.supply[resource] = clamp(
          m.supply[resource] + (base - m.supply[resource]) * 0.018,
          0,
          500,
        );
        m.demand[resource] = clamp(
          m.demand[resource] + (base - m.demand[resource]) * 0.012,
          0,
          500,
        );
        m.prices[resource] = this.price(rid, resource);
        m.scarcity = clamp(
          m.scarcity + pressure * 0.7 - m.scarcity * 0.012,
          0,
          100,
        );
      }
      const values = Object.values(m.scarcity ? m.supply : {}) as any[];
      const avg = values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : base;
      m.prosperity = clamp(
        m.prosperity + (avg - base) * 0.015 - m.scarcity * 0.006,
        0,
        100,
      );
      m.updatedTick = tick;
      if (tick % 100 === 0) {
        const shortage = this.shortage(rid);
        if (shortage) {
          const candidates = (this.adjacency[rid] || []).filter(
            (x) => this.state.markets[x],
          );
          if (candidates.length) {
            const source = candidates
              .map((x) => ({
                id: x,
                amount: this.surplus(x, shortage.resource),
              }))
              .sort((a, b) => b.amount - a.amount)[0];
            if (source.amount >= 10) {
              const amount = Math.min(
                25,
                Math.max(10, Math.floor(source.amount * 0.2)),
              );
              const id = `caravan:${hash(`${tick}:${source.id}:${rid}:${shortage.resource}:${amount}`).slice(0, 16)}`;
              if (
                !this.state.caravans.some(
                  (c) =>
                    c.state === "traveling" &&
                    c.from === source.id &&
                    c.to === rid &&
                    c.resource === shortage.resource,
                ) &&
                this.state.caravans.filter((c) => c.state === "traveling")
                  .length < MAX_CARAVANS
              ) {
                const risk = clamp(
                  (this.region(rid).scarcity +
                    this.region(source.id).scarcity) /
                    2,
                  0,
                  100,
                );
                const caravan = {
                  id,
                  from: source.id,
                  to: rid,
                  resource: shortage.resource,
                  amount,
                  progress: 0,
                  risk,
                  createdTick: tick,
                  etaTick: tick + 100,
                  state: "traveling",
                  ownerFactionId: null,
                  sourceEventIds: [],
                };
                this.state.caravans.push(caravan);
                this.region(source.id).supply[shortage.resource] = clamp(
                  this.region(source.id).supply[shortage.resource] - amount,
                  0,
                  500,
                );
                events.push({
                  type: "caravan_departed",
                  caravan,
                  regionId: source.id,
                });
                this.dirty = true;
              }
            }
          }
        }
      }
    }
    for (const c of this.state.caravans
      .filter((x) => x.state === "traveling")
      .slice(0, MAX_CARAVANS)) {
      c.progress = clamp(
        (tick - c.createdTick) / Math.max(1, c.etaTick - c.createdTick),
        0,
        1,
      );
      if (tick >= c.etaTick) {
        const roll =
          parseInt(hash(`${c.id}:${tick}`).slice(0, 8), 16) / 0xffffffff;
        if (roll < (c.risk / 100) * 0.22) {
          c.state = "lost";
          events.push({ type: "caravan_lost", caravan: c, regionId: c.to });
        } else {
          c.state = "arrived";
          const m = this.region(c.to);
          m.supply[c.resource] = clamp(
            finite(m.supply[c.resource], RESOURCE_BASE) + c.amount,
            0,
            500,
          );
          m.demand[c.resource] = clamp(
            finite(m.demand[c.resource], RESOURCE_BASE) - c.amount * 0.25,
            0,
            500,
          );
          m.scarcity = clamp(m.scarcity - c.amount * 0.35, 0, 100);
          events.push({ type: "caravan_arrived", caravan: c, regionId: c.to });
        }
        this.dirty = true;
      }
    }
    this.state.caravans = this.state.caravans.slice(-MAX_CARAVANS);
    this.trim();
    this.persist(false, now);
    return events.slice(0, 8);
  }
  shortage(regionId: string) {
    const m = this.region(regionId);
    return (
      Object.keys(m.supply)
        .map((r) => ({
          resource: r,
          need: finite(m.demand[r]) - finite(m.supply[r]),
        }))
        .filter((x) => x.need > 20)
        .sort((a, b) => b.need - a.need)[0] || null
    );
  }
  surplus(regionId: string, resource: string) {
    const m = this.region(regionId);
    return Math.max(0, finite(m.supply[resource]) - finite(m.demand[resource]));
  }
  trim() {
    if (this.state.history.length > MAX_HISTORY)
      this.state.history = this.state.history.slice(-MAX_HISTORY);
  }
  snapshotForRegion(regionId: string) {
    const m = this.region(regionId);
    return {
      regionId: String(regionId),
      ...m,
      prices: Object.fromEntries(
        Object.keys(m.supply).map((r) => [r, this.price(regionId, r)]),
      ),
      shortage: this.shortage(regionId),
      caravans: this.state.caravans
        .filter((c) => c.from === String(regionId) || c.to === String(regionId))
        .map((c) => ({ ...c })),
    };
  }
  metrics() {
    return {
      tick: this.state.tick,
      regions: Object.keys(this.state.markets).length,
      activeCaravans: this.state.caravans.filter((c) => c.state === "traveling")
        .length,
      history: this.state.history.length,
    };
  }
  persist(force = false, now = Date.now()) {
    if (!this.dirty && !force) return;
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
export const REGIONAL_ECONOMY_ID = STATE_ID;
