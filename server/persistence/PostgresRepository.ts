import { createRequire } from "node:module";

type PlayerRecord = Record<string, any>;
const MAX_PLAYER_BYTES = 2_000_000;
const MAX_ECONOMY_BYTES = 8_000_000;
const SCHEMA_VERSION = 3;

class PostgresRepository {
  players = new Map<string, PlayerRecord>();
  private pool: any;
  private pendingPlayers = new Map<string, PlayerRecord>();
  private playerVersions = new Map<string, number>();
  private persistedPlayerVersions = new Map<string, number>();
  private failedPlayerWrites = new Map<
    string,
    { version: number; error: string }
  >();
  private oversizedPlayers = new Set<string>();
  private conflictedPlayers = new Set<string>();
  private warnedOversizedPlayers = new Set<string>();
  private playerRevisions = new Map<string, number>();
  private pendingEconomy = new Map<string, any>();
  private pendingWorldState = new Map<string, any>();
  private dbBytes = { players: 0, economy: 0, world: 0 };
  /** Bytes written to PostgreSQL since the last call (for ops logging). */
  takeWriteStats() {
    const r = { ...this.dbBytes };
    this.dbBytes = { players: 0, economy: 0, world: 0 };
    return r;
  }
  private flushPromise: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readyPromise: Promise<void>;
  private closed = false;
  private worldLeaseContext: {
    worldId: string;
    ownerId: string;
    fencingToken: number;
  } | null = null;

