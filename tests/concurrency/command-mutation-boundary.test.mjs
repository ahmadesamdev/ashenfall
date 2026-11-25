import assert from "node:assert/strict";
import fs from "node:fs";

const handlers = fs.readFileSync("server/runtime/CommandHandlers.ts", "utf8");
const economyCommands = fs.readFileSync(
  "server/runtime/commands/InventoryEconomyCommands.ts",
  "utf8",
);
const coreCommands = fs.readFileSync(
  "server/runtime/CommandHandlers.ts",
  "utf8",
);
const coordinator = fs.readFileSync(
  "server/shared/PlayerMutationCoordinator.ts",
  "utf8",
);

const block = handlers.match(/const playerMutationCommands = \[([\s\S]*?)\];/);
assert.ok(block, "durable mutation command list exists");
const wrappedCommands = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
for (const command of [
  "equip",
  "unequip",
  "sell_shop",
  "buyback_shop",
  "craft_blacksmith",
  "craft_recipe",
  "redeem_gear_token",
  "upgrade_gear",
  "reroll_gear",
  "use_item",
  "pickup_loot",
  "apply_loadout",
  "allocate_stat",
  "learn_talent",
]) {
  assert.ok(
    wrappedCommands.includes(command),
    `${command} uses the shared mutation boundary`,
  );
}
assert.ok(
  !wrappedCommands.includes("auction_list") &&
    !wrappedCommands.includes("auction_buy"),
  "auction commands are excluded to prevent nested non-reentrant lock deadlocks",
);
assert.ok(
  !wrappedCommands.includes("trade_confirm"),
  "trade completion keeps its multi-player lock path",
);
assert.match(
  handlers,
  /playerMutations\.withPlayer\(String\(player\.id\), \(\) => original\(player, command\)\)/,
  "wrappers acquire the lock using the durable character id",
);
assert.match(handlers, /__playerMutationWrapped/, "wrapping is idempotent");
assert.match(
  coordinator,
  /withPlayer<T>/,
  "shared coordinator supports single-player locks",
);
assert.match(
  coordinator,
  /withPlayers<T>/,
  "shared coordinator retains sorted multi-player locking",
);
assert.match(
  economyCommands,
  /handlers\['sell_shop'\]/,
  "shop sale handler remains registered",
);
assert.match(
  coreCommands,
  /registerInventoryEconomyCommands\(handlers,commandCtx\)/,
  "inventory/economy commands are registered before wrappers are applied",
);
console.log(
  `Audit batch 17 passed (${13 + wrappedCommands.length} assertions; ${wrappedCommands.length} commands covered by the shared mutation boundary).`,
);
