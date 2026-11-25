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
const index = fs.readFileSync("server/index.ts", "utf8");

assert.match(
  index,
  /createProgressionService\(\{[^}]*playerMutations\}\)/s,
  "progression service receives shared player mutation coordinator",
);
assert.ok(
  progression.includes(
    "playerMutations?.withPlayers?playerMutations.withPlayers(members.map((m:any)=>m.id),resolve)",
  ),
  "expired group loot rolls lock every party member",
);
assert.match(
  progression,
  /resolvingExpiredRolls\.has\(String\(r\.id\)\)/,
  "expired loot rolls are deduplicated while awaiting locks",
);
assert.ok(
  progression.includes(
    "finally(()=>resolvingExpiredRolls.delete(String(r.id)))",
  ),
  "expired roll dedupe marker is always released",
);
assert.match(
  handlers,
  /playerMutations\.withPlayers\(partyPlayers\.map\(\(x:any\)=>x\.id\),submit\)/,
  "loot choice and resolution share a lock across all participants",
);
assert.match(
  handlers,
  /const submit=\(\)=>\{const idx=\(p\.pendingLootRolls\|\|\[\]\)\.findIndex/,
  "loot choice is revalidated after acquiring locks",
);
assert.match(
  simulation,
  /p\._miningCompletionPending/,
  "mining completion has a per-player duplicate-work guard",
);
assert.ok(
  simulation.includes(
    "playerMutations?.withPlayer?playerMutations.withPlayer(String(p.id),finishMining):finishMining()",
  ),
  "mining reward commit uses shared player lock",
);
assert.match(
  simulation,
  /await repo\.savePlayer\(p\)/,
  "mining completion awaits persistence before reporting success",
);
assert.match(
  simulation,
  /if\(!p\.mining\|\|Date\.now\(\)<Number\(p\.mining\.endsAt\|\|0\)\)return/,
  "mining completion revalidates pending job inside the lock",
);
assert.match(
  simulation,
  /if\(p\.worldCombatMobId\|\|p\.encounterId\)\{const activeOre/,
  "mining rechecks combat interruption inside the lock",
);

const locks = new PlayerMutationCoordinator();
const order = [];
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const mining = locks.withPlayer("miner", async () => {
  order.push("mining-start");
  await gate;
  order.push("mining-commit");
});
const loot = locks.withPlayers(["party-b", "miner", "party-a"], async () => {
  order.push("loot-resolve");
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  order,
  ["mining-start"],
  "party loot resolution waits while one participant has a pending inventory mutation",
);
release();
await Promise.all([mining, loot]);
assert.deepEqual(
  order,
  ["mining-start", "mining-commit", "loot-resolve"],
  "mining and party loot commit in a serial order for shared players",
);
assert.equal(
  locks.pendingKeys,
  0,
  "all mutation locks are released after completion",
);

console.log(
  "Audit batch 18 passed (14 assertions, including async mining/party-loot contention).",
);
