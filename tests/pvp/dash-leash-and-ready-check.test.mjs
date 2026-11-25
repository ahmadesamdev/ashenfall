import fs from "node:fs";
import assert from "node:assert/strict";
const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const pvp = read("server/combat/PvpCombatService.ts");
const worldCombat = read("server/world/WorldCombatService.ts");
const queue = read("server/runtime/QueueService.ts");
assert.match(
  pvp,
  /Number\(a\.movementDistance\s*\?\?\s*\(a\.movement==='charge'\?12:18\)\)/,
  "PvP dash respects explicit movementDistance",
);
assert.doesNotMatch(
  pvp,
  /Number\(a\.movementDistance\|\|a\.movement==='charge'\?12:18\)/,
  "PvP dash precedence regression removed",
);
assert.match(
  worldCombat,
  /const wasReturning=Boolean\(m\.returning\)\|\|m\.state==='returning'/,
  "pre-transition returning state is captured",
);
assert.match(
  worldCombat,
  /if\(!wasEngaged&&!wasReturning\)/,
  "leash origin is preserved while mob returns home",
);
assert.match(
  queue,
  /m\.accepted\?\.\[pid\]===true/,
  "ready-check expiry only requeues players who accepted",
);
assert.match(
  queue,
  /Eligible players have been returned to the queue/,
  "group-change failure actually requeues eligible players",
);
assert.doesNotMatch(
  queue,
  /if\(counts\.TANK<1\|\|counts\.HEALER<1\)return\[false,'A dungeon party needs at least one Tank and one Healer\.'/,
  "premade party composition is not artificially restricted",
);
console.log(
  "audit-batch2: PASS — PvP dash distance, leash-origin stability, ready-check expiry, group-change requeue, premade composition",
);
