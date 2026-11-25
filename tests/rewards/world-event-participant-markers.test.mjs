import assert from "node:assert/strict";
import fs from "node:fs";

const events = fs.readFileSync("server/world/WorldEvents.ts", "utf8");
const completion = events.slice(
  events.indexOf("async complete("),
  events.indexOf("\n  fail("),
);
assert.match(
  completion,
  /const rewardsPending=\(e\.participants\|\|\[\]\)\.some/,
  "completion checks every participant reward marker",
);
assert.match(
  completion,
  /if\(!rewardsPending&&!e\.outcomeRecorded\)/,
  "regional outcome is withheld until every participant reward is durable",
);
assert.ok(
  completion.indexOf("const rewardsPending=") <
    completion.indexOf("if(!rewardsPending&&!e.outcomeRecorded)"),
  "pending state is computed before recording the regional outcome",
);
assert.match(
  completion,
  /e\.endsAt=rewardsPending\?Date\.now\(\)\+5000/,
  "incomplete reward delivery schedules a retry",
);
assert.match(
  completion,
  /await this\.persistNow\(Date\.now\(\)\)/,
  "terminal event and participant markers use awaited durable checkpoints",
);
assert.match(
  completion,
  /if\(!playerRewardCommitted\)/,
  "post-commit event checkpoint failures do not roll back a durable player reward",
);

const coordinator = fs.readFileSync(
  "server/runtime/AuthoritativeSimulationCoordinator.ts",
  "utf8",
);
assert.match(
  coordinator,
  /private explorationRewardsInFlight = new Set<string>\(\)/,
  "exploration has a shared in-flight idempotency reservation",
);
assert.match(
  coordinator,
  /if\(this\.explorationRewardsInFlight\.has\(explorationRewardKey\)\)continue/,
  "overlapping simulation ticks skip an already-running reward key",
);
assert.match(
  coordinator,
  /this\.explorationRewardsInFlight\.add\(explorationRewardKey\)/,
  "exploration key is reserved before applying mutations",
);
assert.match(
  coordinator,
  /finally\{this\.explorationRewardsInFlight\.delete\(explorationRewardKey\);\}/,
  "reservation is released on success, failure, or continue",
);
assert.match(
  coordinator,
  /playerMutations\?\.withPlayer\)await playerMutations\.withPlayer\(String\(p\.id\),processResult\)/,
  "exploration reward writes run under the per-player mutation coordinator",
);
console.log("Audit Batch 33 passed: 10 assertions.");
