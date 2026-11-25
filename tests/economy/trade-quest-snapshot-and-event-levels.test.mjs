import assert from "node:assert/strict";
import fs from "node:fs";
const events = fs.readFileSync("server/world/WorldEvents.ts", "utf8");
const trade = fs.readFileSync("server/runtime/TradeService.ts", "utf8");
assert.match(
  events,
  /level<Number\(e\.minLevel\|\|1\)\|\|level>Number\(e\.maxLevel\|\|60\)/,
  "world event participation must respect level range",
);
assert.match(
  trade,
  /structuredClone\(a\.quests\?\?a\.questStates\?\?null\)/,
  "trade must snapshot quest progress",
);
assert.match(
  trade,
  /a\.quests=snapA\.quests/,
  "trade failure must restore quest progress",
);
console.log("Batch 5 regression checks passed (3 assertions).");
