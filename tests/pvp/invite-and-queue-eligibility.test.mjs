import fs from "node:fs";
import assert from "node:assert/strict";
const pvp = fs.readFileSync("server/runtime/commands/PvpCommands.ts", "utf8");
const queue = fs.readFileSync("server/runtime/QueueService.ts", "utf8");
assert.match(
  pvp,
  /handlers\['pvp_invite'\][\s\S]*?already has a pending PvP challenge/,
  "pending PvP invites cannot be silently overwritten",
);
assert.match(
  pvp,
  /handlers\['pvp_accept'\][\s\S]*?while defeated or inside a dungeon/,
  "dead/dungeon players cannot accept duel invites",
);
assert.match(
  pvp,
  /handlers\['pvp_open_attack'\][\s\S]*?while defeated or inside a dungeon/,
  "dead/dungeon players cannot initiate open PvP",
);
assert.match(
  pvp,
  /handlers\['pvp_queue'\][\s\S]*?while already in PvP/,
  "active PvP players cannot queue for battlegrounds",
);
assert.match(
  queue,
  /p\.battlegroundId\|\|p\.pvp/,
  "solo dungeon queue prunes active PvP players",
);
assert.match(
  queue,
  /p\.battlegroundId\|\|p\.pvp/,
  "premade dungeon queue prunes active PvP players",
);
assert.match(
  queue,
  /!p\.battlegroundId&&!p\.pvp/,
  "dungeon matching excludes players already in PvP",
);
console.log("Audit batch 4 source regression checks passed (7 checks).");
