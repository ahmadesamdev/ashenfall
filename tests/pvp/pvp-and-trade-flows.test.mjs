import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
// Deterministic RNG: the PvP paths roll dodge/miss, and a 3-10% chance of an avoided hit made this test flaky.
// Values stay in [0.95, 1) so no avoidance roll can succeed while ids derived from Math.random still differ.
let __seed = 1;
Math.random = () =>
  0.95 + ((__seed = (__seed * 9301 + 49297) % 233280) / 233280) * 0.0499;
const localTypeScript = path.join(
  process.cwd(),
  "node_modules",
  "typescript",
  "lib",
  "typescript.js",
);
const globalTypeScriptCandidates = [
  process.env.NODE_PATH
    ? path.join(process.env.NODE_PATH, "typescript", "lib", "typescript.js")
    : null,
  "/usr/local/lib/node_modules/typescript/lib/typescript.js",
  "/usr/lib/node_modules/typescript/lib/typescript.js",
].filter(Boolean);
const typeScriptPath = fs.existsSync(localTypeScript)
  ? localTypeScript
  : globalTypeScriptCandidates.find((candidate) => fs.existsSync(candidate)) ||
    null;
if (!typeScriptPath)
  throw new Error(
    "TypeScript is not installed. Run npm ci from the project root before running this script.",
  );
const tsModule = await import(pathToFileURL(typeScriptPath).href);
const ts = tsModule.default || tsModule;

const root = process.cwd();
const out = path.join(os.tmpdir(), "ashenfall-pvp-trade-test-dist");
fs.rmSync(out, { recursive: true, force: true });
function transpile(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
    },
  }).outputText;
  const dest = path.join(out, relative.replace(/\.ts$/, ".js"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, js);
}
transpile("server/combat/CombatTable.ts");
transpile("server/combat/CombatEffects.ts");
transpile("server/shared/Ids.ts");
transpile("server/runtime/commands/PvpCommands.ts");
transpile("server/runtime/TradeService.ts");
transpile("server/runtime/services/TradeDomainService.ts");

const { registerPvpCommands } = await import(
  `file://${out}/server/runtime/commands/PvpCommands.js`
);
let finishDuelCalls = 0;
const players = new Map();
const world = {
  normalizedMeters: (_zone, meters) => Number(meters) / 1000,
  combatRangeMeters: () => 18,
  combatRangeNormalized: (zone) => world.normalizedMeters(zone, 18),
  approachPoint: (p, target, stopMeters = 18) => {
    const dx = p.x - target.x,
      dy = p.y - target.y,
      d = Math.hypot(dx, dy) || 1;
    const stop = world.normalizedMeters(p.zone, stopMeters);
    return { x: target.x + (dx / d) * stop, y: target.y + (dy / d) * stop };
  },
  byId: { wilds: { city: false, pvpEnabled: true, pvpLevelMin: 1 } },
};
const handlers = {};
const battlegrounds = new Map();
const registerStats = (player) =>
  (player.pvpStats ||= { kills: 0, deaths: 0, honor: 0 });
registerPvpCommands(handlers, {
  repo: { getPlayer: (id) => players.get(id) || null },
  world,
  pvpAllowed: () => true,
  combat: {
    executePvpBasic: (_p, target) => {
      target.dead = true;
      return [
        true,
        "Defeated.",
        { pvp: true, killed: true, targetId: target.id },
      ];
    },
    executePvpCast: (_p, _a, _id, opponents) => {
      const target = opponents[0];
      if (target) target.dead = true;
      return [true, "Ability hits.", { pvp: true, kills: target ? 1 : 0 }];
    },
  },
  finishDuel: () => {
    finishDuelCalls++;
  },
  arenaMatches: new Map(),
  battlegrounds,
  pvpStats: registerStats,
  rollDamage: () => ({ damage: 1000, crit: false }),
  finishArena: () => {},
  abilities: { test_strike: { id: "test_strike" } },
});
const attacker = {
  id: "a",
  name: "Attacker",
  online: true,
  dead: false,
  zone: "wilds",
  x: 0.5,
  y: 0.5,
  level: 10,
  pvp: { id: "duel-1", state: "active", opponentId: "b" },
  targetPlayerId: "b",
  combat: { manualMove: false },
  hp: 100,
  maxHp: 100,
};
const target = {
  id: "b",
  name: "Target",
  online: true,
  dead: false,
  zone: "wilds",
  x: 0.51,
  y: 0.5,
  level: 10,
  pvp: { id: "duel-1", state: "active", opponentId: "a" },
  targetPlayerId: "a",
  combat: { manualMove: false },
  hp: 100,
  maxHp: 100,
};
players.set(attacker.id, attacker);
players.set(target.id, target);
await handlers.pvp_attack(attacker, {});
assert.equal(finishDuelCalls, 1, "basic PvP kill detail must finish the duel");
assert.equal(target.dead, true, "basic PvP kill marks the target dead");

