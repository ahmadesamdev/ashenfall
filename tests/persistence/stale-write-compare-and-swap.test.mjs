import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ashenfall-cas-"));
let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions++;
};
try {
  const { SQLiteRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/SQLiteRepository.ts")).href
  );
  const file = path.join(temp, "shared.sqlite");
  const first = new SQLiteRepository(file);
  const initial = { id: "cas-player", xp: 10, gold: 5 };
  first.savePlayerNow(initial);
  const staleRepo = new SQLiteRepository(file);
  const stale = staleRepo.getPlayer("cas-player");
  check(
    stale && stale.xp === 10,
    "second repository loads the committed snapshot",
  );

  const current = first.getPlayer("cas-player");
  current.xp = 20;
  first.savePlayerNow(current);
  stale.xp = 99;
  assert.throws(
    () => staleRepo.savePlayerNow(stale),
    /stale persistence revision/,
    "stale writer is rejected by revision compare-and-swap",
  );
  assertions++;
  const verify = new SQLiteRepository(file);
  check(
    verify.getPlayer("cas-player").xp === 20,
    "stale write does not overwrite latest committed player state",
  );

  const staleForTrade = staleRepo.getPlayer("cas-player");
  staleForTrade.gold = 999;
  assert.throws(
    () => staleRepo.savePlayersAtomically([staleForTrade]),
    /changed by another server process/,
    "atomic group write rejects stale snapshot",
  );
  assertions++;
  check(
    verify.getPlayer("cas-player").gold === 5,
    "failed stale transaction leaves persisted gold untouched",
  );

  const fresh = verify.getPlayer("cas-player");
  fresh.gold = 7;
  verify.savePlayerNow(fresh);
  const finalCheck = new SQLiteRepository(file);
  check(
    finalCheck.getPlayer("cas-player").gold === 7,
    "fresh revision can commit normally",
  );
  finalCheck.close();

  const legacyFile = path.join(temp, "legacy.sqlite");
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const legacyDb = new DatabaseSync(legacyFile);
  legacyDb.exec(
    'CREATE TABLE players(id TEXT PRIMARY KEY,data TEXT NOT NULL,updated_at INTEGER NOT NULL); INSERT INTO players(id,data,updated_at) VALUES(\'legacy-player\',\'{"id":"legacy-player","xp":3}\',1);',
  );
  legacyDb.close();
  const migrated = new SQLiteRepository(legacyFile);
  const legacyPlayer = migrated.getPlayer("legacy-player");
  legacyPlayer.xp = 4;
  migrated.savePlayerNow(legacyPlayer);
  check(
    migrated.getPlayer("legacy-player").xp === 4,
    "legacy SQLite schema migrates and remains writable",
  );
  migrated.close();

  verify.close();
  first.close();
  staleRepo.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`Audit Batch 34 passed: ${assertions} assertions.`);
