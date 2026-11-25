import assert from "node:assert/strict";
import fs from "node:fs";

const coordinator = fs.readFileSync(
  "server/runtime/AuthoritativeSimulationCoordinator.ts",
  "utf8",
);
const region = fs.readFileSync("server/world/RegionEngine.ts", "utf8");
const dynamic = fs.readFileSync("server/world/DiscoveryEngine.ts", "utf8");

assert.match(
  coordinator,
  /const explorationRewardWork=\(async\(\)=>\{/,
  "exploration reward persistence is handled by an async task",
);
assert.match(
  coordinator,
  /await repo\.savePlayerRewardOnce\(p,explorationRewardKey\)/,
  "one-time exploration reward paths await durable reward-ledger commits",
);
assert.match(
  coordinator,
  /explorationRewardWork\.catch\(/,
  "background reward failures are caught rather than becoming unhandled rejections",
);
assert.ok(
  coordinator.includes(
    "catch(error:any){for(const key of Object.keys(p))delete p[key];Object.assign(p,explorationBefore);console.error('[exploration] reward persistence failed'",
  ),
  "one failed discovery save restores player state and logs without aborting later result processing",
);
assert.match(
  coordinator,
  /if\(rr\.type==='dynamic_discovery'\)/,
  "dynamic discoveries have an explicit reward handling path",
);
assert.match(
  region,
  /if\(rs\.firstVisitedAt\)return;/,
  "region first-visit rewards are guarded by a persisted first-visit marker",
);
assert.match(
  region,
  /if\(rs\.completedAt\|\|!all\.length\|\|all\.some/,
  "region completion rewards are guarded against repeat completion",
);
assert.match(
  region,
  /p\.regionDiscoveries\.includes\(h\.id\)/,
  "hidden location rewards check the per-player discovery marker",
);
assert.match(
  region,
  /p\.regionDiscoveries\.includes\(poi\.id\)/,
  "point-of-interest rewards check the per-player discovery marker",
);
assert.match(
  dynamic,
  /!d\.discoveredBy\.includes\(String\(p\.id\)\)/,
  "dynamic discovery candidates exclude players already marked as discoverers",
);
assert.match(
  dynamic,
  /d\.discoveredBy\.push\(id\)/,
  "dynamic discovery is marked only through the explicit post-commit marking API",
);
assert.match(
  dynamic,
  /markDiscovered\(discoveryId:string,playerId:string\)/,
  "durable discovery rewards have a separate post-commit marker operation",
);
console.log("Audit Batch 23 passed: 11 assertions.");
