import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ashenfall-reward-ledger-"));
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(root, "players.json");
  const repo = new MemoryRepository(file);
  const p = { id: "player-1", name: "Test", xp: 100, gold: 10 };
  assert.equal(
    repo.savePlayerRewardOnce(p, "quest:player-1:story-1:claim-1"),
    true,
    "first reward claim succeeds",
  );
  assert.equal(
    p._rewardLedger.length,
    1,
    "reward key is recorded alongside player state",
  );
  p.xp += 50;
  p.gold += 5;
  assert.equal(
    repo.savePlayerRewardOnce(p, "quest:player-1:story-1:claim-1"),
    false,
    "duplicate reward claim is rejected",
  );
  assert.equal(p.xp, 150, "duplicate claim does not mutate the player itself");
  repo.close();
  const reloaded = new MemoryRepository(file);
  const persisted = reloaded.getPlayer("player-1");
  assert.ok(persisted, "player reloads from durable player file");
  assert.ok(
    persisted._rewardLedger.includes("quest:player-1:story-1:claim-1"),
    "reward claim marker survives restart",
  );
  assert.equal(
    reloaded.savePlayerRewardOnce(persisted, "quest:player-1:story-1:claim-1"),
    false,
    "restart does not permit duplicate claim",
  );
  assert.throws(
    () => reloaded.savePlayerRewardOnce(persisted, ""),
    /1–512 characters/,
    "empty idempotency key is rejected",
  );
  assert.throws(
    () => reloaded.savePlayerRewardOnce(persisted, "x".repeat(513)),
    /1–512 characters/,
    "oversized idempotency key is rejected",
  );
  reloaded.close();
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const repository = fs.readFileSync("server/persistence/Repository.ts", "utf8");
const sqlite = fs.readFileSync(
  "server/persistence/SQLiteRepository.ts",
  "utf8",
);
const postgres = fs.readFileSync(
  "server/persistence/PostgresRepository.ts",
  "utf8",
);
assert.match(
  repository,
  /savePlayerRewardOnce\(player: PlayerRecord, rewardKey: string\)/,
  "repository contract exposes durable idempotency API",
);
assert.match(
  sqlite,
  /BEGIN IMMEDIATE[\s\S]*INSERT INTO reward_ledger[\s\S]*writePlayerCas[\s\S]*COMMIT/,
  "SQLite reward marker and player payload share one transaction",
);
assert.match(
  postgres,
  /BEGIN[\s\S]*INSERT INTO reward_ledger[\s\S]*writePlayerCas[\s\S]*COMMIT/,
  "PostgreSQL reward marker and player payload share one transaction",
);
assert.match(
  sqlite,
  /ON CONFLICT\(reward_key\) DO NOTHING/,
  "SQLite duplicate keys are rejected atomically",
);
assert.match(
  postgres,
  /ON CONFLICT\(reward_key\) DO NOTHING RETURNING reward_key/,
  "PostgreSQL duplicate keys are rejected atomically",
);
console.log("Audit Batch 24 passed: 12 assertions.");
