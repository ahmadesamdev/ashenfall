import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "ashenfall-encounter-victory-ledger-"),
);
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(temp, "players.json");
  const repo = new MemoryRepository(file);
  const player = { id: "solo-hero", xp: 0, gold: 7, inventory: [] };
  const key = "encounter-victory:encounter-28:solo-hero:reward";
  player.xp += 25;
  player.gold += 13;
  assert.equal(
    repo.savePlayerRewardOnce(player, key),
    true,
    "first ordinary encounter payout and key commit together",
  );
  assert.equal(
    repo.savePlayerRewardOnce(player, key),
    false,
    "same encounter reward key cannot be committed twice",
  );
  repo.close();
  const restarted = new MemoryRepository(file);
  const saved = restarted.getPlayer("solo-hero");
  assert.equal(saved.xp, 25, "XP survives restart with the reward key");
  assert.equal(saved.gold, 20, "gold survives restart with the reward key");
  assert.ok(
    saved._rewardLedger.includes(key),
    "encounter key survives restart",
  );
  restarted.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const victory = fs.readFileSync(
  "server/runtime/CombatVictoryService.ts",
  "utf8",
);
assert.match(
  victory,
  /if\(!e\.dungeonId\)\s*\{[\s\S]*?encounter-victory:\$\{String\(e\.id\)\}:\$\{String\(player\.id\)\}:reward/,
  "ordinary encounters use a stable player-scoped reward key",
);
assert.match(
  victory,
  /ledger\.includes\(rewardKey\)[\s\S]*?this\.combat\.encounters\.delete\(encounterKey\);\s*return true;/,
  "already-persisted encounters are removed without replaying rewards",
);
assert.match(
  victory,
  /await this\.repo\.savePlayerRewardOnce\(player,rewardKey\)/,
  "ordinary payout awaits durable reward commit",
);
assert.match(
  victory,
  /if\(!committed\)[\s\S]*?Object\.assign\(player,snapshot\)/,
  "duplicate commit rolls back speculative local payout",
);
console.log("Audit Batch 28 passed: 10 assertions.");
