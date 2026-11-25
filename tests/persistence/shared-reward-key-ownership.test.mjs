import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "ashenfall-reward-key-owner-"),
);
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(temp, "players.json");
  const repo = new MemoryRepository(file);
  const a = { id: "player-a", xp: 10, _rewardLedger: [] };
  assert.equal(
    repo.savePlayerRewardOnce(a, "shared-reward-key"),
    true,
    "first owner claims key",
  );
  assert.equal(
    repo.savePlayerRewardOnce(
      { ...repo.getPlayer("player-a"), xp: 20 },
      "shared-reward-key",
    ),
    false,
    "same owner cannot claim key twice",
  );
  assert.throws(
    () =>
      repo.savePlayerRewardOnce(
        { id: "player-b", xp: 10, _rewardLedger: [] },
        "shared-reward-key",
      ),
    /owned by another player/,
    "different player cannot reuse globally unique key",
  );
  assert.equal(
    repo.getPlayer("player-a").xp,
    10,
    "collision does not alter canonical owner state",
  );
  repo.close();
  const reopened = new MemoryRepository(file);
  assert.throws(
    () =>
      reopened.savePlayerRewardOnce(
        { id: "player-b", xp: 10, _rewardLedger: [] },
        "shared-reward-key",
      ),
    /owned by another player/,
    "key ownership survives restart",
  );
  reopened.close();
  const { SQLiteRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/SQLiteRepository.ts")).href
  );
  const sqlite = new SQLiteRepository(path.join(temp, "test.sqlite"));
  const p = { id: "sqlite-a", xp: 25 };
  assert.equal(
    sqlite.savePlayerRewardOnce(p, "sqlite-shared-key"),
    true,
    "SQLite first claim commits",
  );
  assert.equal(
    sqlite.savePlayerRewardOnce({ ...p, xp: 99 }, "sqlite-shared-key"),
    false,
    "SQLite duplicate claim is rejected",
  );
  assert.throws(
    () =>
      sqlite.savePlayerRewardOnce(
        { id: "sqlite-b", xp: 1 },
        "sqlite-shared-key",
      ),
    /owned by another player/,
    "SQLite detects cross-player key collision",
  );
  assert.equal(
    sqlite.getPlayer("sqlite-a").xp,
    25,
    "SQLite collision leaves canonical player unchanged",
  );
  sqlite.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log("Audit Batch 32 passed: 9 assertions.");
