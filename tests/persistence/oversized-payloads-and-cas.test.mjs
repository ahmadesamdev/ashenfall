import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SQLiteRepository } from "../../server/persistence/SQLiteRepository.ts";

const dbPath = path.join(
  os.tmpdir(),
  `ashenfall-senior-review-${process.pid}.sqlite`,
);
for (const suffix of ["", "-wal", "-shm"])
  try {
    fs.rmSync(dbPath + suffix, { force: true });
  } catch {}
const postgresSource = fs.readFileSync(
  new URL("../../server/persistence/PostgresRepository.ts", import.meta.url),
  "utf8",
);
assert.match(
  postgresSource,
  /async initializeWorldStateCache\([\s\S]*?SELECT id,data FROM world_state/,
  "PostgreSQL startup hydrates all named world-state namespaces",
);
assert.match(
  postgresSource,
  /async saveWorldStateNow\([\s\S]*?BEGIN[\s\S]*?assertWorldLease\(client\)[\s\S]*?COMMIT/,
  "critical world-state checkpoints are lease-checked and committed before resolving",
);
const repoA = new SQLiteRepository(dbPath);
let repoB = null;
try {
  repoA.savePlayerNow({ id: "healthy-a", hasCharacter: true, gold: 10 });
  assert.equal(repoA.stats().players, 1);
  repoB = new SQLiteRepository(dbPath);

  const checkpoint = {
    version: 1,
    zones: {
      gloamwood: {
        id: "contract-durable",
        progress: 8,
        rewardStatus: "pending",
      },
    },
  };
  repoA.saveWorldStateNow(checkpoint, "open-world-activity-v1");
  assert.deepEqual(
    repoB.loadWorldState("open-world-activity-v1"),
    checkpoint,
    "immediate world-state commit is visible to another repository instance",
  );

  repoA.savePlayer({
    id: "oversized",
    hasCharacter: true,
    blob: "x".repeat(2_000_100),
  });
  repoA.savePlayer({ id: "healthy-b", hasCharacter: true, gold: 20 });
  assert.doesNotThrow(() => repoA.flush());
  assert.equal(
    repoA.stats().players,
    2,
    "healthy rows commit even when another player is oversized",
  );

  const stale = repoB.getPlayer("healthy-a");
  repoA.savePlayerNow({ ...repoA.getPlayer("healthy-a"), gold: 99 });
  assert.throws(
    () => repoB.savePlayerNow({ ...stale, gold: 11 }),
    /stale persistence revision|changed by another server process/,
  );
  repoB.savePlayerNow({ id: "healthy-c", hasCharacter: true, gold: 30 });
  assert.ok(repoB.stats().players >= 3);
  console.log(
    "senior-review persistence: PASS — healthy rows survive oversized payloads, stale CAS writes are rejected, and later unrelated saves still commit",
  );
} finally {
  try {
    repoA.close();
  } catch {}
  try {
    repoB?.close();
  } catch {}
  for (const suffix of ["", "-wal", "-shm"])
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch {}
}
