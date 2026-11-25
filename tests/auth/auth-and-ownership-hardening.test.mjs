import assert from "node:assert/strict";
import fs from "node:fs";
import { createSerialExecutor } from "../../server/shared/Hardening.ts";
import { rollbackOwnedChanges } from "../../server/shared/OwnedRollback.ts";

const runtime = fs.readFileSync(
  new URL("../../server/runtime/ServerRuntime.ts", import.meta.url),
  "utf8",
);
const commandHandlers = fs.readFileSync(
  new URL("../../server/runtime/CommandHandlers.ts", import.meta.url),
  "utf8",
);
const questStory = fs.readFileSync(
  new URL(
    "../../server/runtime/commands/QuestStoryCommands.ts",
    import.meta.url,
  ),
  "utf8",
);
const worldEvents = fs.readFileSync(
  new URL("../../server/world/WorldEvents.ts", import.meta.url),
  "utf8",
);
const ownedRollback = fs.readFileSync(
  new URL("../../server/shared/OwnedRollback.ts", import.meta.url),
  "utf8",
);
const auth = fs.readFileSync(
  new URL("../../server/auth/AuthService.ts", import.meta.url),
  "utf8",
);
const env = fs.readFileSync(
  new URL("../../.env.example", import.meta.url),
  "utf8",
);
const economySource = fs.readFileSync(
  new URL("../../server/economy/Economy.ts", import.meta.url),
  "utf8",
);
const inventoryCommands = fs.readFileSync(
  new URL(
    "../../server/runtime/commands/InventoryEconomyCommands.ts",
    import.meta.url,
  ),
  "utf8",
);
const sqliteRepo = fs.readFileSync(
  new URL("../../server/persistence/SQLiteRepository.ts", import.meta.url),
  "utf8",
);
const postgresRepo = fs.readFileSync(
  new URL("../../server/persistence/PostgresRepository.ts", import.meta.url),
  "utf8",
);
const stateService = fs.readFileSync(
  new URL("../../server/runtime/StateService.ts", import.meta.url),
  "utf8",
);

