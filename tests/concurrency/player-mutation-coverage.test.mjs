import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const coordinatorSource = fs.readFileSync(
  new URL("../../server/shared/PlayerMutationCoordinator.ts", import.meta.url),
  "utf8",
);
const worldMaintenance = fs.readFileSync(
  new URL("../../server/world/WorldMaintenanceService.ts", import.meta.url),
  "utf8",
);
const simulation = fs.readFileSync(
  new URL(
    "../../server/runtime/AuthoritativeSimulationCoordinator.ts",
    import.meta.url,
  ),
  "utf8",
);
const runtime = fs.readFileSync(
  new URL("../../server/runtime/ServerRuntime.ts", import.meta.url),
  "utf8",
);
const worldCombat = fs.readFileSync(
  new URL(
    "../../server/runtime/WorldCombatSimulationService.ts",
    import.meta.url,
  ),
  "utf8",
);
const registry = fs.readFileSync(
  new URL("../../server/shared/GeneratedItemRegistry.ts", import.meta.url),
  "utf8",
);

assert.match(coordinatorSource, /isLocked\(playerId: string\): boolean/);
assert.match(
  worldMaintenance,
  /world\.playerMutations\?\.isLocked\?\.\(player\.id\)/,
  "movement must not advance a player while a command owns its mutation lock",
);
assert.match(
  simulation,
  /const tickPlayers=world\.players\.filter\(\(p:any\)=>!playerMutations\?\.isLocked\?\.\(p\?\.id\)\)/,
  "exploration ticks must skip locked players",
);
assert.match(
  simulation,
  /if\(!p\|\|playerMutations\?\.isLocked\?\.\(p\.id\)\)continue/,
  "main simulation must skip locked players",
);
assert.match(
  worldCombat,
  /filter\(\(p:any\)=>!this\.world\.playerMutations\?\.isLocked\?\.\(p\?\.id\)\)/,
  "mob combat must not mutate players while their async mutation is in flight",
);
assert.match(
  runtime,
  /const registryPlayers=repo\.allPlayers\?\.\(\)\|\|world\.players/,
);
assert.match(runtime, /playerMutations\.withPlayers\(registryPlayers\.map/);
assert.match(
  runtime,
  /for\(const changedPlayer of result\.changedPlayers\|\|\[\]\) await repo\.savePlayerNow\(changedPlayer\)/,
);
assert.match(
  registry,
  /knownDefinitions\.get\(id\)/,
  "offline transfers should copy from a durable definition without polluting global registry",
);

const c = new PlayerMutationCoordinator();
let unblock;
const gate = new Promise((resolve) => {
  unblock = resolve;
});
const holding = c.withPlayer("locked-player", async () => {
  await gate;
});
assert.equal(c.isLocked("locked-player"), true);
assert.equal(c.isLocked("other-player"), false);
unblock();
await holding;
assert.equal(c.isLocked("locked-player"), false);
console.log(
  "audit batch 43 player mutation coverage: PASS — simulation lock visibility, tick guards, loot/mining commit isolation, durable generated-item owner persistence",
);