finishDuelCalls = 0;
target.dead = false;
attacker.pvp = { id: "duel-2", state: "active", opponentId: "b" };
target.pvp = { id: "duel-2", state: "active", opponentId: "a" };
await handlers.pvp_cast(attacker, { abilityId: "test_strike" });
assert.equal(
  finishDuelCalls,
  1,
  "PvP ability kill detail must finish the duel",
);

finishDuelCalls = 0;
target.dead = false;
attacker.x = 0.1;
attacker.y = 0.5;
target.x = 0.5;
target.y = 0.5;
attacker.pvp = { id: "duel-3", state: "active", opponentId: "b" };
target.pvp = { id: "duel-3", state: "active", opponentId: "a" };
attacker.combat = {
  manualMove: true,
  autoApproach: false,
  approachSatisfied: false,
};
const approach = await handlers.pvp_attack(attacker, {});
assert.equal(
  approach[0],
  true,
  "out-of-range PvP attack starts approach successfully",
);
assert.equal(attacker.combat.autoApproach, true, "PvP approach owns movement");
assert.equal(attacker.moveState, "moving", "PvP approach begins movement");
assert.ok(
  attacker.targetX > 0.1 && attacker.targetX < target.x,
  "PvP stand point is between the attacker and current target",
);

const bg = {
  id: "bg-test",
  state: "active",
  red: [attacker.id],
  blue: [target.id],
};
battlegrounds.set(bg.id, bg);
attacker.battlegroundId = bg.id;
target.battlegroundId = bg.id;
attacker.x = 0.5;
attacker.y = 0.5;
target.x = 0.51;
target.y = 0.5;
target.dead = false;
target.hp = 1;
target.maxHp = 100;
attacker.combat = { gcdReadyAt: 0 };
attacker.pvpStats = { kills: 0, deaths: 0, honor: 0 };
target.pvpStats = { kills: 0, deaths: 0, honor: 0 };
const bgHit = await handlers.pvp_battleground_attack(attacker, {});
assert.equal(bgHit[0], true, "valid battleground attack succeeds");
assert.equal(attacker.pvpStats.kills, 1, "battleground kill is credited");
assert.equal(target.pvpStats.deaths, 1, "battleground death is credited");
attacker.x = 0.5;
target.x = 0.82;
target.dead = false;
target.hp = 100;
const bgApproach = await handlers.pvp_battleground_attack(attacker, {
  targetId: target.id,
});
assert.equal(
  bgApproach[0],
  true,
  "out-of-range battleground attack starts approach",
);
assert.equal(
  bgApproach[2].approaching,
  true,
  "battleground approach is reported to the client",
);
assert.equal(
  attacker.targetPlayerId,
  target.id,
  "battleground approach tracks the selected enemy",
);
const outsider = {
  ...attacker,
  id: "outsider",
  battlegroundId: bg.id,
  pvpStats: { kills: 0, deaths: 0, honor: 0 },
};
assert.equal(
  (await handlers.pvp_battleground_attack(outsider, {}))[0],
  false,
  "non-member cannot attack from a battleground ID alone",
);

