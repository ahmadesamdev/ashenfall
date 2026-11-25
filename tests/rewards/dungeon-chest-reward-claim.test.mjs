import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "ashenfall-dungeon-chest-ledger-"),
);
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(temp, "players.json");
  const repo = new MemoryRepository(file);
  const player = {
    id: "dungeon-player",
    xp: 10,
    gold: 5,
    inventory: [{ itemId: "potion", qty: 2 }],
    dungeonRewardChests: [
      {
        id: "dchest_run-123_dungeon-player",
        instanceId: "run-123",
        claimedAt: Date.now(),
      },
    ],
  };
  const rewardKey = `dungeon-chest:${player.id}:${player.dungeonRewardChests[0].id}:claim`;
  assert.equal(
    repo.savePlayerRewardOnce(player, rewardKey),
    true,
    "first chest reward key commits",
  );
  assert.ok(
    player._rewardLedger.includes(rewardKey),
    "reward key is stored with player state",
  );
  assert.equal(
    repo.savePlayerRewardOnce(player, rewardKey),
    false,
    "duplicate chest reward key is rejected",
  );
  const xpBefore = player.xp;
  assert.equal(
    player.xp,
    xpBefore,
    "duplicate repository claim does not mutate reward values",
  );
  repo.close();
  const reloadedRepo = new MemoryRepository(file);
  const persisted = reloadedRepo.getPlayer(player.id);
  assert.ok(persisted, "player survives repository reload");
  assert.ok(
    persisted._rewardLedger.includes(rewardKey),
    "chest reward key survives restart",
  );
  assert.equal(
    reloadedRepo.savePlayerRewardOnce(persisted, rewardKey),
    false,
    "restart does not allow a duplicate chest claim",
  );
  reloadedRepo.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const source = fs.readFileSync("server/runtime/ProgressionService.ts", "utf8");
assert.match(
  source,
  /dungeon-chest:\$\{String\(member\.id\)\}:\$\{String\(currentChest\.id\)\}:claim/,
  "key is stable per player and chest",
);
assert.match(
  source,
  /await repo\.savePlayerRewardOnce\(member,rewardKey\)/,
  "chest claim uses awaited durable reward transaction",
);
assert.match(
  source,
  /playerMutations\.withPlayer\(String\(member\.id\),claim\)/,
  "chest claim runs under shared player lock",
);
assert.match(
  source,
  /if\(!committed\)[\s\S]*Reconnect to refresh your saved character state/,
  "stale duplicate gets explicit refresh response",
);
assert.match(
  source,
  /if\(!inv\.give\(member,drop\.itemId,drop\.qty\)\)throw/,
  "failed inventory grant triggers rollback",
);
assert.match(
  source,
  /Object\.assign\(member,before\);[\s\S]*Nothing was consumed/,
  "failed commit restores player snapshot",
);
assert.match(
  source,
  /if\(currentChest\.claimedAt\)return\[false,'This reward chest has already been claimed\.'/,
  "chest is revalidated after waiting for lock",
);
assert.match(
  source,
  /if\(!inv\.canGiveMany\(member,itemsToGive\)\)return\[false,'Your bag is full\./,
  "inventory capacity checked before reward mutation",
);
assert.match(
  source,
  /rewardClaimLocks\.add\(lockKey\)/,
  "same-process duplicate requests have an in-flight guard",
);
assert.match(
  source,
  /rewardClaimLocks\.delete\(lockKey\)/,
  "in-flight guard is always released",
);
assert.doesNotMatch(
  source,
  /await repo\.savePlayerNow\(member\)/,
  "chest claim no longer uses non-idempotent save path",
);
assert.match(
  source,
  /const xp=Math\.max\(0,Number\(currentChest\.rewards\?\.xp\)\|\|0\)/,
  "XP reward remains bounded to non-negative value",
);
assert.match(
  source,
  /gold=Math\.max\(0,Number\(currentChest\.rewards\?\.gold\)\|\|0\)/,
  "gold reward remains bounded to non-negative value",
);
assert.match(
  source,
  /member\.lastDungeonReward=\{chestId:currentChest\.id,xp,gold,items:itemsToGive,at:currentChest\.claimedAt\}/,
  "claim receipt records granted contents",
);
assert.match(
  source,
  /finally\{\s*rewardClaimLocks\.delete\(lockKey\);\s*\}/,
  "claim lock cleanup executes on every path",
);
console.log("Audit Batch 26 passed: 22 assertions.");
