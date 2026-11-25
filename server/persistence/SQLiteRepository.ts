import fs from "node:fs";
import path from "node:path";
declare const process: any;
import { createRequire } from "node:module";

type PlayerRecord = Record<string, any>;

type SqliteModule = { DatabaseSync: new (file: string) => any };

const SCHEMA_VERSION = 5;
const MAX_PLAYER_BYTES = 2_000_000;
const MAX_ECONOMY_BYTES = 8_000_000;

class SQLiteRepository {
  players = new Map<string, PlayerRecord>();
  private db: any;
  private pending = new Set<string>();
  private oversizedPlayers = new Set<string>();
  private warnedOversizedPlayers = new Set<string>();
  private conflictedPlayers = new Set<string>();
  private playerRevisions = new Map<string, number>();
  private timer: any = null;
  private worldLeaseContext: {
    worldId: string;
    ownerId: string;
    fencingToken: number;
  } | null = null;

  constructor(
    file = process.env.ASHENFALL_SQLITE_FILE ||
      path.resolve(process.cwd(), "data", "ashenfall.sqlite"),
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true });

    const require = createRequire(import.meta.url);
    let sqlite: SqliteModule;
    try {
      sqlite = require("node:sqlite") as SqliteModule;
    } catch (error) {
      throw new Error(
        `Ashenfall requires Node.js 22.5+ for built-in SQLite persistence. ${String(error)}`,
      );
    }

    this.db = new sqlite.DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players(updated_at);
      CREATE TABLE IF NOT EXISTS economy_state (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS world_state (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS repository_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS character_names (
        name_key TEXT PRIMARY KEY,
        player_id TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS reward_ledger (
        reward_key TEXT PRIMARY KEY, player_id TEXT NOT NULL, claimed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reward_ledger_player ON reward_ledger(player_id);
      CREATE TABLE IF NOT EXISTS world_leases (world_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, fencing_token INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS durable_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL, locked_by TEXT, locked_until INTEGER, last_error TEXT, created_at INTEGER NOT NULL, completed_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON durable_outbox(status, available_at, created_at);
    `);
    this.migrateSchema();
    this.ensurePlayerRevisionColumn();
    this.load();
    this.rebuildCharacterNameIndex();
  }

  private migrateSchema() {
    const row = this.db
      .prepare("SELECT value FROM repository_meta WHERE key = ?")
      .get("schema_version");
    const current = row ? Number(row.value) || 1 : 1;
    if (current > SCHEMA_VERSION) {
      throw new Error(
        `Ashenfall persistence schema ${current} is newer than supported ${SCHEMA_VERSION}.`,
      );
    }
    if (current < SCHEMA_VERSION) {
      this.db
        .prepare(
          `INSERT INTO repository_meta(key,value) VALUES(?,?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        )
        .run("schema_version", String(SCHEMA_VERSION));
    } else if (!row) {
      this.db
        .prepare("INSERT INTO repository_meta(key,value) VALUES(?,?)")
        .run("schema_version", String(SCHEMA_VERSION));
    }
  }

  private ensurePlayerRevisionColumn() {
    const columns = this.db.prepare("PRAGMA table_info(players)").all();
    if (!columns.some((column: any) => String(column.name) === "revision")) {
      this.db.exec(
        "ALTER TABLE players ADD COLUMN revision INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  private parseJson(raw: any, label: string) {
    const text = String(raw ?? "");
    if (
      Buffer.byteLength(text) >
      (label === "player" ? MAX_PLAYER_BYTES : MAX_ECONOMY_BYTES)
    ) {
      throw new Error(`${label} payload exceeds persistence size limit.`);
    }
    return JSON.parse(text);
  }

  private load() {
    const rows = this.db
      .prepare("SELECT id, data, revision FROM players ORDER BY updated_at ASC")
      .all();
    for (const row of rows) {
      try {
        const p = this.parseJson(row.data, "player");
        if (p?.id) {
          p.online = false;
          this.players.set(String(row.id), p);
          this.playerRevisions.set(String(row.id), Number(row.revision || 0));
        }
      } catch (error) {
        console.warn(`Skipping corrupt player row ${String(row.id)}:`, error);
      }
    }

    if (this.players.size === 0) this.importLegacyJson();
  }

  private importLegacyJson() {
    const legacy = path.resolve(process.cwd(), "data", "players.json");
    if (!fs.existsSync(legacy)) return;
    try {
      const raw = fs.readFileSync(legacy, "utf8");
      const parsed = this.parseJson(raw, "player");
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      for (const p of parsed) {
        if (p?.id) this.players.set(String(p.id), { ...p, online: false });
      }
      for (const p of this.players.values()) this.pending.add(p.id);
      this.flush();
      fs.renameSync(legacy, `${legacy}.migrated`);
      console.log(`Imported ${this.players.size} character(s) into SQLite.`);
    } catch (error) {
      console.warn("Legacy JSON player migration failed:", error);
    }
  }

  private rebuildCharacterNameIndex() {
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO character_names(name_key, player_id) VALUES(?, ?)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const p of this.players.values()) {
        if (p?.hasCharacter && p?.id && p?.name)
          insert.run(
            String(p.name).trim().replace(/\s+/g, " ").toLowerCase(),
            String(p.id),
          );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  reserveCharacterName(nameKey: string, playerId: string) {
    const key = String(nameKey || "").trim();
    if (!key) throw new Error("Character name cannot be empty.");
    try {
      this.db
        .prepare(
          "INSERT INTO character_names(name_key, player_id) VALUES(?, ?)",
        )
        .run(key, String(playerId));
    } catch (error) {
      const existing = this.db
        .prepare("SELECT player_id FROM character_names WHERE name_key=?")
        .get(key);
      if (existing && String(existing.player_id) !== String(playerId))
        throw new Error("That character name is already taken.");
      throw error;
    }
  }

  releaseCharacterName(nameKey: string, playerId?: string) {
    if (playerId)
      this.db
        .prepare("DELETE FROM character_names WHERE name_key=? AND player_id=?")
        .run(String(nameKey), String(playerId));
    else
      this.db
        .prepare("DELETE FROM character_names WHERE name_key=?")
        .run(String(nameKey));
  }

  savePlayer(p: PlayerRecord) {
    if (!p?.id) throw new Error("Cannot persist a player without an id.");
    const id = String(p.id);
    this.players.set(id, p);
    if (this.conflictedPlayers.has(id)) return;
    if (this.oversizedPlayers.has(id)) {
      const payload = JSON.stringify({ ...p, online: false });
      if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES) return;
      this.oversizedPlayers.delete(id);
      this.warnedOversizedPlayers.delete(id);
    }
    this.pending.add(id);
    this.scheduleFlush();
  }

  setWorldLeaseContext(worldId: string, ownerId: string, fencingToken: number) {
    this.worldLeaseContext = { worldId, ownerId, fencingToken };
  }
  private assertWorldLease() {
    const c = this.worldLeaseContext;
    if (!c) return;
    const row = this.db
      .prepare(
        "SELECT owner_id AS ownerId,fencing_token AS fencingToken,expires_at AS expiresAt FROM world_leases WHERE world_id=?",
      )
      .get(c.worldId);
    if (
      !row ||
      String(row.ownerId) !== c.ownerId ||
      Number(row.fencingToken) !== c.fencingToken ||
      Number(row.expiresAt) <= Date.now()
    )
      throw new Error(
        "Authoritative world lease is no longer valid; refusing persistence write.",
      );
  }
  private writePlayerCas(
    player: PlayerRecord,
    payload: string,
    now = Date.now(),
  ) {
    this.assertWorldLease();
    const id = String(player.id);
    const knownRevision = this.playerRevisions.get(id);
    if (knownRevision !== undefined) {
      const result = this.db
        .prepare(
          "UPDATE players SET data=?, updated_at=?, revision=revision+1 WHERE id=? AND revision=?",
        )
        .run(payload, now, id, knownRevision);
      if (Number(result.changes || 0) !== 1)
        throw new Error(
          `Player ${id} was changed by another server process. Reload the character before saving.`,
        );
    } else {
      try {
        this.db
          .prepare(
            "INSERT INTO players(id,data,updated_at,revision) VALUES(?,?,?,1)",
          )
          .run(id, payload, now);
      } catch (error) {
        const existing = this.db
          .prepare("SELECT revision FROM players WHERE id=?")
          .get(id);
        if (existing)
          throw new Error(
            `Player ${id} was created by another server process. Reload the character before saving.`,
          );
        throw error;
      }
    }
  }

  savePlayerNow(p: PlayerRecord) {
    const id = String(p?.id || "");
    this.savePlayer(p);
    if (this.conflictedPlayers.has(id))
      throw new Error(
        `Player ${id} has a stale persistence revision and must be reloaded before saving.`,
      );
    this.flush();
    if (this.conflictedPlayers.has(id))
      throw new Error(
        `Player ${id} has a stale persistence revision and must be reloaded before saving.`,
      );
    if (this.oversizedPlayers.has(id))
      throw new Error(`Player ${id} exceeds persistence size limit.`);
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
    const payload = JSON.stringify({ ...player, online: false });
    if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES)
      throw new Error(`Player ${player.id} exceeds persistence size limit.`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const claim = this.db
        .prepare(
          "INSERT INTO reward_ledger(reward_key,player_id,claimed_at) VALUES(?,?,?) ON CONFLICT(reward_key) DO NOTHING",
        )
        .run(key, String(player.id), Date.now());
      if (Number(claim.changes || 0) !== 1) {
        const owner = this.db
          .prepare("SELECT player_id FROM reward_ledger WHERE reward_key=?")
          .get(key);
        this.db.exec("ROLLBACK");
        if (owner && String(owner.player_id) !== String(player.id))
          throw new Error(
            "Reward idempotency key is already owned by another player.",
          );
        return false;
      }
      this.writePlayerCas(player, payload);
      const event = outboxEvent || {
        id: `reward:${key}`,
        type: "reward.player_committed",
        aggregateId: String(player.id),
        payload: {
          playerId: String(player.id),
          rewardKey: key,
          zone: String(player.zone || ""),
        },
      };
      this.db
        .prepare(
          "INSERT INTO durable_outbox(id,event_type,aggregate_id,payload,status,attempts,available_at,created_at) VALUES(?,?,?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING",
        )
        .run(
          event.id,
          event.type,
          event.aggregateId,
          JSON.stringify(event.payload),
          Date.now(),
          Date.now(),
        );
      this.db.exec("COMMIT");
      this.playerRevisions.set(
        String(player.id),
        Number(this.playerRevisions.get(String(player.id)) || 0) + 1,
      );
      this.players.set(String(player.id), player);
      this.pending.delete(String(player.id));
      return true;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
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
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < unique.length; i++) {
        const p = unique[i],
          key = String(rewardKeys[i] || "").trim();
        if (!key || key.length > 512)
          throw new Error("Reward idempotency key must be 1–512 characters.");
        const claim = this.db
          .prepare(
            "INSERT INTO reward_ledger(reward_key,player_id,claimed_at) VALUES(?,?,?) ON CONFLICT(reward_key) DO NOTHING",
          )
          .run(key, String(p.id), now);
        if (Number(claim.changes || 0) !== 1) {
          const owner = this.db
            .prepare("SELECT player_id FROM reward_ledger WHERE reward_key=?")
            .get(key);
          this.db.exec("ROLLBACK");
          if (owner && String(owner.player_id) !== String(p.id))
            throw new Error(
              "Reward idempotency key is already owned by another player.",
            );
          return false;
        }
      }
      for (const p of unique) {
        const payload = JSON.stringify({ ...p, online: false });
        if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES)
          throw new Error(`Player ${p.id} exceeds persistence size limit.`);
        this.writePlayerCas(p, payload, now);
      }
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
      for (const event of events)
        this.db
          .prepare(
            "INSERT INTO durable_outbox(id,event_type,aggregate_id,payload,status,attempts,available_at,created_at) VALUES(?,?,?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .run(
            event.id,
            event.type,
            event.aggregateId,
            JSON.stringify(event.payload),
            now,
            now,
          );
      this.db.exec("COMMIT");
      for (const p of unique)
        this.playerRevisions.set(
          String(p.id),
          Number(this.playerRevisions.get(String(p.id)) || 0) + 1,
        );
      for (const p of unique) {
        this.players.set(String(p.id), p);
        this.pending.delete(String(p.id));
      }
      return true;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  savePlayersAtomically(players: PlayerRecord[]) {
    const unique = [
      ...new Map(
        players.filter((p) => p?.id).map((p) => [String(p.id), p]),
      ).values(),
    ];
    if (!unique.length) return;
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const p of unique) {
        const payload = JSON.stringify({ ...p, online: false });
        if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES)
          throw new Error(`Player ${p.id} exceeds persistence size limit.`);
        this.writePlayerCas(p, payload, now);
      }
      this.db.exec("COMMIT");
      for (const p of unique)
        this.playerRevisions.set(
          String(p.id),
          Number(this.playerRevisions.get(String(p.id)) || 0) + 1,
        );
      for (const p of unique) {
        this.players.set(String(p.id), p);
        this.pending.delete(String(p.id));
      }
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  savePlayersAndEconomyAtomically(
    players: PlayerRecord[],
    economy: any,
    id = "global",
  ) {
    const unique = [
      ...new Map(
        players.filter((p) => p?.id).map((p) => [String(p.id), p]),
      ).values(),
    ];
    const economyStmt = this.db.prepare(`
      INSERT INTO economy_state(id, data, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
    `);
    const now = Date.now();
    const payload = JSON.stringify(economy);
    if (payload.length > MAX_ECONOMY_BYTES)
      throw new Error("Economy state exceeds persistence size limit.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const p of unique) {
        const playerPayload = JSON.stringify({ ...p, online: false });
        if (playerPayload.length > MAX_PLAYER_BYTES)
          throw new Error(`Player ${p.id} exceeds persistence size limit.`);
        this.writePlayerCas(p, playerPayload, now);
      }
      economyStmt.run(String(id), payload, now);
      this.db.exec("COMMIT");
      for (const p of unique)
        this.playerRevisions.set(
          String(p.id),
          Number(this.playerRevisions.get(String(p.id)) || 0) + 1,
        );
      for (const p of unique) {
        this.players.set(String(p.id), p);
        this.pending.delete(String(p.id));
      }
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  checkpoint() {
    this.flush();
  }

  private scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.flush();
      } catch (error) {
        console.warn("SQLite player flush failed:", error);
      }
    }, 500);
    this.timer.unref?.();
  }

  getPlayer(id: string) {
    return this.players.get(String(id));
  }

  allPlayers() {
    return [...this.players.values()];
  }

  loadEconomyState(id = "global") {
    const row = this.db
      .prepare("SELECT data FROM economy_state WHERE id = ?")
      .get(String(id));
    if (!row) return null;
    try {
      return this.parseJson(row.data, "economy");
    } catch {
      return null;
    }
  }

  loadWorldState(id = "global") {
    const row = this.db
      .prepare("SELECT data FROM world_state WHERE id = ?")
      .get(String(id));
    if (!row) return null;
    try {
      return this.parseJson(row.data, "world");
    } catch {
      return null;
    }
  }

  saveWorldState(data: any, id = "global") {
    this.assertWorldLease();
    const stmt = this.db.prepare(`
      INSERT INTO world_state(id, data, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const payload = JSON.stringify(data);
      if (payload.length > MAX_ECONOMY_BYTES)
        throw new Error("World state exceeds persistence size limit.");
      stmt.run(String(id), payload, Date.now());
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  saveWorldStateNow(data: any, id = "global") {
    this.saveWorldState(data, id);
  }

  saveEconomyState(data: any, id = "global") {
    this.assertWorldLease();
    const stmt = this.db.prepare(`
      INSERT INTO economy_state(id, data, updated_at) VALUES(?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const payload = JSON.stringify(data);
      if (payload.length > MAX_ECONOMY_BYTES)
        throw new Error("Economy state exceeds persistence size limit.");
      stmt.run(String(id), payload, Date.now());
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  }

  flush() {
    if (!this.pending.size) return;
    const ids = [...this.pending];
    const rows = ids
      .map((id) => this.players.get(id))
      .filter(Boolean) as PlayerRecord[];
    for (const id of ids) {
      if (!this.players.has(id)) this.pending.delete(id);
    }
    if (!rows.length) return;

    const now = Date.now();
    const failures: unknown[] = [];
    for (const p of rows) {
      const id = String(p.id);
      const payload = JSON.stringify({ ...p, online: false });
      if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES) {
        this.pending.delete(id);
        this.oversizedPlayers.add(id);
        if (!this.warnedOversizedPlayers.has(id)) {
          this.warnedOversizedPlayers.add(id);
          console.error(
            `SQLite player ${id} was not checkpointed: payload exceeds persistence size limit.`,
          );
        }
        continue;
      }
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.writePlayerCas(p, payload, now);
        this.db.exec("COMMIT");
        this.playerRevisions.set(
          id,
          Number(this.playerRevisions.get(id) || 0) + 1,
        );
        this.pending.delete(id);
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {}
        const message = String((error as any)?.message || error);
        if (
          message.includes("changed by another server process") ||
          message.includes("created by another server process")
        ) {
          this.pending.delete(id);
          this.conflictedPlayers.add(id);
          console.error(
            `SQLite player ${id} checkpoint rejected due to a revision conflict.`,
          );
        } else {
          failures.push(error);
        }
      }
    }
    if (this.pending.size) this.scheduleFlush();
    if (failures.length) throw failures[0];
  }

  flushNow() {
    this.flush();
  }

  integrityCheck() {
    const result = this.db.prepare("PRAGMA integrity_check").get();
    return String(result?.integrity_check || "") === "ok";
  }

  authInit() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,verification_hash TEXT,verification_expires_at INTEGER,reset_hash TEXT,reset_expires_at INTEGER,created_at INTEGER NOT NULL,session_version INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS auth_sessions (token_hash TEXT PRIMARY KEY,account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,guest_id TEXT UNIQUE,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id);
    `);
    this.authInitMigrations();
  }
  authInitMigrations() {
    try {
      this.db.exec("ALTER TABLE accounts ADD COLUMN reset_hash TEXT");
    } catch {}
    try {
      this.db.exec("ALTER TABLE accounts ADD COLUMN reset_expires_at INTEGER");
    } catch {}
    try {
      this.db.exec(
        "ALTER TABLE accounts ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1",
      );
    } catch {}
  }
  authGetAccountByEmail(email: string) {
    const r = this.db
      .prepare(
        "SELECT id,email,password_hash AS passwordHash,verified,verification_hash AS verificationHash,verification_expires_at AS verificationExpiresAt,reset_hash AS resetHash,reset_expires_at AS resetExpiresAt,created_at AS createdAt,session_version AS sessionVersion FROM accounts WHERE email=?",
      )
      .get(
        String(email || "")
          .trim()
          .toLowerCase(),
      );
    return r ? { ...r, verified: Boolean(r.verified) } : null;
  }
  authGetAccountById(id: string) {
    const r = this.db
      .prepare(
        "SELECT id,email,verified,created_at AS createdAt,session_version AS sessionVersion FROM accounts WHERE id=?",
      )
      .get(id);
    return r ? { ...r, verified: Boolean(r.verified) } : null;
  }
  authCreateAccount(a: any, vh: string, ve: number) {
    this.db
      .prepare(
        "INSERT INTO accounts(id,email,password_hash,verified,verification_hash,verification_expires_at,created_at,session_version) VALUES(?,?,?,?,?,?,?,1)",
      )
      .run(a.id, a.email, a.passwordHash, 0, vh, ve, a.createdAt);
  }
  authDeleteAccount(id: string) {
    this.db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  }
  authVerifyAccount(id: string) {
    this.db
      .prepare(
        "UPDATE accounts SET verified=1,verification_hash=NULL,verification_expires_at=NULL WHERE id=?",
      )
      .run(id);
  }
  authSetVerification(id: string, vh: string, ve: number) {
    this.db
      .prepare(
        "UPDATE accounts SET verification_hash=?,verification_expires_at=? WHERE id=?",
      )
      .run(vh, ve, id);
  }
  authCreateSession(
    tokenHash: string,
    accountId: string | null,
    guestId: string | null,
    expiresAt: number,
  ) {
    this.db
      .prepare(
        "INSERT INTO auth_sessions(token_hash,account_id,guest_id,expires_at,created_at) VALUES(?,?,?,?,?)",
      )
      .run(tokenHash, accountId, guestId, expiresAt, Date.now());
  }
  authReplaceAccountSession(
    tokenHash: string,
    accountId: string,
    expiresAt: number,
    bumpSessionVersion = true,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM auth_sessions WHERE account_id=?")
        .run(accountId);
      this.db
        .prepare(
          "INSERT INTO auth_sessions(token_hash,account_id,guest_id,expires_at,created_at) VALUES(?,?,NULL,?,?)",
        )
        .run(tokenHash, accountId, expiresAt, Date.now());
      if (bumpSessionVersion)
        this.db
          .prepare(
            "UPDATE accounts SET session_version=COALESCE(session_version,1)+1 WHERE id=?",
          )
          .run(accountId);
      const r = this.db
        .prepare("SELECT session_version AS v FROM accounts WHERE id=?")
        .get(accountId);
      if (!r) throw new Error("Account is unavailable.");
      this.db.exec("COMMIT");
      return Number(r.v || 1);
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  acquireWorldLease(
    worldId: string,
    ownerId: string,
    now: number,
    leaseMs: number,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare(
          "SELECT owner_id AS ownerId,fencing_token AS fencingToken,expires_at AS expiresAt FROM world_leases WHERE world_id=?",
        )
        .get(worldId);
      if (
        old &&
        Number(old.expiresAt) > now &&
        String(old.ownerId) !== ownerId
      ) {
        this.db.exec("COMMIT");
        return {
          acquired: false,
          fencingToken: Number(old.fencingToken),
          expiresAt: Number(old.expiresAt),
        };
      }
      const token = old
        ? Number(old.expiresAt) > now && String(old.ownerId) === ownerId
          ? Number(old.fencingToken)
          : Number(old.fencingToken) + 1
        : 1;
      const expiresAt = now + leaseMs;
      this.db
        .prepare(
          "INSERT INTO world_leases(world_id,owner_id,fencing_token,expires_at) VALUES(?,?,?,?) ON CONFLICT(world_id) DO UPDATE SET owner_id=excluded.owner_id,fencing_token=excluded.fencing_token,expires_at=excluded.expires_at",
        )
        .run(worldId, ownerId, token, expiresAt);
      this.db.exec("COMMIT");
      return { acquired: true, fencingToken: token, expiresAt };
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  renewWorldLease(
    worldId: string,
    ownerId: string,
    fencingToken: number,
    now: number,
    leaseMs: number,
  ) {
    const r = this.db
      .prepare(
        "UPDATE world_leases SET expires_at=? WHERE world_id=? AND owner_id=? AND fencing_token=? AND expires_at>?",
      )
      .run(now + leaseMs, worldId, ownerId, fencingToken, now);
    return Number(r.changes || 0) === 1;
  }
  releaseWorldLease(worldId: string, ownerId: string, fencingToken: number) {
    this.db
      .prepare(
        "UPDATE world_leases SET expires_at=0 WHERE world_id=? AND owner_id=? AND fencing_token=?",
      )
      .run(worldId, ownerId, fencingToken);
  }
  enqueueOutbox(event: {
    id: string;
    type: string;
    aggregateId: string;
    payload: unknown;
    createdAt?: number;
  }) {
    const now = Number(event.createdAt || Date.now());
    this.db
      .prepare(
        "INSERT INTO durable_outbox(id,event_type,aggregate_id,payload,status,attempts,available_at,created_at) VALUES(?,?,?,?,'pending',0,?,?) ON CONFLICT(id) DO NOTHING",
      )
      .run(
        event.id,
        event.type,
        event.aggregateId,
        JSON.stringify(event.payload),
        now,
        now,
      );
  }
  claimOutbox(consumer: string, limit = 50, now = Date.now()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = this.db
        .prepare(
          "SELECT id,event_type AS type,aggregate_id AS aggregateId,payload,attempts FROM durable_outbox WHERE (status='pending' AND available_at<=?) OR (status='processing' AND locked_until<=?) ORDER BY created_at LIMIT ?",
        )
        .all(now, now, Math.max(1, Math.min(500, limit)));
      const upd = this.db.prepare(
        "UPDATE durable_outbox SET status='processing',locked_by=?,locked_until=?,attempts=attempts+1 WHERE id=?",
      );
      for (const r of rows) upd.run(consumer, now + 30000, r.id);
      this.db.exec("COMMIT");
      return rows.map((r: any) => ({
        ...r,
        payload: JSON.parse(r.payload),
        attempts: Number(r.attempts || 0) + 1,
      }));
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  completeOutbox(eventId: string, consumer: string, now = Date.now()) {
    this.db
      .prepare(
        "UPDATE durable_outbox SET status='completed',completed_at=?,locked_by=NULL,locked_until=NULL,last_error=NULL WHERE id=? AND status='processing' AND locked_by=?",
      )
      .run(now, eventId, consumer);
  }
  failOutbox(
    eventId: string,
    consumer: string,
    error: string,
    now = Date.now(),
  ) {
    this.db
      .prepare(
        "UPDATE durable_outbox SET status='pending',available_at=?+MIN(300000,1000*(1<<MIN(attempts,8))),locked_by=NULL,locked_until=NULL,last_error=? WHERE id=? AND status='processing' AND locked_by=?",
      )
      .run(now, String(error).slice(0, 2000), eventId, consumer);
  }
  authGetSessionByHash(tokenHash: string) {
    const r = this.db
      .prepare(
        "SELECT s.token_hash AS tokenHash,s.account_id AS accountId,s.guest_id AS guestId,s.expires_at AS expiresAt,a.email FROM auth_sessions s LEFT JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=?",
      )
      .get(tokenHash);
    return r || null;
  }
  authDeleteSession(tokenHash: string) {
    this.db
      .prepare("DELETE FROM auth_sessions WHERE token_hash=?")
      .run(tokenHash);
  }
  authCleanup() {
    this.db
      .prepare("DELETE FROM auth_sessions WHERE expires_at <= ?")
      .run(Date.now());
  }
  authSetPasswordReset(id: string, rh: string, re: number) {
    this.db
      .prepare("UPDATE accounts SET reset_hash=?,reset_expires_at=? WHERE id=?")
      .run(rh, re, id);
  }
  authResetPassword(id: string, passwordHash: string) {
    this.db
      .prepare(
        "UPDATE accounts SET password_hash=?,reset_hash=NULL,reset_expires_at=NULL WHERE id=?",
      )
      .run(passwordHash, id);
  }
  authListAccountSessions(accountId: string) {
    return this.db
      .prepare(
        "SELECT created_at AS createdAt,expires_at AS expiresAt FROM auth_sessions WHERE account_id=? ORDER BY created_at DESC",
      )
      .all(accountId);
  }
  authDeleteAllSessions(accountId: string) {
    this.db
      .prepare("DELETE FROM auth_sessions WHERE account_id=?")
      .run(accountId);
  }
  authBumpSessionVersion(accountId: string) {
    this.db
      .prepare(
        "UPDATE accounts SET session_version=COALESCE(session_version,1)+1 WHERE id=?",
      )
      .run(accountId);
  }

  stats() {
    const players = this.db
      .prepare("SELECT COUNT(*) AS count FROM players")
      .get();
    const economy = this.db
      .prepare("SELECT COUNT(*) AS count FROM economy_state")
      .get();
    const meta = this.db
      .prepare("SELECT value FROM repository_meta WHERE key = ?")
      .get("schema_version");
    return {
      schemaVersion: Number(meta?.value || 1),
      players: Number(players?.count || 0),
      economyRows: Number(economy?.count || 0),
    };
  }

  close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
    this.db.close();
  }
}

export { SQLiteRepository };
