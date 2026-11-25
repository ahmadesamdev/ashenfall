import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "ashenfall-exploration-ledger-"),
);
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(temp, "players.json");
  const repo = new MemoryRepository(file);
  const p = {
    id: "explorer",
    xp: 125,
    gold: 40,
    regionDiscoveries: ["hidden-arch"],
    _rewardLedger: [],
  };
  const key = "exploration:explorer:dynamic_discovery:hidden-arch";
  assert.equal(
    repo.savePlayerRewardOnce(p, key),
    true,
    "first exploration reward and player state commit",
  );
  const duplicate = { ...repo.getPlayer("explorer"), xp: 250 };
  assert.equal(
    repo.savePlayerRewardOnce(duplicate, key),
    false,
    "duplicate exploration key rejected",
  );
  repo.close();
  const reopened = new MemoryRepository(file);
  const saved = reopened.getPlayer("explorer");
  assert.equal(
    saved.xp,
    125,
    "duplicate reward does not alter canonical saved XP",
  );
  assert.ok(
    saved._rewardLedger.includes(key),
    "exploration key persists across restart",
  );
  reopened.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
const coordinator = fs.readFileSync(
  "server/runtime/AuthoritativeSimulationCoordinator.ts",
  "utf8",
);
assert.ok(
  coordinator.includes("explorationOccurrence") &&
    coordinator.includes("explorationRewardKey"),
  "exploration keys use stable event identity",
);
assert.match(
  coordinator,
  /await repo\.savePlayerRewardOnce\(p,explorationRewardKey\)/,
  "exploration rewards await durable ledger commit",
);
assert.match(
  coordinator,
  /if\(Array\.isArray\(p\._rewardLedger\)&&p\._rewardLedger\.includes\(explorationRewardKey\)\)\{/,
  "already recorded rewards are skipped inside the serialized reward task",
);
const stormStart = coordinator.indexOf("if(rr.type==='storm_damage')");
const stormEnd = coordinator.indexOf(
  "if(rr.type==='dynamic_discovery')",
  stormStart,
);
const storm = coordinator.slice(stormStart, stormEnd);
assert.match(
  storm,
  /await repo\.savePlayerNow\(p\)/,
  "recurring storm damage persists without a permanent per-tick reward key",
);
assert.doesNotMatch(
  storm,
  /savePlayerRewardOnce/,
  "recurring damage does not grow the permanent reward ledger each tick",
);
console.log("Audit Batch 30 passed: 9 assertions.");