const { createTradeService } = await import(
  `file://${out}/server/runtime/TradeService.js`
);
const itemDefs = {
  ore: { id: "ore", type: "material", tradeable: true },
  herb: { id: "herb", type: "material", tradeable: true },
  bound: { id: "bound", type: "material", soulbound: true },
};
const inv = {
  def: (id) => itemDefs[id] || null,
  remove(p, itemId, qty) {
    let left = qty;
    for (const stack of p.inventory) {
      if (stack.itemId !== itemId || stack.qty <= 0) continue;
      const take = Math.min(stack.qty, left);
      stack.qty -= take;
      left -= take;
      if (left <= 0) break;
    }
    p.inventory = p.inventory.filter((x) => x.qty > 0);
    return left <= 0;
  },
  give(p, itemId, qty) {
    const stack = p.inventory.find((x) => x.itemId === itemId);
    if (stack) stack.qty += qty;
    else p.inventory.push({ itemId, qty });
    return true;
  },
  recalc() {},
};
const a = {
  id: "ta",
  name: "Trader A",
  online: true,
  dead: false,
  zone: "wilds",
  x: 0.1,
  y: 0.1,
  gold: 100,
  inventory: [{ itemId: "ore", qty: 5 }],
};
const b = {
  id: "tb",
  name: "Trader B",
  online: true,
  dead: false,
  zone: "wilds",
  x: 0.11,
  y: 0.1,
  gold: 50,
  inventory: [{ itemId: "herb", qty: 3 }],
};
const tradePlayers = new Map([
  [a.id, a],
  [b.id, b],
]);
let persistShouldFail = false;
const trade = createTradeService({
  inv,
  repo: {
    getPlayer: (id) => tradePlayers.get(id) || null,
    async savePlayersAtomically() {
      if (persistShouldFail) throw new Error("simulated persistence failure");
    },
  },
  world: { normalizedMeters: (_zone, meters) => Number(meters) / 1000 },
  quest: { onTrade() {} },
});
const session = {
  id: "trade-1",
  a: a.id,
  b: b.id,
  offers: { [a.id]: { gold: 0, items: [] }, [b.id]: { gold: 0, items: [] } },
  locked: { [a.id]: false, [b.id]: false },
  confirmed: { [a.id]: false, [b.id]: false },
  expiresAt: Date.now() + 60_000,
};
trade.tradeSessions.set(session.id, session);
assert.equal(
  trade.tradeOffer(a, { itemId: "ore", qty: 2 })[0],
  true,
  "trade item can be offered",
);
assert.equal(session.offers[a.id].items[0].qty, 2, "offer quantity increments");
assert.equal(
  trade.tradeOffer(a, { itemId: "ore", qty: -1 })[0],
  true,
  "trade item quantity can be reduced",
);
assert.equal(
  session.offers[a.id].items[0].qty,
  1,
  "offer quantity decrements without cancelling trade",
);
assert.equal(
  trade.tradeOffer(a, { itemId: "bound", qty: 1 })[0],
  false,
  "soulbound items cannot be offered",
);

session.offers[a.id] = { gold: 20, items: [{ itemId: "ore", qty: 1 }] };
session.offers[b.id] = { gold: 5, items: [{ itemId: "herb", qty: 2 }] };
session.locked[a.id] = session.locked[b.id] = true;
session.confirmed[a.id] = session.confirmed[b.id] = true;
const completed = await trade.completeTrade(session);
assert.equal(
  completed[0],
  true,
  "a valid locked and confirmed trade completes",
);
assert.equal(a.gold, 85);
assert.equal(b.gold, 65);
assert.equal(a.inventory.find((x) => x.itemId === "ore").qty, 4);
assert.equal(a.inventory.find((x) => x.itemId === "herb").qty, 2);
assert.equal(b.inventory.find((x) => x.itemId === "herb").qty, 1);
assert.equal(b.inventory.find((x) => x.itemId === "ore").qty, 1);

const rollback = {
  id: "trade-rollback",
  a: a.id,
  b: b.id,
  offers: {
    [a.id]: { gold: 10, items: [{ itemId: "ore", qty: 1 }] },
    [b.id]: { gold: 0, items: [] },
  },
  locked: { [a.id]: true, [b.id]: true },
  confirmed: { [a.id]: true, [b.id]: true },
  expiresAt: Date.now() + 60_000,
};
const before = {
  aGold: a.gold,
  bGold: b.gold,
  aInv: structuredClone(a.inventory),
  bInv: structuredClone(b.inventory),
};
persistShouldFail = true;
const failed = await trade.completeTrade(rollback);
assert.equal(failed[0], false, "failed persistence rejects the trade");
assert.equal(a.gold, before.aGold);
assert.equal(b.gold, before.bGold);
assert.deepEqual(a.inventory, before.aInv);
assert.deepEqual(b.inventory, before.bInv);

console.log(
  "pvp-trade-regressions: PASS — PvP kill resolution and approach, trade quantity edits, soulbound rejection, atomic transfer, and rollback",
);
