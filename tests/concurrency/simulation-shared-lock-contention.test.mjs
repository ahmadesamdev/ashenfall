import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const progression = fs.readFileSync(
  "server/runtime/ProgressionService.ts",
  "utf8",
);
const handlers = fs.readFileSync("server/runtime/CommandHandlers.ts", "utf8");
const simulation = fs.readFileSync(
  "server/runtime/AuthoritativeSimulationCoordinator.ts",
  "utf8",
);
const commandHandler = fs.readFileSync(
  "server/runtime/CommandHandlers.ts",
  "utf8",
);
const worldCombat = fs.readFileSync(
  "server/world/WorldCombatService.ts",
  "utf8",
);

assert.equal(
  (progression.match(/participantIds:\[\.\.\.participantIds\]/g) || []).length,
  2,
  "both explicit group rolls and fallback auto-greed rolls snapshot the original roster",
);
assert.match(
  progression,
  /const participants=participantIds\.length\?participantIds\.map\(\(id:string\)=>repo\.getPlayer\(id\)\)\.filter\(Boolean\):partyPlayers/,
  "resolution uses the roll-time roster instead of current party membership",
);
assert.match(
  progression,
  /const participantIds=Array\.isArray\(r\.participantIds\)\?r\.participantIds\.map\(String\):null/,
  "expired roll resolution restores the original participant roster",
);
assert.match(
  handlers,
  /const ownRoll=\(p\.pendingLootRolls\|\|\[\]\)\.find/,
  "loot choice verifies the player owns the requested roll",
);
assert.match(
  handlers,
  /const stableIds=Array\.isArray\(ownRoll\.participantIds\)/,
  "loot choice locks the roll-time participant set after party changes",
);
assert.match(
  simulation,
  /playerMutations\?\.withPlayer\?playerMutations\.withPlayer\(String\(p\.id\),collectLoot\):collectLoot\(\)/,
  "movement-triggered loot collection uses the shared player mutation coordinator",
);
assert.match(
  simulation,
  /const inventoryBefore=\(p\.inventory\|\|\[\]\)\.map/,
  "arrival loot collection snapshots inventory for local rollback",
);
assert.match(
  simulation,
  /world\.lootPiles\.set\(id,pileBefore\)/,
  "failed inventory or persistence commit restores the world loot pile",
);
assert.match(
  simulation,
  /await repo\.savePlayerNow\(p\)/,
  "loot collection waits for the immediate persistence path when available",
);
assert.match(
  simulation,
  /if\(!inv\.canGiveMany\(p,rewards\.items\|\|\[\]\)\)/,
  "final reward contents including skinning extras are capacity checked before giving",
);
assert.match(
  worldCombat,
  /this\.world\.lootPiles\.delete\(pile\.id\)/,
  "world pickup continues to claim the pile synchronously so concurrent collectors cannot both take it",
);
assert.match(
  commandHandler,
  /handlers\['pickup_loot'\][\s\S]*?await repo\.savePlayerNow\(p\)/,
  "direct pickup persists before reporting a successful reward",
);
assert.match(
  commandHandler,
  /handlers\['pickup_loot'\][\s\S]*?world\.lootPiles\.set\(id,pileBefore\)/,
  "direct pickup restores the pile if the grant or persistence step fails",
);

const locks = new PlayerMutationCoordinator();
const order = [];
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const resolution = locks.withPlayers(
  ["former-party-member", "current-member"],
  async () => {
    order.push("roll-commit-start");
    await gate;
    order.push("roll-commit-end");
  },
);
await new Promise((resolve) => setImmediate(resolve));
const followupMutation = locks.withPlayer("former-party-member", async () =>
  order.push("followup-mutation"),
);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  order,
  ["roll-commit-start"],
  "another mutation for a roll participant waits while the roll commits",
);
release();
await Promise.all([resolution, followupMutation]);
assert.deepEqual(
  order,
  ["roll-commit-start", "roll-commit-end", "followup-mutation"],
  "participant mutations complete in a deterministic serial order",
);
assert.equal(locks.pendingKeys, 0, "all mutation locks are released");

console.log(
  "Audit batch 19 passed (16 assertions, including async shared-lock contention).",
);
