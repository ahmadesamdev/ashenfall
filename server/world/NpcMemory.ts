export type NpcMemoryImportance =
  "personal" | "local" | "regional" | "historical";
export type NpcMemoryRecord = {
  id: string;
  npcId: string;
  playerId: string;
  type: string;
  importance: NpcMemoryImportance;
  firstSeen: number;
  lastSeen: number;
  eventRefs: string[];
  count: number;
  affinityDelta: number;
  lastOutcome?: string;
  lastEventType?: string;
};
const STATE_ID = "npc-memory-v1";
const MAX_MEMORIES = 12000,
  MAX_REFS = 16,
  MAX_NPC_MEMORIES_PER_PLAYER = 32;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const importance = (event: any): NpcMemoryImportance | null => {
  if (event?.severity === "historical") return "historical";
  if (event?.severity === "regional") return "regional";
  if (event?.severity === "local") return "local";
  return null;
};
const typeFor = (event: any) =>
  String(event?.type || "world_event").slice(0, 80);
const safe = (v: any) =>
  String(v || "")
    .trim()
    .slice(0, 160);
const affinityFor = (event: any) => {
  const outcome = String(event?.payload?.outcome || "").toLowerCase();
  const t = typeFor(event);
  let d =
    event?.severity === "historical"
      ? 8
      : event?.severity === "regional"
        ? 4
        : 2;
  if (/failed|loss|collapse|raid|attack|crisis/i.test(t + " " + outcome))
    d = -d;
  if (
    /completed|success|saved|recovered|defended|victory/i.test(
      t + " " + outcome,
    )
  )
    d = Math.abs(d);
  return clamp(d, -10, 10);
};
export class NpcMemory {
  repo: any;
  npcs: any[];
  memories = new Map<string, NpcMemoryRecord>();
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 1000;
  constructor(repo: any, npcs: any[] = []) {
    this.repo = repo;
    this.npcs = npcs;
    this.restore(repo?.loadWorldState?.(STATE_ID));
  }
  private restore(raw: any) {
    for (const m of Array.isArray(raw?.memories)
      ? raw.memories.slice(-MAX_MEMORIES)
      : []) {
      if (!m?.id || !m.npcId || !m.playerId) continue;
      this.memories.set(String(m.id), {
        ...m,
        npcId: String(m.npcId),
        playerId: String(m.playerId),
        eventRefs: Array.isArray(m.eventRefs)
          ? m.eventRefs.slice(-MAX_REFS).map(String)
          : [],
        count: Number.isFinite(Number(m.count))
          ? Math.max(1, Number(m.count))
          : 1,
        affinityDelta: Number.isFinite(Number(m.affinityDelta))
          ? Number(m.affinityDelta)
          : 0,
        importance: m.importance || "personal",
      });
    }
  }
  private key(npcId, playerId, type) {
    return `${npcId}:${playerId}:${type}`;
  }
  private npc(npcId) {
    return this.npcs.find((n) => String(n.id) === String(npcId));
  }
  private upsert(npcId, playerId, type, imp, event, delta) {
    npcId = safe(npcId);
    playerId = safe(playerId);
    if (!npcId || !playerId || !this.npc(npcId)) return;
    const id = this.key(npcId, playerId, type),
      now = Number(event?.worldTime || event?.simulationTick || Date.now());
    const old = this.memories.get(id);
    const m: NpcMemoryRecord = old
      ? { ...old, eventRefs: [...old.eventRefs] }
      : {
          id,
          npcId,
          playerId,
          type,
          importance: imp,
          firstSeen: now,
          lastSeen: now,
          eventRefs: [],
          count: 0,
          affinityDelta: 0,
        };
    m.importance =
      ["historical", "regional", "local", "personal"].indexOf(imp) <
      ["historical", "regional", "local", "personal"].indexOf(m.importance)
        ? imp
        : m.importance;
    m.lastSeen = now;
    m.count++;
    m.affinityDelta = clamp(Number(m.affinityDelta || 0) + delta, -100, 100);
    m.lastEventType = type;
    if (event?.payload?.outcome) m.lastOutcome = String(event.payload.outcome);
    if (event?.id && !m.eventRefs.includes(String(event.id)))
      m.eventRefs.push(String(event.id));
    m.eventRefs = m.eventRefs.slice(-MAX_REFS);
    this.memories.set(id, m);
    this.trimNpcPlayer(npcId, playerId);
    this.dirty = true;
  }
  private trimNpcPlayer(npcId, playerId) {
    const list = [...this.memories.values()]
      .filter((m) => m.npcId === npcId && m.playerId === playerId)
      .sort((a, b) => b.lastSeen - a.lastSeen);
    for (const m of list.slice(MAX_NPC_MEMORIES_PER_PLAYER))
      this.memories.delete(m.id);
    if (this.memories.size > MAX_MEMORIES) {
      const oldest = [...this.memories.values()].sort(
        (a, b) => a.lastSeen - b.lastSeen,
      );
      for (const m of oldest.slice(0, this.memories.size - MAX_MEMORIES))
        this.memories.delete(m.id);
    }
  }
  ingest(event: any) {
    const imp = importance(event);
    if (!imp || !event?.id) return false;
    const region = String(event.regionId || "");
    const participants = new Set<string>();
    if (event.actorId) participants.add(safe(event.actorId));
    for (const id of event.payload?.participantIds || [])
      participants.add(safe(id));
    if (!participants.size) return false;
    let changed = false;
    for (const npc of this.npcs) {
      if (region && String(npc.zone) !== region) continue;
      for (const playerId of participants) {
        this.upsert(
          npc.id,
          playerId,
          typeFor(event),
          imp,
          event,
          affinityFor(event),
        );
        changed = true;
      }
    }
    return changed;
  }
  rememberInteraction(npcId, playerId, now = Date.now()) {
    const n = this.npc(npcId);
    if (!n || !playerId) return;
    this.upsert(
      npcId,
      playerId,
      "interaction",
      "personal",
      {
        id: `interaction:${npcId}:${playerId}:${Math.floor(now / 60000)}`,
        worldTime: now,
        type: "npc_interaction",
        severity: "local",
      },
      1,
    );
  }
  subject(npcId, playerId, limit = 20) {
    return [...this.memories.values()]
      .filter(
        (m) => m.npcId === String(npcId) && m.playerId === String(playerId),
      )
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map((m) => structuredClone(m));
  }
  summary(npcId, playerId) {
    const rows = this.subject(npcId, playerId, 50);
    return {
      npcId: String(npcId),
      playerId: String(playerId),
      memoryCount: rows.length,
      totalEncounters: rows.reduce((n, m) => n + m.count, 0),
      affinity: clamp(
        rows.reduce((n, m) => n + Number(m.affinityDelta || 0), 0),
        -100,
        100,
      ),
      important: rows.filter((m) => m.importance !== "personal").slice(0, 5),
    };
  }
  snapshot() {
    return {
      version: 1,
      memories: [...this.memories.values()].map((m) => structuredClone(m)),
    };
  }
  persist(force = false, now = Date.now()) {
    if (
      !this.dirty ||
      (!force && now - this.lastPersistAt < this.persistEveryMs)
    )
      return;
    this.repo?.saveWorldState?.(this.snapshot(), STATE_ID);
    this.lastPersistAt = now;
    this.dirty = false;
  }
  metrics() {
    return { memories: this.memories.size, npcs: this.npcs.length };
  }
}
export const NPC_MEMORY_ID = STATE_ID;