  constructor(connectionString = process.env.DATABASE_URL || "") {
    if (!connectionString)
      throw new Error("PostgreSQL repository requires DATABASE_URL.");
    const require = createRequire(import.meta.url);
    let Pg: any;
    try {
      Pg = require("pg");
    } catch (error) {
      throw new Error(
        `PostgreSQL repository requires the "pg" package. ${String(error)}`,
      );
    }
    const Pool = Pg.Pool || Pg.default?.Pool;
    if (!Pool) throw new Error("Installed pg package does not expose Pool.");
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.ASHENFALL_PG_POOL_SIZE || 10),
      idleTimeoutMillis: 30_000,
    });
    this.readyPromise = this.initialize();
  }

  async ready() {
    await this.readyPromise;
    return this;
  }

  private async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        CREATE TABLE IF NOT EXISTS repository_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS players (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at BIGINT NOT NULL,
          revision BIGINT NOT NULL DEFAULT 0
        );
        ALTER TABLE players ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_players_updated_at ON players(updated_at);
        CREATE TABLE IF NOT EXISTS economy_state (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS world_state (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          updated_at BIGINT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS character_names (
          name_key TEXT PRIMARY KEY,
          player_id TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS reward_ledger (
          reward_key TEXT PRIMARY KEY, player_id TEXT NOT NULL, claimed_at BIGINT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_reward_ledger_player ON reward_ledger(player_id);
        CREATE TABLE IF NOT EXISTS world_leases (world_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, fencing_token BIGINT NOT NULL, expires_at BIGINT NOT NULL);
        CREATE TABLE IF NOT EXISTS durable_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, available_at BIGINT NOT NULL, locked_by TEXT, locked_until BIGINT, last_error TEXT, created_at BIGINT NOT NULL, completed_at BIGINT);
        CREATE INDEX IF NOT EXISTS idx_outbox_pending ON durable_outbox(status, available_at, created_at);
      `);
      const version = await client.query(
        "SELECT value FROM repository_meta WHERE key=$1",
        ["schema_version"],
      );
      const current = version.rows[0] ? Number(version.rows[0].value) || 1 : 0;
      if (current > SCHEMA_VERSION)
        throw new Error(
          `PostgreSQL persistence schema ${current} is newer than supported ${SCHEMA_VERSION}.`,
        );
      await client.query(
        `INSERT INTO repository_meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        ["schema_version", String(SCHEMA_VERSION)],
      );
      await client.query("COMMIT");

      const rows = await client.query(
        "SELECT id,data,revision FROM players ORDER BY updated_at ASC",
      );
      const nameRows = await client.query(
        "SELECT name_key, player_id FROM character_names",
      );
      if (rows.rows.length > 0) {
        const indexedPlayerIds = new Set(
          nameRows.rows.map((r: any) => String(r.player_id)),
        );
        for (const row of rows.rows) {
          try {
            if (indexedPlayerIds.has(String(row.id))) continue;
            const p = JSON.parse(String(row.data));
            if (p?.hasCharacter && p?.id && p?.name) {
              const key = String(p.name)
                .trim()
                .replace(/\s+/g, " ")
                .toLowerCase();
              await client.query(
                "INSERT INTO character_names(name_key, player_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
                [key, String(p.id)],
              );
            }
          } catch {}
        }
      }
      for (const row of rows.rows) {
        try {
          if (String(row.data).length > MAX_PLAYER_BYTES)
            throw new Error("player payload exceeds persistence size limit");
          const p = JSON.parse(String(row.data));
          if (p?.id) {
            p.online = false;
            this.players.set(String(row.id), p);
            this.playerRevisions.set(String(row.id), Number(row.revision || 0));
          }
        } catch (error) {
          console.warn(
            `Skipping corrupt PostgreSQL player row ${String(row.id)}:`,
            error,
          );
        }
      }
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async reserveCharacterName(nameKey: string, playerId: string) {
    await this.readyPromise;
    try {
      await this.pool.query(
        "INSERT INTO character_names(name_key, player_id) VALUES($1,$2)",
        [String(nameKey), String(playerId)],
      );
    } catch (error) {
      const existing = await this.pool.query(
        "SELECT player_id FROM character_names WHERE name_key=$1",
        [String(nameKey)],
      );
      if (
        existing.rows[0] &&
        String(existing.rows[0].player_id) !== String(playerId)
      )
        throw new Error("That character name is already taken.");
      throw error;
    }
  }

  async releaseCharacterName(nameKey: string, playerId?: string) {
    await this.readyPromise;
    if (playerId)
      await this.pool.query(
        "DELETE FROM character_names WHERE name_key=$1 AND player_id=$2",
        [String(nameKey), String(playerId)],
      );
    else
      await this.pool.query("DELETE FROM character_names WHERE name_key=$1", [
        String(nameKey),
      ]);
  }

  getPlayer(id: string) {
    return this.players.get(String(id));
  }
  allPlayers() {
    return [...this.players.values()];
  }

  setWorldLeaseContext(worldId: string, ownerId: string, fencingToken: number) {
    this.worldLeaseContext = { worldId, ownerId, fencingToken };
  }
  private async assertWorldLease(client: any) {
    const c = this.worldLeaseContext;
    if (!c) return;
    const r = await client.query(
      'SELECT owner_id AS "ownerId",fencing_token AS "fencingToken",expires_at AS "expiresAt" FROM world_leases WHERE world_id=$1 FOR SHARE',
      [c.worldId],
    );
    const lease = r.rows[0];
    if (
      !lease ||
      String(lease.ownerId) !== c.ownerId ||
      Number(lease.fencingToken) !== c.fencingToken ||
      Number(lease.expiresAt) <= Date.now()
    )
      throw new Error(
        "Authoritative world lease is no longer valid; refusing persistence write.",
      );
  }
  private async writePlayerCas(
    client: any,
    id: string,
    payload: string,
    now: number,
  ) {
    await this.assertWorldLease(client);
    const knownRevision = this.playerRevisions.get(id);
    if (knownRevision !== undefined) {
      const update = await client.query(
        "UPDATE players SET data=$1,updated_at=$2,revision=revision+1 WHERE id=$3 AND revision=$4",
        [payload, now, id, knownRevision],
      );
      if (update.rowCount === 1) return;
      throw new Error(
        `Player ${id} was changed by another server process. Reload the character before saving.`,
      );
    }
    try {
      await client.query(
        "INSERT INTO players(id,data,updated_at,revision) VALUES($1,$2,$3,1)",
        [id, payload, now],
      );
    } catch (error) {
      const current = await client.query(
        "SELECT revision FROM players WHERE id=$1",
        [id],
      );
      if (current.rows[0])
        throw new Error(
          `Player ${id} was created by another server process. Reload the character before saving.`,
        );
      throw error;
    }
  }

  private markPlayerRevisions(ids: string[]) {
    for (const id of ids)
      this.playerRevisions.set(
        id,
        Number(this.playerRevisions.get(id) || 0) + 1,
      );
  }

  savePlayer(p: PlayerRecord) {
    if (!p?.id) throw new Error("Cannot persist a player without an id.");
    const id = String(p.id);
    this.players.set(id, p);
    const version = Number(this.playerVersions.get(id) || 0) + 1;
    this.playerVersions.set(id, version);
    if (this.conflictedPlayers.has(id)) {
      this.failedPlayerWrites.set(id, {
        version,
        error: `Player ${id} has a stale persistence revision and must be reloaded before saving.`,
      });
      return version;
    }
    if (this.oversizedPlayers.has(id)) {
      const payload = JSON.stringify({ ...p, online: false });
      if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES) {
        this.failedPlayerWrites.set(id, {
          version,
          error: `Player ${id} exceeds persistence size limit.`,
        });
        return version;
      }
      this.oversizedPlayers.delete(id);
      this.warnedOversizedPlayers.delete(id);
    }
    this.failedPlayerWrites.delete(id);
    this.pendingPlayers.set(id, p);
    this.scheduleFlush();
    return version;
  }

  async savePlayerNow(p: PlayerRecord) {
    const requiredVersion = this.savePlayer(p);
    const id = String(p.id);
    while (
      Number(this.persistedPlayerVersions.get(id) || 0) < requiredVersion
    ) {
      const failed = this.failedPlayerWrites.get(id);
      if (failed && failed.version >= requiredVersion)
        throw new Error(failed.error);
      await this.flush();
    }
  }

  savePlayerRewardOnce(
    player: PlayerRecord,
    rewardKey: string,
  ): Promise<boolean>;
  async savePlayerRewardOnce(
    player: PlayerRecord,
    rewardKey: string,
    outboxEvent?: {
      id: string;
      type: string;
      aggregateId: string;
      payload: unknown;
    },
  ) {
    if (!player?.id)
      throw new Error("Cannot persist a reward for a player without an id.");
    const key = String(rewardKey || "").trim();
    if (!key || key.length > 512)
      throw new Error("Reward idempotency key must be 1–512 characters.");
    const id = String(player.id);
    const payload = JSON.stringify({ ...player, online: false });
    if (Buffer.byteLength(payload) > MAX_PLAYER_BYTES)
      throw new Error(`Player ${id} exceeds persistence size limit.`);
    await this.readyPromise;
    return this.enqueueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const claim = await client.query(
          "INSERT INTO reward_ledger(reward_key,player_id,claimed_at) VALUES($1,$2,$3) ON CONFLICT(reward_key) DO NOTHING RETURNING reward_key",
          [key, id, Date.now()],
        );
        if (!claim.rowCount) {
          const owner = await client.query(
            "SELECT player_id FROM reward_ledger WHERE reward_key=$1",
            [key],
          );
          await client.query("ROLLBACK");
          if (owner.rows[0] && String(owner.rows[0].player_id) !== id)
            throw new Error(
              "Reward idempotency key is already owned by another player.",
            );
          return false;
        }
        await this.writePlayerCas(client, id, payload, Date.now());
        const event = outboxEvent || {
          id: `reward:${key}`,
          type: "reward.player_committed",
          aggregateId: id,
          payload: {
            playerId: id,
            rewardKey: key,
            zone: String(player.zone || ""),
          },
        };
        await client.query(
          "INSERT INTO durable_outbox(id,event_type,aggregate_id,payload,status,attempts,available_at,created_at) VALUES($1,$2,$3,$4,'pending',0,$5,$5) ON CONFLICT(id) DO NOTHING",
          [
            event.id,
            event.type,
            event.aggregateId,
            JSON.stringify(event.payload),
            Date.now(),
          ],
        );
        await client.query("COMMIT");
        this.markPlayerRevisions([id]);
        this.players.set(id, player);
        const version = Number(this.playerVersions.get(id) || 0) + 1;
        this.playerVersions.set(id, version);
        this.persistedPlayerVersions.set(id, version);
        this.pendingPlayers.delete(id);
        return true;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    });
  }

  savePlayersWithRewardsOnce(
    players: PlayerRecord[],
    rewardKeys: string[],
  ): Promise<boolean>;
  async savePlayersWithRewardsOnce(
    players: PlayerRecord[],
    rewardKeys: string[],
    outboxEvents?: Array<{
      id: string;
      type: string;
      aggregateId: string;
      payload: unknown;
    }>,
  ) {
    return this.enqueueWrite(async () => {
      const supplied = (players || []).filter((p) => p?.id);
      const unique = [
        ...new Map(supplied.map((p) => [String(p.id), p])).values(),
      ];
      if (!unique.length) return true;
      if (unique.length !== supplied.length)
        throw new Error("A group reward cannot contain duplicate player IDs.");
      if (unique.length !== rewardKeys.length)
        throw new Error("Each player must have exactly one reward key.");
      const payloads = unique.map((p) => ({
        p,
        id: String(p.id),
        payload: JSON.stringify({ ...p, online: false }),
      }));
      for (const x of payloads)
        if (Buffer.byteLength(x.payload) > MAX_PLAYER_BYTES)
          throw new Error(`Player ${x.id} exceeds persistence size limit.`);
      await this.readyPromise;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < unique.length; i++) {
          const key = String(rewardKeys[i] || "").trim();
          if (!key || key.length > 512)
            throw new Error("Reward idempotency key must be 1–512 characters.");
          const claim = await client.query(
            "INSERT INTO reward_ledger(reward_key,player_id,claimed_at) VALUES($1,$2,$3) ON CONFLICT(reward_key) DO NOTHING RETURNING reward_key",
            [key, String(unique[i].id), Date.now()],
          );
          if (!claim.rowCount) {
            const owner = await client.query(
              "SELECT player_id FROM reward_ledger WHERE reward_key=$1",
              [key],
            );
            await client.query("ROLLBACK");
            if (
              owner.rows[0] &&
              String(owner.rows[0].player_id) !== String(unique[i].id)
            )
              throw new Error(
                "Reward idempotency key is already owned by another player.",
              );
            return false;
          }
        }
        const now = Date.now();
        for (const x of payloads)
          await this.writePlayerCas(client, x.id, x.payload, now);
        const events =
          outboxEvents ||
          payloads.map((x, i) => ({
            id: `reward:${String(rewardKeys[i])}`,
            type: "reward.player_committed",
            aggregateId: x.id,
            payload: {
              playerId: x.id,
              rewardKey: String(rewardKeys[i]),
              zone: String(x.p.zone || ""),
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
          await client.query(
            "INSERT INTO durable_outbox(id,event_type,aggregate_id,payload,status,attempts,available_at,created_at) VALUES($1,$2,$3,$4,'pending',0,$5,$5) ON CONFLICT(id) DO NOTHING",
            [
              event.id,
              event.type,
              event.aggregateId,
              JSON.stringify(event.payload),
              now,
            ],
          );
        await client.query("COMMIT");
        this.markPlayerRevisions(payloads.map((x) => x.id));
        for (const x of payloads) {
          this.players.set(x.id, x.p);
          const version = Number(this.playerVersions.get(x.id) || 0) + 1;
          this.playerVersions.set(x.id, version);
          this.persistedPlayerVersions.set(x.id, version);
          this.pendingPlayers.delete(x.id);
        }
        return true;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async savePlayersAtomically(players: PlayerRecord[]) {
    return this.enqueueWrite(async () => {
      const unique = [
        ...new Map(
          players.filter((p) => p?.id).map((p) => [String(p.id), p]),
        ).values(),
      ];
      if (!unique.length) return;
      const snapshots = unique.map((p) => ({
        p,
        id: String(p.id),
        version: Number(this.playerVersions.get(String(p.id)) || 0),
        payload: JSON.stringify({ ...p, online: false }),
      }));
      for (const x of snapshots)
        if (Buffer.byteLength(x.payload) > MAX_PLAYER_BYTES)
          throw new Error(`Player ${x.id} exceeds persistence size limit.`);
      await this.readyPromise;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.assertWorldLease(client);
        const ids = unique.map((p) => String(p.id)).sort();
        if (ids.length) {
          await client.query(
            "SELECT id FROM players WHERE id = ANY($1::text[]) FOR UPDATE",
            [ids],
          );
        }
        const now = Date.now();
        for (const x of snapshots)
          await this.writePlayerCas(client, x.id, x.payload, now);
        await client.query("COMMIT");
        this.markPlayerRevisions(snapshots.map((x) => x.id));
        for (const x of snapshots) {
          this.persistedPlayerVersions.set(
            x.id,
            Math.max(
              Number(this.persistedPlayerVersions.get(x.id) || 0),
              x.version,
            ),
          );
          if (Number(this.playerVersions.get(x.id) || 0) === x.version)
            this.pendingPlayers.delete(x.id);
        }
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async savePlayersAndEconomyAtomically(
    players: PlayerRecord[],
    economy: any,
    id = "global",
  ) {
    return this.enqueueWrite(async () => {
      const unique = [
        ...new Map(
          players.filter((p) => p?.id).map((p) => [String(p.id), p]),
        ).values(),
      ];
      const snapshots = unique.map((p) => ({
        p,
        id: String(p.id),
        version: Number(this.playerVersions.get(String(p.id)) || 0),
        payload: JSON.stringify({ ...p, online: false }),
      }));
      for (const x of snapshots)
        if (Buffer.byteLength(x.payload) > MAX_PLAYER_BYTES)
          throw new Error(`Player ${x.id} exceeds persistence size limit.`);
      const payload = JSON.stringify(economy);
      if (payload.length > MAX_ECONOMY_BYTES)
        throw new Error("Economy state exceeds persistence size limit.");
      await this.readyPromise;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.assertWorldLease(client);
        const ids = unique.map((p) => String(p.id)).sort();
        if (ids.length)
          await client.query(
            "SELECT id FROM players WHERE id = ANY($1::text[]) FOR UPDATE",
            [ids],
          );
        const now = Date.now();
        const playerStmt = null;
        for (const x of snapshots)
          await this.writePlayerCas(client, x.id, x.payload, now);
        await client.query(
          `INSERT INTO economy_state(id,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,
          [String(id), payload, now],
        );
        await client.query("COMMIT");
        this.markPlayerRevisions(snapshots.map((x) => x.id));
        for (const x of snapshots) {
          this.persistedPlayerVersions.set(
            x.id,
            Math.max(
              Number(this.persistedPlayerVersions.get(x.id) || 0),
              x.version,
            ),
          );
          if (Number(this.playerVersions.get(x.id) || 0) === x.version)
            this.pendingPlayers.delete(x.id);
        }
        (this as any)._economyCache ||= new Map();
        (this as any)._economyCache.set(String(id), economy);
        this.pendingEconomy.delete(String(id));
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    });
  }

  checkpoint() {
    return this.flush();
  }

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(fn, fn);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private scheduleFlush() {
    if (this.flushPromise || this.closed) return;
    setTimeout(() => {
      void this.flush().catch((error: any) =>
        console.warn(
          "PostgreSQL persistence flush failed; pending writes will be retried:",
          error,
        ),
      );
    }, 250).unref?.();
  }

  async flush() {
    await this.readyPromise;
    if (this.closed) return;
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.enqueueWrite(async () => {
      const pendingPlayers = [...this.pendingPlayers.entries()].map(
        ([id, p]) => ({
          id,
          p,
          version: Number(this.playerVersions.get(id) || 0),
          payload: JSON.stringify({ ...p, online: false }),
        }),
      );
      const players: any[] = [];
      for (const x of pendingPlayers) {
        if (Buffer.byteLength(x.payload) > MAX_PLAYER_BYTES) {
          const message = `Player ${x.id} exceeds persistence size limit.`;
          if (Number(this.playerVersions.get(x.id) || 0) === x.version)
            this.pendingPlayers.delete(x.id);
          this.oversizedPlayers.add(x.id);
          this.failedPlayerWrites.set(x.id, {
            version: x.version,
            error: message,
          });
          if (!this.warnedOversizedPlayers.has(x.id)) {
            this.warnedOversizedPlayers.add(x.id);
            console.error(`PostgreSQL persistence rejected ${message}`);
          }
          continue;
        }
        if (this.oversizedPlayers.has(x.id)) {
          this.oversizedPlayers.delete(x.id);
          this.warnedOversizedPlayers.delete(x.id);
        }
        players.push(x);
      }
      const economy = [...this.pendingEconomy.entries()];
      const worldState = [...this.pendingWorldState.entries()];
      if (!players.length && !economy.length && !worldState.length) return;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.assertWorldLease(client);
        const now = Date.now();
        for (const x of players) {
          this.dbBytes.players += x.payload.length;
          await this.writePlayerCas(client, x.id, x.payload, now);
        }
        const economyStmt = `INSERT INTO economy_state(id,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`;
        for (const [id, data] of economy) {
          const payload = JSON.stringify(data);
          if (payload.length > MAX_ECONOMY_BYTES)
            throw new Error("Economy state exceeds persistence size limit.");
          this.dbBytes.economy += payload.length;
          await client.query(economyStmt, [id, payload, now]);
        }
        const worldStmt = `INSERT INTO world_state(id,data,updated_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`;
        for (const [id, data] of worldState) {
          const payload = JSON.stringify(data);
          if (payload.length > MAX_ECONOMY_BYTES)
            throw new Error("World state exceeds persistence size limit.");
          // Skip byte-identical rewrites; log big documents so unexpected database traffic is easy to attribute.
          const lastWritten: Map<string, string> = ((
            this as any
          )._lastWorldPayload ||= new Map());
          if (lastWritten.get(id) === payload) continue;
          if (payload.length > 500_000)
            console.log(
              `[db] world_state ${id} written: ${(payload.length / 1048576).toFixed(1)}MB`,
            );
          this.dbBytes.world += payload.length;
          await client.query(worldStmt, [id, payload, now]);
          lastWritten.set(id, payload);
        }
        await client.query("COMMIT");
        this.markPlayerRevisions(players.map((x) => x.id));
        for (const x of players) {
          this.persistedPlayerVersions.set(
            x.id,
            Math.max(
              Number(this.persistedPlayerVersions.get(x.id) || 0),
              x.version,
            ),
          );
          if (Number(this.playerVersions.get(x.id) || 0) === x.version)
            this.pendingPlayers.delete(x.id);
        }
        for (const [id] of economy) this.pendingEconomy.delete(id);
        for (const [id] of worldState) this.pendingWorldState.delete(id);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        const message = String((error as any)?.message || error);
        const conflict = message.match(
          /Player (.+?) was (?:changed|created) by another server process/,
        );
        if (conflict) {
          const id = String(conflict[1]);
          const x = players.find((entry: any) => entry.id === id);
          if (x && Number(this.playerVersions.get(id) || 0) === x.version) {
            this.pendingPlayers.delete(id);
            this.conflictedPlayers.add(id);
            this.failedPlayerWrites.set(id, {
              version: x.version,
              error: message,
            });
          }
        }
        throw error;
      } finally {
        client.release();
      }
    });
    try {
      await this.flushPromise;
    } finally {
      this.flushPromise = null;
      if (
        !this.closed &&
        (this.pendingPlayers.size ||
          this.pendingEconomy.size ||
          this.pendingWorldState.size)
      )
        this.scheduleFlush();
    }
  }

  loadWorldState(id = "global") {
    return (this as any)._worldStateCache?.get(String(id)) || null;
  }

  async loadWorldStateAsync(id = "global") {
    await this.readyPromise;
    const row = await this.pool.query(
      "SELECT data FROM world_state WHERE id=$1",
      [String(id)],
    );
    const value = row.rows[0] ? JSON.parse(String(row.rows[0].data)) : null;
    (this as any)._worldStateCache ||= new Map();
    (this as any)._worldStateCache.set(String(id), value);
    return value;
  }

  saveWorldState(data: any, id = "global") {
    const payload = JSON.stringify(data);
    if (payload.length > MAX_ECONOMY_BYTES)
      throw new Error("World state exceeds persistence size limit.");
    (this as any)._worldStateCache ||= new Map();
    (this as any)._worldStateCache.set(String(id), data);
    this.pendingWorldState.set(String(id), data);
    this.scheduleFlush();
  }

  async saveWorldStateNow(data: any, id = "global") {
    const key = String(id);
    const payload = JSON.stringify(data);
    if (payload.length > MAX_ECONOMY_BYTES)
      throw new Error("World state exceeds persistence size limit.");
    (this as any)._worldStateCache ||= new Map();
    (this as any)._worldStateCache.set(key, data);
    this.pendingWorldState.set(key, data);
    await this.readyPromise;
    return this.enqueueWrite(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await this.assertWorldLease(client);
        await client.query(
          `INSERT INTO world_state(id,data,updated_at) VALUES($1,$2,$3)
          ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,
          [key, payload, Date.now()],
        );
        await client.query("COMMIT");
        if (this.pendingWorldState.get(key) === data)
          this.pendingWorldState.delete(key);
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    });
  }

  async initializeWorldStateCache(id = "global") {
    await this.readyPromise;
    const rows = await this.pool.query("SELECT id,data FROM world_state");
    (this as any)._worldStateCache ||= new Map();
    const cache: Map<string, any> = (this as any)._worldStateCache;
    for (const row of rows.rows) {
      try {
        const parsed = JSON.parse(String(row.data));
        cache.set(String(row.id), parsed);
        // Remember what is already stored so an unchanged document is never re-uploaded after boot or on shutdown.
        ((this as any)._lastWorldPayload ||= new Map<string, string>()).set(
          String(row.id),
          JSON.stringify(parsed),
        );
      } catch (error) {
        console.warn(
          `Skipping corrupt PostgreSQL world-state row ${String(row.id)}:`,
          error,
        );
      }
    }
    if (!cache.has(String(id))) cache.set(String(id), null);
  }

  loadEconomyState(id = "global") {
    return (this as any)._economyCache?.get(String(id)) || null;
  }

  async loadEconomyStateAsync(id = "global") {
    await this.readyPromise;
    const row = await this.pool.query(
      "SELECT data FROM economy_state WHERE id=$1",
      [String(id)],
    );
    const value = row.rows[0] ? JSON.parse(String(row.rows[0].data)) : null;
    (this as any)._economyCache ||= new Map();
    (this as any)._economyCache.set(String(id), value);
    return value;
  }

  saveEconomyState(data: any, id = "global") {
    const payload = JSON.stringify(data);
    if (payload.length > MAX_ECONOMY_BYTES)
      throw new Error("Economy state exceeds persistence size limit.");
    (this as any)._economyCache ||= new Map();
    (this as any)._economyCache.set(String(id), data);
    this.pendingEconomy.set(String(id), data);
    this.scheduleFlush();
  }

  async saveEconomyStateNow(data: any, id = "global") {
    this.saveEconomyState(data, id);
    await this.flush();
  }

  async initializeEconomyCache(id = "global") {
    await this.loadEconomyStateAsync(id);
  }

  async transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
    await this.readyPromise;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async authInit() {
    await this.readyPromise;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, verified BOOLEAN NOT NULL DEFAULT FALSE,
        verification_hash TEXT, verification_expires_at BIGINT, reset_hash TEXT, reset_expires_at BIGINT, created_at BIGINT NOT NULL, session_version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY, account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE, guest_id TEXT,
        expires_at BIGINT NOT NULL, created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_account ON auth_sessions(account_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_sessions_guest ON auth_sessions(guest_id) WHERE guest_id IS NOT NULL;
    `);
    await this.authInitMigrations();
  }
  async authInitMigrations() {
    try {
      await this.pool.query(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reset_hash TEXT",
      );
    } catch {}
    try {
      await this.pool.query(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS reset_expires_at BIGINT",
      );
    } catch {}
    try {
      await this.pool.query(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1",
      );
    } catch {}
  }
  async authGetAccountByEmail(email: string) {
    await this.readyPromise;
    const r = await this.pool.query(
      'SELECT id,email,password_hash AS "passwordHash",verified,verification_hash AS "verificationHash",verification_expires_at AS "verificationExpiresAt",reset_hash AS "resetHash",reset_expires_at AS "resetExpiresAt",created_at AS "createdAt",session_version AS "sessionVersion" FROM accounts WHERE email=$1',
      [
        String(email || "")
          .trim()
          .toLowerCase(),
      ],
    );
    return r.rows[0] || null;
  }
  async authGetAccountById(id: string) {
    await this.readyPromise;
    const r = await this.pool.query(
      'SELECT id,email,verified,created_at AS "createdAt",session_version AS "sessionVersion" FROM accounts WHERE id=$1',
      [id],
    );
    return r.rows[0] || null;
  }
  async authCreateAccount(a: any, vh: string, ve: number) {
    await this.readyPromise;
    await this.pool.query(
      "INSERT INTO accounts(id,email,password_hash,verified,verification_hash,verification_expires_at,created_at,session_version) VALUES($1,$2,$3,$4,$5,$6,$7,1)",
      [a.id, a.email, a.passwordHash, false, vh, ve, a.createdAt],
    );
  }
  async authDeleteAccount(id: string) {
    await this.readyPromise;
    await this.pool.query("DELETE FROM accounts WHERE id=$1", [id]);
  }
  async authVerifyAccount(id: string) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE accounts SET verified=TRUE,verification_hash=NULL,verification_expires_at=NULL WHERE id=$1",
      [id],
    );
  }
  async authSetVerification(id: string, vh: string, ve: number) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE accounts SET verification_hash=$2,verification_expires_at=$3 WHERE id=$1",
      [id, vh, ve],
    );
  }
  async authCreateSession(
    tokenHash: string,
    accountId: string | null,
    guestId: string | null,
    expiresAt: number,
  ) {
    await this.readyPromise;
    await this.pool.query(
      "INSERT INTO auth_sessions(token_hash,account_id,guest_id,expires_at,created_at) VALUES($1,$2,$3,$4,$5)",
      [tokenHash, accountId, guestId, expiresAt, Date.now()],
    );
  }
  async authReplaceAccountSession(
    tokenHash: string,
    accountId: string,
    expiresAt: number,
    bumpSessionVersion = true,
  ) {
    await this.readyPromise;
    return await this.transaction(async (client: any) => {
      await client.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [
        accountId,
      ]);
      await client.query("DELETE FROM auth_sessions WHERE account_id=$1", [
        accountId,
      ]);
      await client.query(
        "INSERT INTO auth_sessions(token_hash,account_id,guest_id,expires_at,created_at) VALUES($1,$2,NULL,$3,$4)",
        [tokenHash, accountId, expiresAt, Date.now()],
      );
      const r = bumpSessionVersion
        ? await client.query(
            "UPDATE accounts SET session_version=COALESCE(session_version,1)+1 WHERE id=$1 RETURNING session_version",
            [accountId],
          )
        : await client.query(
            "SELECT session_version FROM accounts WHERE id=$1",
            [accountId],
          );
      if (!r.rowCount) throw new Error("Account is unavailable.");
      return Number(r.rows[0].session_version);
    });
  }
  async acquireWorldLease(
    worldId: string,
    ownerId: string,
    now: number,
    leaseMs: number,
  ) {
    await this.readyPromise;
    const expiresAt = now + leaseMs;
    const up = await this.pool.query(
      'INSERT INTO world_leases(world_id,owner_id,fencing_token,expires_at) VALUES($1,$2,1,$3) ON CONFLICT(world_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,fencing_token=CASE WHEN world_leases.expires_at <= $4 THEN world_leases.fencing_token+1 WHEN world_leases.owner_id=EXCLUDED.owner_id THEN world_leases.fencing_token ELSE world_leases.fencing_token+1 END,expires_at=EXCLUDED.expires_at WHERE world_leases.expires_at <= $4 OR world_leases.owner_id=$2 RETURNING fencing_token AS "fencingToken",expires_at AS "expiresAt"',
      [worldId, ownerId, expiresAt, now],
    );
    if (up.rowCount)
      return {
        acquired: true,
        fencingToken: Number(up.rows[0].fencingToken),
        expiresAt: Number(up.rows[0].expiresAt),
      };
    const current = await this.pool.query(
      'SELECT fencing_token AS "fencingToken",expires_at AS "expiresAt" FROM world_leases WHERE world_id=$1',
      [worldId],
    );
    return {
      acquired: false,
      fencingToken: Number(current.rows[0]?.fencingToken || 0),
      expiresAt: Number(current.rows[0]?.expiresAt || 0),
    };
  }
  async renewWorldLease(
    worldId: string,
    ownerId: string,
    fencingToken: number,
    now: number,
    leaseMs: number,
  ) {
    await this.readyPromise;
    const r = await this.pool.query(
      "UPDATE world_leases SET expires_at=$1 WHERE world_id=$2 AND owner_id=$3 AND fencing_token=$4 AND expires_at>$5",
      [now + leaseMs, worldId, ownerId, fencingToken, now],
    );
    return Number(r.rowCount || 0) === 1;
  }
  async releaseWorldLease(
    worldId: string,
    ownerId: string,
    fencingToken: number,
  ) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE world_leases SET expires_at=0 WHERE world_id=$1 AND owner_id=$2 AND fencing_token=$3",
      [worldId, ownerId, fencingToken],
    );
  }
  async enqueueOutbox(event: {
    id: string;
    type: string;
    aggregateId: string;
    payload: unknown;
    createdAt?: number;
  }) {
    await this.readyPromise;
    const now = Number(event.createdAt || Date.now());
    await this.pool.query(
      "INSERT INTO durable_outbox(id,event_type,aggregate_id,payload,status,attempts,available_at,created_at) VALUES($1,$2,$3,$4,'pending',0,$5,$5) ON CONFLICT(id) DO NOTHING",
      [
        event.id,
        event.type,
        event.aggregateId,
        JSON.stringify(event.payload),
        now,
      ],
    );
  }
  async claimOutbox(consumer: string, limit = 50, now = Date.now()) {
    await this.readyPromise;
    return await this.transaction(async (client: any) => {
      const r = await client.query(
        "SELECT id,event_type AS type,aggregate_id AS aggregate_id,payload,attempts FROM durable_outbox WHERE (status='pending' AND available_at<=$1) OR (status='processing' AND locked_until<=$1) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED",
        [now, Math.max(1, Math.min(500, limit))],
      );
      for (const e of r.rows)
        await client.query(
          "UPDATE durable_outbox SET status='processing',locked_by=$1,locked_until=$2,attempts=attempts+1 WHERE id=$3",
          [consumer, now + 30000, e.id],
        );
      return r.rows.map((e: any) => ({
        ...e,
        aggregateId: e.aggregate_id,
        payload: JSON.parse(e.payload),
        attempts: Number(e.attempts || 0) + 1,
      }));
    });
  }
  async completeOutbox(eventId: string, consumer: string, now = Date.now()) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE durable_outbox SET status='completed',completed_at=$1,locked_by=NULL,locked_until=NULL,last_error=NULL WHERE id=$2 AND status='processing' AND locked_by=$3",
      [now, eventId, consumer],
    );
  }
  async failOutbox(
    eventId: string,
    consumer: string,
    error: string,
    now = Date.now(),
  ) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE durable_outbox SET status='pending',available_at=$1::bigint+LEAST(300000,1000*(1::bigint<<LEAST(attempts,8))),locked_by=NULL,locked_until=NULL,last_error=$2 WHERE id=$3 AND status='processing' AND locked_by=$4",
      [now, String(error).slice(0, 2000), eventId, consumer],
    );
  }
  async authGetSessionByHash(tokenHash: string) {
    await this.readyPromise;
    const r = await this.pool.query(
      'SELECT s.token_hash AS "tokenHash",s.account_id AS "accountId",s.guest_id AS "guestId",s.expires_at AS "expiresAt",a.email FROM auth_sessions s LEFT JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=$1',
      [tokenHash],
    );
    return r.rows[0] || null;
  }
  async authDeleteSession(tokenHash: string) {
    await this.readyPromise;
    await this.pool.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
      tokenHash,
    ]);
  }
  async authCleanup() {
    await this.readyPromise;
    await this.pool.query("DELETE FROM auth_sessions WHERE expires_at <= $1", [
      Date.now(),
    ]);
  }
  async authSetPasswordReset(id: string, rh: string, re: number) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE accounts SET reset_hash=$2,reset_expires_at=$3 WHERE id=$1",
      [id, rh, re],
    );
  }
  async authResetPassword(id: string, passwordHash: string) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE accounts SET password_hash=$2,reset_hash=NULL,reset_expires_at=NULL WHERE id=$1",
      [id, passwordHash],
    );
  }
  async authListAccountSessions(accountId: string) {
    await this.readyPromise;
    const r = await this.pool.query(
      'SELECT created_at AS "createdAt",expires_at AS "expiresAt" FROM auth_sessions WHERE account_id=$1 ORDER BY created_at DESC',
      [accountId],
    );
    return r.rows;
  }
  async authDeleteAllSessions(accountId: string) {
    await this.readyPromise;
    await this.pool.query("DELETE FROM auth_sessions WHERE account_id=$1", [
      accountId,
    ]);
  }
  async authBumpSessionVersion(accountId: string) {
    await this.readyPromise;
    await this.pool.query(
      "UPDATE accounts SET session_version=COALESCE(session_version,1)+1 WHERE id=$1",
      [accountId],
    );
  }

  async stats() {
    await this.readyPromise;
    const [players, economy, meta] = await Promise.all([
      this.pool.query("SELECT COUNT(*)::int AS count FROM players"),
      this.pool.query("SELECT COUNT(*)::int AS count FROM economy_state"),
      this.pool.query("SELECT value FROM repository_meta WHERE key=$1", [
        "schema_version",
      ]),
    ]);
    return {
      schemaVersion: Number(meta.rows[0]?.value || 1),
      players: Number(players.rows[0]?.count || 0),
      economyRows: Number(economy.rows[0]?.count || 0),
      backend: "postgres",
    };
  }

  async integrityCheck() {
    await this.readyPromise;
    await this.pool.query("SELECT 1");
    return true;
  }

  async close() {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    await this.pool.end();
  }
}

export { PostgresRepository };
