import fs from "node:fs";
import path from "node:path";
import type { PlayerRecord, PlayerRepository } from "./Repository.js";

type StoredCollection = Record<string, unknown>;

export class MemoryRepository implements PlayerRepository {
  readonly players = new Map<string, PlayerRecord>();
  private readonly worldStates = new Map<string, StoredCollection>();
  private readonly economyStates = new Map<string, StoredCollection>();
  private readonly characterNames = new Map<string, string>();
  private readonly rewardOwners = new Map<string, string>();
  private readonly worldLeases = new Map<
    string,
    { ownerId: string; fencingToken: number; expiresAt: number }
  >();
  private readonly outbox = new Map<string, any>();
  private readonly file: string;
  private readonly backup: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(file = path.resolve(process.cwd(), "data", "players.json")) {
    this.file = file;
    this.backup = `${file}.bak`;
    this.loadPlayers();
  }

  authInit(): void {}
  setWorldLeaseContext(
    _worldId: string,
    _ownerId: string,
    _fencingToken: number,
  ): void {}
  authReplaceAccountSession(
    _tokenHash: string,
    _accountId: string,
    _expiresAt: number,
    _bumpSessionVersion = true,
  ): number {
    throw new Error(
      "Account authentication is not supported by MemoryRepository.",
    );
  }
  acquireWorldLease(
    worldId: string,
    ownerId: string,
    now: number,
    leaseMs: number,
  ) {
    const old = this.worldLeases.get(worldId);
    if (old && old.expiresAt > now && old.ownerId !== ownerId)
      return {
        acquired: false,
        fencingToken: old.fencingToken,
        expiresAt: old.expiresAt,
      };
    const fencingToken = old
      ? old.expiresAt > now && old.ownerId === ownerId
        ? old.fencingToken
        : old.fencingToken + 1
      : 1;
    const lease = { ownerId, fencingToken, expiresAt: now + leaseMs };
    this.worldLeases.set(worldId, lease);
    return { acquired: true, ...lease };
  }
  renewWorldLease(
    worldId: string,
    ownerId: string,
    fencingToken: number,
    now: number,
    leaseMs: number,
  ) {
    const l = this.worldLeases.get(worldId);
    if (
      !l ||
      l.ownerId !== ownerId ||
      l.fencingToken !== fencingToken ||
      l.expiresAt <= now
    )
      return false;
    l.expiresAt = now + leaseMs;
    return true;
  }
  releaseWorldLease(worldId: string, ownerId: string, fencingToken: number) {
    const l = this.worldLeases.get(worldId);
    if (l && l.ownerId === ownerId && l.fencingToken === fencingToken)
      l.expiresAt = 0;
  }
  enqueueOutbox(event: {
    id: string;
    type: string;
    aggregateId: string;
    payload: unknown;
    createdAt?: number;
  }) {
    if (!this.outbox.has(event.id))
      this.outbox.set(event.id, {
        ...event,
        status: "pending",
        attempts: 0,
        availableAt: event.createdAt || Date.now(),
      });
  }
  claimOutbox(consumer: string, limit = 50, now = Date.now()) {
    const found = [...this.outbox.values()]
      .filter(
        (e) =>
          (e.status === "pending" && e.availableAt <= now) ||
          (e.status === "processing" && e.lockedUntil <= now),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(1, Math.min(500, limit)));
    for (const e of found) {
      e.status = "processing";
      e.lockedBy = consumer;
      e.lockedUntil = now + 30000;
      e.attempts++;
    }
    return found.map((e) => ({ ...e }));
  }
  completeOutbox(eventId: string, consumer: string, now = Date.now()) {
    const e = this.outbox.get(eventId);
    if (e?.status === "processing" && e.lockedBy === consumer) {
      e.status = "completed";
      e.completedAt = now;
      e.lockedBy = null;
      e.lockedUntil = null;
    }
  }
  failOutbox(
    eventId: string,
    consumer: string,
    error: string,
    now = Date.now(),
  ) {
    const e = this.outbox.get(eventId);
    if (e?.status === "processing" && e.lockedBy === consumer) {
      e.status = "pending";
      e.availableAt = now + 30000;
      e.lastError = String(error).slice(0, 2000);
      e.lockedBy = null;
      e.lockedUntil = null;
    }
  }

  reserveCharacterName(nameKey: string, playerId: string): void {
    const key = String(nameKey || "").trim();
    const owner = this.characterNames.get(key);
    if (owner && owner !== String(playerId))
      throw new Error("That character name is already taken.");
    this.characterNames.set(key, String(playerId));
  }

  releaseCharacterName(nameKey: string, playerId?: string): void {
    const key = String(nameKey || "").trim();
    if (!playerId || this.characterNames.get(key) === String(playerId))
      this.characterNames.delete(key);
  }

  savePlayer(player: PlayerRecord): void {
    this.players.set(String(player.id), player);
    this.markDirty();
  }