assert.match(
  runtime,
  /const identityKey=normalizedIdentity\?`\$\{kind\}:identity:\$\{normalizedIdentity\}`:''/,
);
assert.match(
  runtime,
  /const identityAllowed=!identityKey\|\|identityLimiter\.allow\(identityKey\)/,
);
assert.match(
  runtime,
  /try\{out\[key\]=decodeURIComponent\(part\.slice\(i\+1\)\.trim\(\)\);\}catch/,
);
assert.match(runtime, /commandExecutor\.run\(async\(\)=>/);
assert.match(runtime, /Command queue is full\./);
assert.match(runtime, /setupClosed\|\|socket\.readyState!==WebSocket\.OPEN/);
assert.match(runtime, /WebSocket connection setup failed:/);
assert.match(runtime, /Disconnected player save failed:/);
assert.match(
  runtime,
  /playerMutations\?\.withPlayer\)await playerMutations\.withPlayer\(String\(c\.player\.id\),disconnect\)/,
);
assert.match(
  runtime,
  /if\(activeSessions\.has\(String\(c\.player\.id\)\)\|\|\(c\.principal\?\.kind==='account'&&activeAccountConnections\.has\(String\(c\.principal\.accountId\)\)&&activeAccountConnections\.get\(String\(c\.principal\.accountId\)\)!==c\)\)return/,
);
assert.match(
  runtime,
  /Failed to clear player online state after setup failure:/,
);
assert.match(
  runtime,
  /const markOffline=\(\)=>\{if\(activeSessions\.has\(String\(c\.player\.id\)\)\|\|\(c\.principal\?\.kind==='account'&&activeAccountConnections\.has\(String\(c\.principal\.accountId\)\)&&activeAccountConnections\.get\(String\(c\.principal\.accountId\)\)!==c\)\)return;c\.player\.online=false;\}/,
);
assert.match(runtime, /app\.get\('\/game-data\/world-layout\.json'/);
assert.doesNotMatch(runtime, /app\.use\('\/game-data'/);
assert.match(
  runtime,
  /app\.get\('\/health',\(_req,res\)=>res\.json\(\{ok:true,version:VERSION\}\)\)/,
);
assert.doesNotMatch(runtime, /app\.get\('\/health'.*telemetry\.snapshot/s);
assert.match(auth, /!Number\.isFinite\(Number\(p\.exp\)\)/);
assert.match(
  auth,
  /ASHENFALL_JWT_SECRET must be configured with at least 32 characters/,
);
assert.match(auth, /private refreshLocks = new Map<string, Promise<any>>\(\)/);
assert.match(auth, /const inFlight=this\.refreshLocks\.get\(key\)/);
assert.match(auth, /recentRefreshResults\.set\(key/);
assert.match(auth, /await makePasswordHash\(supplied\)/);
// Product decision (2026-11): sign-up tells the user when the email is already registered instead of silently sending nothing.
assert.match(auth, /alreadyRegistered:true/);
assert.match(auth, /Invalid or expired verification code/);
assert.match(commandHandlers, /social\.isIgnored\?\.\(p,target\.id\)/);
assert.match(questStory, /rollbackOwnedChanges\(p,before,attempted\)/);
assert.match(
  questStory,
  /if\(attempted\)rollbackOwnedChanges\(p,before,attempted\)/,
);
assert.match(
  ownedRollback,
  /function rollbackOwnedChanges\(target:any,before:any,attempted:any\)/,
);
assert.match(worldEvents, /attempted=structuredClone\(p\)/);
assert.match(worldEvents, /rollbackOwnedChanges\(p,before,attempted\)/);
assert.doesNotMatch(
  worldEvents,
  /for\(const key of Object\.keys\(p\)\)delete p\[key\];Object\.assign\(p,before\)/,
);
assert.match(commandHandlers, /You cannot use the Homeward Stone while dead/);
assert.match(
  commandHandlers,
  /world\.combatService\?\.clearWorldCombat\?\.\(p\)/,
);
assert.match(commandHandlers, /You cannot change talents inside a dungeon/);
assert.match(env, /ASHENFALL_JWT_SECRET=\r?\n/);
assert.match(
  economySource,
  /return Number\(m\.expiresAt\|\|0\)>now\|\|hasItems\|\|hasGold/,
);
assert.doesNotMatch(
  inventoryCommands,
  /if\(eqSlot\)p\.equipment\[eqSlot\]=instanceId/,
);
assert.match(sqliteRepo, /for \(const p of rows\)/);
assert.match(sqliteRepo, /BEGIN IMMEDIATE/);
assert.match(sqliteRepo, /this\.conflictedPlayers\.add\(id\)/);
assert.match(postgresRepo, /this\.failedPlayerWrites\.set\(x\.id/);
assert.match(postgresRepo, /this\.conflictedPlayers\.add\(id\)/);
assert.match(postgresRepo, /pending writes will be retried/);
assert.match(
  postgresRepo,
  /if\(!this\.closed&&\(this\.pendingPlayers\.size\|\|this\.pendingEconomy\.size\|\|this\.pendingWorldState\.size\)\)this\.scheduleFlush\(\)/,
);
assert.match(stateService, /new PlayerSpatialIndex\(world\.players\|\|\[\]\)/);
assert.match(
  stateService,
  /function broadcast\(sections:any=\{\}\)\{\n  rebuildPlayerSpatialIndex\(\)/,
);
assert.match(
  stateService,
  /finally \{ spatialIndexBroadcastActive=false; playerSpatialIndex=null; \}/,
);
assert.match(
  stateService,
  /spatialIndexBroadcastActive \? \(playerSpatialIndex\|\|rebuildPlayerSpatialIndex\(\)\) : new PlayerSpatialIndex/,
);
assert.match(
  stateService,
  /function broadcastMotion\(serverNow=Date\.now\(\)\)\{\n  rebuildPlayerSpatialIndex\(\)/,
);

const rollbackBefore = {
  gold: 10,
  quest: { completed: 0, unrelated: 0 },
  inventory: [{ itemId: "ore", qty: 1 }],
};
const rollbackAttempted = {
  gold: 20,
  quest: { completed: 1, unrelated: 0 },
  inventory: [{ itemId: "ore", qty: 1 }],
};
const rollbackCurrent = {
  gold: 20,
  quest: { completed: 1, unrelated: 7 },
  inventory: [{ itemId: "ore", qty: 2 }],
};
rollbackOwnedChanges(rollbackCurrent, rollbackBefore, rollbackAttempted);
assert.equal(
  rollbackCurrent.gold,
  10,
  "failed reward must roll back its own gold mutation",
);
assert.equal(
  rollbackCurrent.quest.completed,
  0,
  "failed reward must roll back its own quest mutation",
);
assert.equal(
  rollbackCurrent.quest.unrelated,
  7,
  "rollback must preserve a concurrent nested mutation",
);
assert.equal(
  rollbackCurrent.inventory[0].qty,
  2,
  "rollback must preserve a concurrently changed array",
);

const executor = createSerialExecutor(256);
const pending = Array.from({ length: 261 }, () =>
  executor.run(() => new Promise((resolve) => setTimeout(resolve, 1))),
);
const results = await Promise.allSettled(pending);
assert.equal(results.filter((x) => x.status === "fulfilled").length, 256);
assert.equal(results.filter((x) => x.status === "rejected").length, 5);
assert.equal(executor.pending, 0);
console.log(
  "senior-review regression suite: PASS — auth hardening, persistence isolation, and ownership-aware quest/world-event rollback",
);

const runtimeSource = await (
  await import("node:fs/promises")
).readFile(
  new URL("../../server/runtime/ServerRuntime.ts", import.meta.url),
  "utf8",
);
assert.match(
  runtimeSource,
  /sweepGeneratedItemRegistry\(\{players:registryPlayers,items,economy,now:Date\.now\(\)\}\)/,
  "disconnect should sweep generated items across all durable players",
);
assert.match(
  runtimeSource,
  /for\(const changedPlayer of result\.changedPlayers\|\|\[\]\) await repo\.savePlayerNow\(changedPlayer\)/,
  "generated-item ownership changes must be persisted",
);
const registrySource = await (
  await import("node:fs/promises")
).readFile(
  new URL("../../server/shared/GeneratedItemRegistry.ts", import.meta.url),
  "utf8",
);
assert.match(
  registrySource,
  /economyRefs\.has\(id\)/,
  "economy attachments must pin generated definitions",
);
