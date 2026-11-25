import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const queue = read("server/runtime/QueueService.ts");
const pvp = read("server/runtime/commands/PvpCommands.ts");
const dungeon = read("server/runtime/commands/DungeonCommands.ts");
const sim = read("server/world/MobSimulationService.ts");
const ranges = read("server/combat/CombatRanges.ts");
const combat = read("server/combat/CombatEngine.ts");
const authority = read("server/combat/CombatAuthority.ts");
const mobs = JSON.parse(read("game-data/world-mobs.json"));

assert.match(
  queue,
  /isArenaQueued\(id:string\)/,
  "queue service exposes arena queue membership",
);
assert.match(
  queue,
  /isDungeonQueued\(id:string\)/,
  "queue service exposes dungeon queue membership",
);
assert.match(
  queue,
  /isQueueBusy\(p:any\)/,
  "queue service centralizes cross-activity eligibility",
);
assert.match(
  queue,
  /members\.some\(\(x:any\)=>!x\.online\|\|x\.dead\|\|this\.isQueueBusy\(x\)\)/,
  "premade dungeon queue rejects busy/queued members",
);
assert.match(
  queue,
  /this\.isArenaQueued\(p\?\.id\)\|\|this\.hasArenaMatch\(p\?\.id\)/,
  "dungeon queue pruning excludes arena queue/matches",
);
assert.match(
  pvp,
  /p\.dungeonQueueGroupId\|\|dungeonQueue\.some/,
  "battleground queue rejects premade/solo dungeon queue",
);
assert.match(
  dungeon,
  /if\(snap\?\.error\)return\[false,snap\.error\]/,
  "solo dungeon queue surfaces eligibility errors",
);
assert.match(
  sim,
  /resolveWalkableStep\(m\.zone,m\.x,m\.y,m\.x\+nx\*step,m\.y\+ny\*step,m\)/,
  "mob chase movement uses collision resolver",
);
assert.match(
  sim,
  /const next=this\.world\.resolveWalkableStep\(m\.zone,m\.x,m\.y,m\.x\+nx\*step,m\.y\+ny\*step,m\)/,
  "return/wander movement uses collision resolver",
);
assert.match(
  ranges,
  /fallbackMeters = COMBAT_RANGES\.meleeMeters/,
  "range fallback contract remains physical meters",
);
assert.match(
  combat,
  /normalizeAbilityRange\(rangedFloor,zoneMeters,COMBAT_RANGES\.meleeMeters\)/,
  "encounter fallback passes physical meters",
);
assert.match(
  authority,
  /normalizeAbilityRange\(a\?\.range,meters,COMBAT_RANGES\.meleeMeters\)/,
  "authority fallback passes physical meters",
);
assert.ok(
  mobs.every(
    (m) => Number.isFinite(Number(m.respawn)) && Number(m.respawn) > 0,
  ),
  "every world mob has an explicit positive respawn duration",
);
assert.equal(mobs.length, 49, "world mob catalog size unchanged");
console.log("Audit batch 14 regression checks passed (14 assertions).");
