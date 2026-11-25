import crypto from "node:crypto";

const STATE_ID = "world-chronicle-v1";
const MAX_ENTRIES = 1000;
const MAX_MEMORIALS = 500;
const MAX_LEGENDS = 500;
const MAX_EVENT_REFS = 24;
const MIN_SIGNIFICANCE = 55;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const stable = (value) =>
  crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 20);
const unique = (xs) => [
  ...new Set((xs || []).map((x) => String(x)).filter(Boolean)),
];

const TYPE_RULES = {
  guild_project_completed: { base: 52, title: "Guild Deed" },
  discovery_found: { base: 48, title: "Discovery" },
  region_discovery_found: { base: 60, title: "Discovery" },
  economic_transition: { base: 28, title: "Trade Chronicle" },
  faction_operation: { base: 42, title: "Faction Chronicle" },
  ecology_transition: { base: 38, title: "Ecological Turning" },
  emergent_world_event: { base: 72, title: "World Turning Point" },
  world_event_completed: { base: 68, title: "World Defense" },
  world_event_failed: { base: 66, title: "World Crisis" },
  boss_killed: { base: 88, title: "Boss Defeat" },
  dungeon_boss_killed: { base: 88, title: "Dungeon Triumph" },
  faction_change: { base: 82, title: "Faction Turning Point" },
  regional_disaster: { base: 92, title: "Regional Disaster" },
  regional_defense: { base: 78, title: "Regional Defense" },
  pvp_battle: { base: 64, title: "Battle" },
  player_death: { base: 45, title: "Memorial" },
};

function eventSignificance(event) {
  const rule = TYPE_RULES[event?.type] || {};
  let score = Number(rule.base || 0);
  if (event?.severity === "historical") score += 28;
  else if (event?.severity === "regional") score += 12;
  else if (event?.severity === "local") score += 4;
  const p = event?.payload || {};
  if (p.major || p.legendary || p.worldChanging) score += 20;
  if (Number(p.participantCount || 0) >= 5) score += 5;
  if (Number(p.influenceDelta || 0) >= 10) score += 5;
  if (Number(p.dangerDelta || 0) <= -8 || Number(p.dangerDelta || 0) >= 8)
    score += 5;
  return clamp(Math.round(score), 0, 100);
}

function participantsFromEvent(event) {
  const p = event?.payload || {};
  return unique([
    event?.actorId,
    ...(Array.isArray(p.participantIds) ? p.participantIds : []),
    ...(Array.isArray(p.playerIds) ? p.playerIds : []),
  ]);
}

export function chronicleTitleFor(event, significance) {
  const p = event?.payload || {};
  if (p.title) return String(p.title);
  const rule = TYPE_RULES[event?.type];
  const name =
    p.eventName || p.projectName || p.discoveryName || p.bossName || p.name;
  if (name)
    return `${name}${significance >= 85 ? " — A Chapter in History" : ""}`;
  return rule?.title || "World Chronicle";
}

export function chronicleSummaryFor(event, significance) {
  const p = event?.payload || {};
  if (p.summary) return String(p.summary);
  const subject =
    p.eventName || p.projectName || p.discoveryName || p.bossName || p.name;
  if (event?.type === "boss_killed" || event?.type === "dungeon_boss_killed")
    return subject
      ? `${subject} was defeated by the recorded participants.`
      : "A major foe was defeated by the recorded participants.";
  if (event?.type === "regional_disaster")
    return subject
      ? `${subject} reshaped the region.`
      : "A regional disaster became part of local history.";
  if (event?.type === "guild_project_completed")
    return subject
      ? `A guild completed ${subject}, leaving a lasting mark on the region.`
      : "A guild completed a significant regional project.";
  if (
    event?.type === "discovery_found" ||
    event?.type === "region_discovery_found"
  )
    return subject
      ? `${subject} was discovered and entered into the world's recorded history.`
      : "A discovery was recorded in the Chronicle.";
  if (event?.type === "emergent_world_event")
    return subject
      ? `${subject} emerged from interacting world conditions.`
      : "A world event emerged from interacting regional conditions.";
  return `A ${event?.severity || "local"} event changed the recorded history of the world.`;
}

