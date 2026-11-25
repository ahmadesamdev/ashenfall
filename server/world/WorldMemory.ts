export type MemoryImportance = "local" | "regional" | "historical";
export type WorldMemoryRecord = {
  id: string;
  subjectType: "player" | "guild" | "region" | "event";
  subjectId: string;
  type: string;
  importance: MemoryImportance;
  firstSeen: number;
  lastSeen: number;
  eventRefs: string[];
  aggregate: {
    count: number;
    lastOutcome?: string;
    lastEventType?: string;
    severity?: string;
  };
};

const MEMORY_ID = "world-memory-v1";
const MAX_MEMORIES = 20000;
const MAX_EVENT_REFS = 32;
const SUMMARY_WINDOW = 100;

const importanceFor = (event: any): MemoryImportance | null => {
  if (event?.severity === "historical") return "historical";
  if (event?.severity === "regional") return "regional";
  if (event?.severity === "local") return "local";
  return null;
};

const safeId = (v: any) =>
  String(v || "")
    .trim()
    .slice(0, 160);

export class WorldMemory {
  repo: any;
  memories = new Map<string, WorldMemoryRecord>();
  regionalSummaries = new Map<string, any>();
  lastPersistAt = 0;
  persistEveryMs = 60000;

  constructor(repo: any) {
    this.repo = repo;
    const raw = repo?.loadWorldState?.(MEMORY_ID);
    this.restore(raw);
  }

  private restore(raw: any) {
    if (!raw || typeof raw !== "object") return;
    for (const m of Array.isArray(raw.memories)
      ? raw.memories.slice(-MAX_MEMORIES)
      : []) {
      if (!m?.id || !m?.subjectId || !m?.subjectType) continue;
      this.memories.set(String(m.id), {
        id: String(m.id),
        subjectType: m.subjectType,
        subjectId: String(m.subjectId),
        type: String(m.type || "unknown"),
        importance: m.importance || "local",
        firstSeen: Number(m.firstSeen || 0),
        lastSeen: Number(m.lastSeen || 0),
        eventRefs: Array.isArray(m.eventRefs)
          ? m.eventRefs.slice(-MAX_EVENT_REFS).map(String)
          : [],
        aggregate: {
          ...(m.aggregate || {}),
          count: Math.max(1, Number(m.aggregate?.count || 1)),
        },
      });
    }
    for (const [regionId, summary] of Object.entries(
      raw.regionalSummaries || {},
    ))
      this.regionalSummaries.set(String(regionId), summary);
  }

  private key(subjectType: string, subjectId: string, type: string) {
    return `${subjectType}:${subjectId}:${type}`;
  }

  private upsert(
    subjectType: any,
    subjectId: any,
    type: string,
    importance: MemoryImportance,
    event: any,
  ) {
    const sid = safeId(subjectId);
    if (!sid) return;
    const key = this.key(subjectType, sid, type);
    const existing = this.memories.get(key);
    const now = Number(event.worldTime || event.simulationTick || Date.now());
    const next: WorldMemoryRecord = existing
      ? {
          ...existing,
          eventRefs: [...existing.eventRefs],
          aggregate: { ...existing.aggregate },
        }
      : {
          id: key,
          subjectType,
          subjectId: sid,
          type,
          importance,
          firstSeen: now,
          lastSeen: now,
          eventRefs: [],
          aggregate: { count: 0 },
        };
    next.importance =
      next.importance === "historical" || importance === "historical"
        ? "historical"
        : next.importance === "regional" || importance === "regional"
          ? "regional"
          : "local";
    next.lastSeen = now;
    next.aggregate.count = Number(next.aggregate.count || 0) + 1;
    next.aggregate.lastEventType = String(event.type || "unknown");
    next.aggregate.severity = String(event.severity || "local");
    if (event.payload?.outcome)
      next.aggregate.lastOutcome = String(event.payload.outcome);
    if (!next.eventRefs.includes(String(event.id)))
      next.eventRefs.push(String(event.id));
    next.eventRefs = next.eventRefs.slice(-MAX_EVENT_REFS);
    this.memories.set(key, next);
    if (this.memories.size > MAX_MEMORIES) {
      const overflow = this.memories.size - MAX_MEMORIES;
      const oldest = [...this.memories.values()]
        .sort((a, b) => a.lastSeen - b.lastSeen)
        .slice(0, overflow);
      for (const item of oldest) this.memories.delete(item.id);
    }
  }

  ingest(event: any) {
    const importance = importanceFor(event);
    if (!importance || !event?.id) return false;
    const regionId = safeId(event.regionId);
    if (regionId)
      this.upsert(
        "region",
        regionId,
        `event:${String(event.type || "unknown")}`,
        importance,
        event,
      );
    const playerIds = new Set<string>();
    if (event.actorId) playerIds.add(safeId(event.actorId));
    for (const playerId of Array.isArray(event.payload?.participantIds)
      ? event.payload.participantIds
      : [])
      playerIds.add(safeId(playerId));
    for (const playerId of playerIds)
      this.upsert(
        "player",
        playerId,
        `event:${String(event.type || "unknown")}`,
        importance,
        event,
      );
    if (importance === "historical" || importance === "regional")
      this.upsert(
        "event",
        event.id,
        `historical:${String(event.type || "unknown")}`,
        importance,
        event,
      );
    if (regionId) this.rebuildRegionSummary(regionId);
    return true;
  }

  rebuildRegionSummary(regionId: string) {
    const relevant = [...this.memories.values()]
      .filter((m) => m.subjectType === "region" && m.subjectId === regionId)
      .sort((a, b) => b.lastSeen - a.lastSeen);
    const recent = relevant.slice(0, SUMMARY_WINDOW);
    this.regionalSummaries.set(regionId, {
      regionId,
      updatedAt: recent.length ? Math.max(...recent.map((x) => x.lastSeen)) : 0,
      memoryCount: relevant.length,
      historicalCount: relevant.filter((x) => x.importance === "historical")
        .length,
      recent: recent
        .slice(0, 20)
        .map((x) => ({
          type: x.type,
          importance: x.importance,
          count: x.aggregate.count,
          lastSeen: x.lastSeen,
          eventRefs: x.eventRefs.slice(-5),
        })),
    });
  }

  regionSummary(regionId: string) {
    return structuredClone(
      this.regionalSummaries.get(String(regionId)) || {
        regionId: String(regionId),
        memoryCount: 0,
        historicalCount: 0,
        recent: [],
      },
    );
  }
  subject(subjectType: string, subjectId: string, limit = 50) {
    return [...this.memories.values()]
      .filter(
        (m) =>
          m.subjectType === subjectType && m.subjectId === String(subjectId),
      )
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, Math.max(1, Math.min(200, limit)))
      .map((m) => structuredClone(m));
  }
  snapshot(limit = 200) {
    return {
      version: 1,
      memories: [...this.memories.values()]
        .slice(-Math.max(1, Math.min(MAX_MEMORIES, limit)))
        .map((m) => structuredClone(m)),
      regionalSummaries: Object.fromEntries(
        [...this.regionalSummaries.entries()].map(([k, v]) => [
          k,
          structuredClone(v),
        ]),
      ),
    };
  }
  persist(force = false, now = Date.now()) {
    if (!force && now - this.lastPersistAt < this.persistEveryMs) return;
    this.repo?.saveWorldState?.(this.snapshot(), MEMORY_ID);
    this.lastPersistAt = now;
  }
  metrics() {
    return {
      memories: this.memories.size,
      regionalSummaries: this.regionalSummaries.size,
    };
  }
}

export const WORLD_MEMORY_ID = MEMORY_ID;
