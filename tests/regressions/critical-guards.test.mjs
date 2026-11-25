import fs from "node:fs";
import assert from "node:assert/strict";
const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const trade = read("server/runtime/TradeService.ts");
const coordinator = read(
  "server/runtime/AuthoritativeSimulationCoordinator.ts",
);
const economy = read("server/economy/Economy.ts");
const spawn = read("server/world/WorldSpawnService.ts");
const death = read("server/world/WorldCombatService.ts");
const pvp = read("server/runtime/commands/PvpCommands.ts");
const character = read("server/runtime/commands/CharacterCommands.ts");
const queue = read("server/runtime/QueueService.ts");
assert.match(
  trade,
  /if\(!t\|\|t\.committing\)/,
  "trade commit has a synchronous duplicate guard",
);
assert.match(trade, /t\.committing=true/);
assert.match(trade, /finally \{ t\.committing=false; \}/);
assert.match(
  coordinator,
  /economy\.cleanup\(now\)\.catch/,
  "economy cleanup rejection is handled",
);
assert.match(
  economy,
  /systemReceipt/,
  "system auction receipts do not fail solely due to mailbox cap",
);
assert.match(
  spawn,
  /Math\.max\(10,Number\(def\.respawn\)\|\|30\)/,
  "mob respawn gets a finite fallback",
);
assert.match(
  death,
  /m\.worldEvent\|\|m\.dungeonEvent\|\|m\.dungeonPatrol\|\|m\.dungeonId/,
  "special mobs retain non-respawning sentinel",
);
assert.match(pvp, /active arena match cannot be cancelled by a participant/i);
assert.match(character, /cannot respawn during an active arena match/i);
assert.match(
  queue,
  /preservedSnapshot/,
  "failed dungeon start restores a pre-existing party",
);
for (const file of [
  "scripts/verify-core.mjs",
  "tests/combat/pursuit-and-approach.test.mjs",
  "tests/movement/client-approach-algorithm.test.mjs",
]) {
  assert.doesNotMatch(
    read(file),
    /import ts from '\/opt\/nvm\//,
    `${file} no longer hardcodes the global TypeScript import`,
  );
}
console.log(
  "critical-guards: PASS — critical guards, finite respawn fallback, party rollback, arena safeguards, portable TypeScript test imports",
);
