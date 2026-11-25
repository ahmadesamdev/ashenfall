import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const economy = read("server/economy/Economy.ts");
const systemMailCapacity = read("server/economy/SystemMailCapacity.ts");
const index = read("server/index.ts");
const victory = read("server/runtime/CombatVictoryService.ts");
const coordinatorSource = read("server/shared/PlayerMutationCoordinator.ts");
let assertions = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  assertions++;
};

check(
  economy.includes(
    "if (!fromBid && buyout <= 0) return [false, 'This listing has no buyout price. Place a bid instead.'",
  ),
  "plain buy rejects missing buyout",
);
check(
  economy.includes("const buyout = Number(a.buyout) || 0;"),
  "buyout is normalized to zero rather than clamped to one",
);
check(
  !economy.includes("Math.max(1,Number(a.buyout||0))"),
  "dead one-gold fallback removed",
);
check(
  economy.includes(
    "if (bid < minimum) return [false, `Minimum bid is ${minimum} gold. No gold was charged.`",
  ),
  "below-minimum bids are rejected without silent upcharge",
);
check(
  economy.includes("if (list.length >= limit && system)"),
  "system receipt cap no longer throws immediately",
);
check(
  systemMailCapacity.includes("if (disposable < 0) return false;") &&
    systemMailCapacity.includes("list.splice(disposable, 1);"),
  "only attachment-free system receipts may be trimmed",
);
check(
  economy.includes(
    "throw new Error('Mailbox is full of unclaimed auction attachments. Claim mail before retrying.')",
  ),
  "attachment-bearing mail is never discarded to make room",
);
check(
  index.includes("createCommandHandler({bus,repo,playerMutations,npcMemory") &&
    index.includes("worldIntegration,classes,classBuilds,classStories"),
  "classBuilds object and npcMemory are wired to command handlers",
);
check(
  /createServerRuntime\([\s\S]*?worldSimulation, npcMemory, chronicle/.test(
    index,
  ),
  "npcMemory and chronicle are wired to runtime",
);
check(
  /createDungeonCompletionRewards, resolveExpiredLootRolls, createPlayer, wsSend, tradeState, playerMutations,/.test(
    index,
  ),
  "player mutation coordinator is wired to runtime",
);
check(
  victory.includes("dungeonInstanceSnapshot") &&
    victory.includes(
      "this.dungeonEngine.instances.set(dungeonInstanceId, dungeonInstanceSnapshot)",
    ),
  "dungeon instance is restored if durable reward commit fails",
);
check(
  coordinatorSource.includes("AsyncLocalStorage") &&
    coordinatorSource.includes("if (held?.has(key)) return await fn();"),
  "same-player nested mutation is re-entrant",
);

const { PlayerMutationCoordinator } =
  await import("../../server/shared/PlayerMutationCoordinator.ts");
const coordinator = new PlayerMutationCoordinator();
const nested = await Promise.race([
  coordinator.withPlayer("reentrant-player", () =>
    coordinator.withPlayer("reentrant-player", () => "completed"),
  ),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("same-player nested lock hung")), 500),
  ),
]);
check(nested === "completed", "same-player nested mutation completes");
check(coordinator.pendingKeys === 0, "lock is released after nested mutation");
console.log(`Audit Batch 35 passed: ${assertions} assertions.`);
