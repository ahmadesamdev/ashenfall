import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const index = fs.readFileSync("server/index.ts", "utf8");
const economy = fs.readFileSync("server/economy/Economy.ts", "utf8");
const trade = fs.readFileSync("server/runtime/TradeService.ts", "utf8");
assert.match(
  index,
  /const playerMutations = new PlayerMutationCoordinator\(\)/,
);
assert.match(index, /new Economy\(inv,repo,items,playerMutations\)/);
assert.match(
  index,
  /createTradeService\(\{inv,repo,world,quest,playerMutations\}\)/,
);
assert.match(
  economy,
  /this\.playerMutations\.withPlayer\(String\(playerId\), fn\)/,
);
assert.match(economy, /this\.playerMutations\.withPlayers\(playerIds, fn\)/);
assert.match(
  trade,
  /playerMutations\.withPlayers\(\[t\.a,t\.b\],\(\)=>completeTradeLocked\(t\)\)/,
);

const locks = new PlayerMutationCoordinator();
const order = [];
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const first = locks.withPlayer("p1", async () => {
  order.push("first-start");
  await gate;
  order.push("first-end");
});
const second = locks.withPlayer("p1", async () => {
  order.push("second");
});
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(
  order,
  ["first-start"],
  "same-player mutation must wait behind current mutation",
);
release();
await Promise.all([first, second]);
assert.deepEqual(order, ["first-start", "first-end", "second"]);

const crossOrder = [];
let releasePair;
const pairGate = new Promise((resolve) => {
  releasePair = resolve;
});
const pair = locks.withPlayers(["z", "a"], async () => {
  crossOrder.push("pair-start");
  await pairGate;
  crossOrder.push("pair-end");
});
const single = locks.withPlayer("a", async () => {
  crossOrder.push("single-a");
});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(
  crossOrder,
  ["pair-start"],
  "multi-player lock must block single-player mutations on a locked character",
);
releasePair();
await Promise.all([pair, single]);
assert.deepEqual(crossOrder, ["pair-start", "pair-end", "single-a"]);
assert.equal(locks.pendingKeys, 0, "released locks must be cleaned up");
console.log(
  "Audit batch 16 passed (11 assertions including real async lock contention).",
);