  savePlayerNow(player: PlayerRecord): void {
    this.players.set(String(player.id), player);
    this.flush();
  }

  savePlayerRewardOnce(player: PlayerRecord, rewardKey: string): boolean;
  savePlayerRewardOnce(
    player: PlayerRecord,
    rewardKey: string,
    outboxEvent?: {
      id: string;
      type: string;
      aggregateId: string;
      payload: unknown;
    },
  ): boolean {
    if (!player?.id)
      throw new Error("Cannot persist a reward for a player without an id.");
    const key = String(rewardKey || "").trim();
    if (!key || key.length > 512)
      throw new Error("Reward idempotency key must be 1–512 characters.");
    const keys = Array.isArray(player._rewardLedger)
      ? player._rewardLedger
      : [];
    const owner = this.rewardOwners.get(key);
    if (owner) {
      if (owner !== String(player.id))
        throw new Error(
          "Reward idempotency key is already owned by another player.",
        );
      return false;
    }
    if (keys.includes(key)) return false;
    const previousLedger = player._rewardLedger;
    const id = String(player.id);
    const previousPlayer = this.players.get(id);
    player._rewardLedger = [...keys, key];
    this.players.set(id, player);
    try {
      const list = this.allPlayers().map((entry) => ({
        ...entry,
        online: false,
      }));
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(list, null, 2));
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
      fs.renameSync(temp, this.file);
      this.dirty = false;
      this.rewardOwners.set(key, id);
      this.enqueueOutbox(
        outboxEvent || {
          id: `reward:${key}`,
          type: "reward.player_committed",
          aggregateId: id,
          payload: {
            playerId: id,
            rewardKey: key,
            zone: String(player.zone || ""),
          },
        },
      );
      return true;
    } catch (error) {
      if (previousLedger === undefined) delete player._rewardLedger;
      else player._rewardLedger = previousLedger;
      if (previousPlayer) this.players.set(id, previousPlayer);
      else this.players.delete(id);
      try {
        fs.rmSync(`${this.file}.tmp`, { force: true });
      } catch {}
      throw error;
    }
  }

  savePlayersWithRewardsOnce(
    players: PlayerRecord[],
    rewardKeys: string[],
  ): boolean;
  savePlayersWithRewardsOnce(
    players: PlayerRecord[],
    rewardKeys: string[],
    outboxEvents?: Array<{
      id: string;
      type: string;
      aggregateId: string;
      payload: unknown;
    }>,
  ): boolean {
    const supplied = (players || []).filter((p) => p?.id);
    const unique = [
      ...new Map(supplied.map((p) => [String(p.id), p])).values(),
    ];
    if (!unique.length) return true;
    if (unique.length !== supplied.length)
      throw new Error("A group reward cannot contain duplicate player IDs.");
    if (unique.length !== rewardKeys.length)
      throw new Error("Each player must have exactly one reward key.");
    const pairs = unique.map((player, i) => {
      const key = String(rewardKeys[i] || "").trim();
      if (!key || key.length > 512)
        throw new Error("Reward idempotency key must be 1–512 characters.");
      const ledger = Array.isArray(player._rewardLedger)
        ? player._rewardLedger
        : [];
      return { player, key, ledger };
    });
    for (const x of pairs) {
      const owner = this.rewardOwners.get(x.key);
      if (owner && owner !== String(x.player.id))
        throw new Error(
          "Reward idempotency key is already owned by another player.",
        );
      if (owner === String(x.player.id) || x.ledger.includes(x.key))
        return false;
    }
    const snapshots = pairs.map(({ player }) => ({
      player,
      ledger: player._rewardLedger,
      stored: this.players.get(String(player.id)),
    }));
    try {
      for (const x of pairs) {
        x.player._rewardLedger = [...x.ledger, x.key];
        this.players.set(String(x.player.id), x.player);
      }
      const list = this.allPlayers().map((entry) => ({
        ...entry,
        online: false,
      }));
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(list, null, 2));
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
      fs.renameSync(temp, this.file);
      this.dirty = false;
      for (const x of pairs) this.rewardOwners.set(x.key, String(x.player.id));
      const events =
        outboxEvents ||
        unique.map((p, i) => ({
          id: `reward:${String(rewardKeys[i])}`,
          type: "reward.player_committed",
          aggregateId: String(p.id),
          payload: {
            playerId: String(p.id),
            rewardKey: String(rewardKeys[i]),
            zone: String(p.zone || ""),
          },
        }));
      if (!outboxEvents) {
        const completion = unique.find(
          (p: any) =>
            p?.lastDungeonResult?.complete ||
            p?.lastDungeonResult?.optionalComplete,
        );
        if (completion) {
          const result = completion.lastDungeonResult;
          const instanceId = String(
            result.instanceId || completion.dungeon?.instanceId || "unknown",
          );
          events.push({
            id: `outbox:dungeon-completion:${instanceId}:${result.optionalComplete ? "optional" : "final"}`,
            type: "dungeon.completion_committed",
            aggregateId: instanceId,
            payload: {
              instanceId,
              dungeonId: result.dungeonId || completion.dungeon?.id || null,
              memberIds: unique.map((m: any) => String(m.id)),
              result,
              returnZones: result.returnZones || {},
              player: { id: completion.id, zone: completion.zone },
            },
          });
        }
      }
      for (const event of events) this.enqueueOutbox(event);
      return true;
    } catch (error) {
      for (const x of snapshots) {
        if (x.ledger === undefined) delete x.player._rewardLedger;
        else x.player._rewardLedger = x.ledger;
        if (x.stored) this.players.set(String(x.player.id), x.stored);
        else this.players.delete(String(x.player.id));
      }
      try {
        fs.rmSync(`${this.file}.tmp`, { force: true });
      } catch {}
      throw error;
    }
  }

  savePlayersAtomically(players: PlayerRecord[]): void {
    const next = new Map(this.players);
    for (const player of players) next.set(String(player.id), player);
    this.players.clear();
    for (const [id, player] of next) this.players.set(id, player);
    this.flush();
  }

  savePlayersAndEconomyAtomically(
    players: PlayerRecord[],
    economy: unknown,
    id = "global",
  ): void {
    this.savePlayersAtomically(players);
    this.saveEconomyState(economy, id);
    this.flush();
  }

  getPlayer(id: string): PlayerRecord | undefined {
    return this.players.get(String(id));
  }

  allPlayers(): PlayerRecord[] {
    return [...this.players.values()];
  }

  loadEconomyState(id = "global"): StoredCollection | undefined {
    return this.economyStates.get(String(id));
  }

  saveEconomyState(data: unknown, id = "global"): void {
    this.economyStates.set(String(id), cloneRecord(data));
    this.markDirty();
  }

  loadWorldState(id = "global"): StoredCollection | undefined {
    return this.worldStates.get(String(id));
  }

  saveWorldState(data: unknown, id = "global"): void {
    this.worldStates.set(String(id), cloneRecord(data));
    this.markDirty();
  }

  saveWorldStateNow(data: unknown, id = "global"): void {
    this.saveWorldState(data, id);
  }

  stats(): Record<string, unknown> {
    return {
      backend: "memory",
      players: this.players.size,
      worldStates: this.worldStates.size,
      economyStates: this.economyStates.size,
      characterNames: this.characterNames.size,
    };
  }

  checkpoint(): void {
    this.flush();
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush();
  }

  integrityCheck(): boolean {
    return [...this.players.values()].every(
      (player) => typeof player.id === "string" && player.id.length > 0,
    );
  }

  private loadPlayers(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      for (const candidate of [this.file, this.backup]) {
        if (!fs.existsSync(candidate)) continue;
        try {
          const parsed: unknown = JSON.parse(
            fs.readFileSync(candidate, "utf8"),
          );
          if (!Array.isArray(parsed)) continue;
          for (const raw of parsed) {
            if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id)
              continue;
            raw.online = false;
            this.players.set(raw.id, raw as PlayerRecord);
          }
          break;
        } catch {}
      }
      this.rebuildCharacterNameIndex();
      this.rebuildRewardOwners();
    } catch (error) {
      console.warn("player persistence load failed", error);
    }
  }

  private rebuildRewardOwners(): void {
    this.rewardOwners.clear();
    for (const player of this.players.values()) {
      for (const rawKey of Array.isArray(player._rewardLedger)
        ? player._rewardLedger
        : []) {
        const key = String(rawKey || "").trim();
        if (!key) continue;
        const owner = this.rewardOwners.get(key);
        if (owner && owner !== String(player.id)) {
          throw new Error(
            `Reward ledger key collision between players ${owner} and ${String(player.id)}.`,
          );
        }
        this.rewardOwners.set(key, String(player.id));
      }
    }
  }

  private rebuildCharacterNameIndex(): void {
    this.characterNames.clear();
    for (const player of this.players.values()) {
      if (player.hasCharacter && typeof player.name === "string") {
        this.characterNames.set(
          player.name.trim().toLowerCase(),
          String(player.id),
        );
      }
    }
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 500);
  }

  private flush(): void {
    if (!this.dirty && this.players.size === 0) return;
    try {
      const list = this.allPlayers().map((player) => ({
        ...player,
        online: false,
      }));
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(list, null, 2));
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.backup);
      fs.renameSync(temp, this.file);
      this.dirty = false;
    } catch (error) {
      console.warn("player persistence save failed", error);
    }
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneRecord(value: unknown): StoredCollection {
  return isRecord(value)
    ? (JSON.parse(JSON.stringify(value)) as StoredCollection)
    : {};
}
