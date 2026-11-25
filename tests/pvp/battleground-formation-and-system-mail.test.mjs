import assert from "node:assert/strict";
import fs from "node:fs";
const zones = JSON.parse(fs.readFileSync("game-data/zones/zones.json", "utf8"));
const bg = zones.find((z) => z.id === "battleground");
assert.ok(
  bg &&
    bg.name &&
    bg.mapWidth > 0 &&
    bg.mapHeight > 0 &&
    bg.walkSpeed > 0 &&
    bg.runSpeed > 0,
  "battleground zone must be fully defined",
);
const queue = fs.readFileSync("server/runtime/QueueService.ts", "utf8");
assert.match(
  queue,
  /!p\.dungeon&&!p\.dungeonId&&!p\.encounterId&&!p\.worldCombatMobId&&!p\.dungeonMatch/,
  "BG formation must re-check busy player eligibility",
);
assert.match(
  queue,
  /!x\.battlegroundId&&!x\.pvp&&!this\.dungeonQueue\.some/,
  "ready-check requeue must check PvP and deduplicate",
);
const mob = fs.readFileSync("server/world/MobSimulationService.ts", "utf8");
assert.match(
  mob,
  /if\(!wasReturning\)\{m\.leashOriginX=m\.x;m\.leashOriginY=m\.y;\}/,
  "aggro reacquisition must preserve return leash origin",
);
const economy = fs.readFileSync("server/economy/Economy.ts", "utf8");
assert.match(
  economy,
  /system: !!raw\.system/,
  "system mail marker must survive normalization",
);
assert.match(
  economy,
  /const system = !!\(payload.*systemMail.*systemReceipt/,
  "system mail must be explicitly marked",
);
assert.match(
  economy,
  /Auction sale'.*systemReceipt:true/,
  "offline auction sale receipt must be marked",
);
const pvp = fs.readFileSync("server/runtime/commands/PvpCommands.ts", "utf8");
assert.match(
  pvp,
  /bg\.state='finished'/,
  "empty-team battleground must be finalized",
);
console.log("Follow-up review regression checks passed (8 assertions).");