export class Chronicle {
  repo;
  state;
  dirty = false;
  lastPersistAt = 0;
  persistEveryMs = 10000;
  constructor(repo) {
    this.repo = repo;
    const raw = repo?.loadWorldState?.(STATE_ID);
    this.state = this.normalize(raw);
  }
  normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      schemaVersion: 1,
      entries: Array.isArray(r.entries) ? r.entries.slice(-MAX_ENTRIES) : [],
      memorials: Array.isArray(r.memorials)
        ? r.memorials.slice(-MAX_MEMORIALS)
        : [],
      legends: Array.isArray(r.legends) ? r.legends.slice(-MAX_LEGENDS) : [],
      updatedAt: Number(r.updatedAt || 0),
    };
  }
  ingest(event) {
    if (!event?.id) return null;
    const rawSignificance =
      event.significance != null
        ? Number(event.significance)
        : eventSignificance(event);
    const significance = Number.isFinite(rawSignificance)
      ? clamp(rawSignificance, 0, 100)
      : 0;
    if (significance < MIN_SIGNIFICANCE) return null;
    const existing = this.state.entries.find(
      (x) => x.eventId === String(event.id),
    );
    if (existing) return existing;
    const participants = participantsFromEvent(event);
    const p = event.payload || {};
    const entry = {
      id: `chron_${stable([event.id, event.type])}`,
      eventId: String(event.id),
      type: String(event.type || "world_event"),
      title: chronicleTitleFor(event, significance),
      summary: chronicleSummaryFor(event, significance),
      regionId: event.regionId ? String(event.regionId) : null,
      simulationTick: Number.isFinite(Number(event.simulationTick))
        ? Math.max(0, Number(event.simulationTick))
        : 0,
      worldTime: Number.isFinite(Number(event.worldTime))
        ? Math.max(0, Number(event.worldTime))
        : 0,
      participants,
      factionIds: unique([
        p.factionId,
        ...(Array.isArray(p.factionIds) ? p.factionIds : []),
      ]),
      guildIds: unique([
        p.guildId,
        ...(Array.isArray(p.guildIds) ? p.guildIds : []),
      ]),
      eventRefs: [String(event.id)],
      causes: unique(event.causes || []).slice(0, MAX_EVENT_REFS),
      significance,
      severity: String(event.severity || "local"),
      source: String(event.source || "world"),
      createdAt: Number(event.worldTime || Date.now()),
    };
    this.state.entries.push(entry);
    if (this.state.entries.length > MAX_ENTRIES)
      this.state.entries.splice(0, this.state.entries.length - MAX_ENTRIES);
    if (significance >= 80 || event.severity === "historical")
      this.upsertLegend(entry);
    if (event.type === "player_death" || p.memorial === true)
      this.upsertMemorial(entry, event);
    this.dirty = true;
    this.persist(false, Number(event.worldTime || Date.now()));
    return entry;
  }
  upsertLegend(entry) {
    const existing = this.state.legends.find(
      (x) => x.eventId === entry.eventId,
    );
    if (existing) return existing;
    const legend = {
      id: `legend_${entry.id.slice(-16)}`,
      eventId: entry.eventId,
      title: entry.title,
      summary: entry.summary,
      regionId: entry.regionId,
      participants: [...entry.participants],
      factionIds: [...entry.factionIds],
      guildIds: [...entry.guildIds],
      significance: entry.significance,
      createdAt: entry.createdAt,
    };
    this.state.legends.push(legend);
    if (this.state.legends.length > MAX_LEGENDS)
      this.state.legends.splice(0, this.state.legends.length - MAX_LEGENDS);
    return legend;
  }
  upsertMemorial(entry, event) {
    const p = event?.payload || {};
    const subjectId = String(
      p.subjectPlayerId || event.actorId || entry.participants[0] || "",
    );
    if (!subjectId) return null;
    const existing = this.state.memorials.find(
      (x) => x.subjectPlayerId === subjectId && x.eventId === entry.eventId,
    );
    if (existing) return existing;
    const memorial = {
      id: `mem_${stable([entry.eventId, subjectId])}`,
      eventId: entry.eventId,
      subjectPlayerId: subjectId,
      subjectName: p.subjectPlayerName || null,
      title:
        p.memorialTitle ||
        `Remembered: ${p.subjectPlayerName || "a fallen hero"}`,
      summary: p.memorialSummary || entry.summary,
      regionId: entry.regionId,
      participants: [...entry.participants],
      significance: entry.significance,
      createdAt: entry.createdAt,
    };
    this.state.memorials.push(memorial);
    if (this.state.memorials.length > MAX_MEMORIALS)
      this.state.memorials.splice(
        0,
        this.state.memorials.length - MAX_MEMORIALS,
      );
    return memorial;
  }
  behaviorProfile(playerId) {
    const id = String(playerId || "");
    const entries = this.state.entries.filter((e) =>
      e.participants.includes(id),
    );
    const counts = {};
    for (const e of entries) {
      const k = e.type;
      counts[k] = (counts[k] || 0) + 1;
    }
    const weighted = (type) =>
      entries
        .filter((e) => e.type === type)
        .reduce((s, e) => s + Number(e.significance || 0), 0);
    const traits = [];
    if (weighted("boss_killed") + weighted("dungeon_boss_killed") >= 160)
      traits.push({
        id: "boss_slayer",
        title: "Boss Slayer",
        score: weighted("boss_killed") + weighted("dungeon_boss_killed"),
      });
    if (weighted("regional_defense") + weighted("world_event_completed") >= 150)
      traits.push({
        id: "defender",
        title: "Defender of the Realm",
        score: weighted("regional_defense") + weighted("world_event_completed"),
      });
    if (weighted("discovery_found") + weighted("region_discovery_found") >= 140)
      traits.push({
        id: "pathfinder",
        title: "Pathfinder",
        score: weighted("discovery_found") + weighted("region_discovery_found"),
      });
    if (weighted("guild_project_completed") >= 120)
      traits.push({
        id: "builder",
        title: "World Builder",
        score: weighted("guild_project_completed"),
      });
    if (weighted("economic_transition") >= 140)
      traits.push({
        id: "trader",
        title: "Master Trader",
        score: weighted("economic_transition"),
      });
    if (weighted("faction_operation") >= 140)
      traits.push({
        id: "faction_hand",
        title: "Hand of the Factions",
        score: weighted("faction_operation"),
      });
    if (weighted("ecology_transition") >= 140)
      traits.push({
        id: "warden_of_wilds",
        title: "Warden of the Wilds",
        score: weighted("ecology_transition"),
      });
    if (weighted("emergent_world_event") >= 120)
      traits.push({
        id: "world_shaper",
        title: "World Shaper",
        score: weighted("emergent_world_event"),
      });
    traits.sort((a, b) => b.score - a.score);
    return {
      playerId: id,
      events: entries.length,
      significance: entries.reduce(
        (s, e) => s + Number(e.significance || 0),
        0,
      ),
      counts,
      traits: traits.slice(0, 5),
    };
  }
  query({
    regionId,
    dateFrom,
    dateTo,
    factionId,
    guildId,
    playerId,
    limit = 50,
  }: any = {}) {
    let rows = [...this.state.entries];
    if (regionId) rows = rows.filter((e) => e.regionId === String(regionId));
    if (factionId)
      rows = rows.filter((e) => e.factionIds.includes(String(factionId)));
    if (guildId)
      rows = rows.filter((e) => e.guildIds.includes(String(guildId)));
    if (playerId)
      rows = rows.filter((e) => e.participants.includes(String(playerId)));
    if (dateFrom != null)
      rows = rows.filter((e) => e.worldTime >= Number(dateFrom));
    if (dateTo != null)
      rows = rows.filter((e) => e.worldTime <= Number(dateTo));
    rows.sort((a, b) => Number(b.worldTime || 0) - Number(a.worldTime || 0));
    return rows
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)))
      .map((x) => structuredClone(x));
  }
  snapshotForPlayer(playerId, limit = 20) {
    const profile = this.behaviorProfile(playerId);
    return {
      recent: this.query({ playerId, limit }),
      profile,
      memorials: this.state.memorials
        .filter((x) => x.subjectPlayerId === String(playerId))
        .slice(-10)
        .reverse()
        .map((x) => structuredClone(x)),
      legends: this.state.legends
        .filter((x) => x.participants.includes(String(playerId)))
        .slice(-10)
        .reverse()
        .map((x) => structuredClone(x)),
    };
  }
  snapshotForRegion(regionId, limit = 20) {
    return {
      entries: this.query({ regionId, limit }),
      legends: this.state.legends
        .filter((x) => x.regionId === String(regionId))
        .slice(-20)
        .reverse()
        .map((x) => structuredClone(x)),
      memorials: this.state.memorials
        .filter((x) => x.regionId === String(regionId))
        .slice(-20)
        .reverse()
        .map((x) => structuredClone(x)),
    };
  }
  snapshot(limit = 100) {
    return {
      schemaVersion: 1,
      entries: this.state.entries
        .slice(-Math.min(MAX_ENTRIES, Math.max(1, Number(limit) || 100)))
        .map((x) => structuredClone(x)),
      legends: this.state.legends
        .slice(-Math.min(MAX_LEGENDS, Math.max(1, Number(limit) || 100)))
        .map((x) => structuredClone(x)),
      memorials: this.state.memorials
        .slice(-Math.min(MAX_MEMORIALS, Math.max(1, Number(limit) || 100)))
        .map((x) => structuredClone(x)),
    };
  }
  metrics() {
    return {
      entries: this.state.entries.length,
      legends: this.state.legends.length,
      memorials: this.state.memorials.length,
    };
  }
  persist(force = false, now = Date.now()) {
    if (!this.dirty && !force) return;
    if (!force && now - this.lastPersistAt < this.persistEveryMs) return;
    this.state.updatedAt = now;
    this.repo?.saveWorldState?.(this.state, STATE_ID);
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
export const WORLD_CHRONICLE_ID = STATE_ID;
