import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";
import { registerQuestStoryCommands } from "../../server/runtime/commands/QuestStoryCommands.ts";

const source = fs.readFileSync(
  "server/runtime/commands/QuestStoryCommands.ts",
  "utf8",
);
assert.match(
  source,
  /playerMutations\?\.withPlayer/,
  "quest turn-ins run under the shared player mutation lock",
);
assert.match(
  source,
  /await repo\.savePlayerRewardOnce\(p,rewardKey\)/,
  "quest rewards use the durable idempotency transaction",
);
assert.match(
  source,
  /Your quest reward could not be saved\. Nothing was consumed/,
  "failed persistence reports that the turn-in was rolled back",
);

function makeHarness({ failSave = false } = {}) {
  const player = {
    id: "p1",
    name: "Tester",
    level: 2,
    xp: 0,
    gold: 0,
    inventory: [{ itemId: "quest_token", qty: 1 }],
    quests: {
      q1: { accepted: true, complete: true, claimed: false, progress: 1 },
      q2: { accepted: false, complete: false, claimed: false, progress: 0 },
    },
    storyFlags: {},
    statPoints: 0,
  };
  let saves = 0;
  const rewardKeys = new Set();
  const repo = {
    savePlayerRewardOnce: async (p, key) => {
      saves++;
      if (failSave) throw new Error("simulated save failure");
      if (rewardKeys.has(key)) return false;
      rewardKeys.add(key);
      return true;
    },
  };
  const quest = {
    get: (id) =>
      id === "q1" ? { id, name: "A Test Quest", giver: "npc1" } : null,
    state: (p, id) =>
      (p.quests[id] ||= {
        accepted: false,
        complete: false,
        claimed: false,
        progress: 0,
      }),
    claim: (p, id) => {
      const st = p.quests[id];
      if (!st?.accepted) return [false, "Accept this quest first."];
      if (!st.complete) return [false, "Objective incomplete."];
      if (st.claimed) return [false, "Quest reward already claimed."];
      const token = p.inventory.findIndex((i) => i.itemId === "quest_token");
      if (token >= 0) p.inventory.splice(token, 1);
      st.claimed = true;
      st.accepted = false;
      return [
        true,
        {
          reward: { xp: 10, gold: 5, item: "potion" },
          next: "q2",
          story: "Test story",
        },
      ];
    },
  };
  const handlers = {};
  registerQuestStoryCommands(handlers, {
    repo,
    quest,
    reward: (p, xp, gold, items) => {
      p.xp += xp;
      p.gold += gold;
      for (const id of items) p.inventory.push({ itemId: id, qty: 1 });
    },
    playerMutations: new PlayerMutationCoordinator(),
    world: {
      zoneNpcs: () => [{ id: "npc1", x: 0, y: 0 }],
      normalizedMeters: (_zone, n) => n,
    },
    npcInteractionService: { isActiveNpcNearby: () => true },
  });
  return {
    player,
    handler: handlers.turnin_quest,
    get saves() {
      return saves;
    },
  };
}

const good = makeHarness();
const success = await good.handler(good.player, { questId: "q1" });
assert.equal(success[0], true, "successful quest turn-in returns success");
assert.equal(good.player.gold, 5, "quest gold is applied");
assert.equal(good.player.xp, 10, "quest XP is applied");
assert.equal(good.player.quests.q1.claimed, true, "quest is marked claimed");
assert.equal(
  good.player.quests.q2.accepted,
  true,
  "next story quest is activated",
);
assert.equal(
  good.saves,
  1,
  "successful turn-in awaits one atomic durable reward commit",
);
const duplicate = await good.handler(good.player, { questId: "q1" });
assert.equal(duplicate[0], false, "duplicate claim is rejected");
assert.equal(good.player.gold, 5, "duplicate claim does not award gold again");

const broken = makeHarness({ failSave: true });
const before = structuredClone(broken.player);
const failed = await broken.handler(broken.player, { questId: "q1" });
assert.equal(failed[0], false, "failed persistence is surfaced to the caller");
assert.deepEqual(
  broken.player,
  before,
  "failed save restores inventory, quest state, rewards, and story flags",
);
assert.equal(
  broken.saves,
  1,
  "failed turn-in attempts one atomic durable reward commit before rollback",
);

const contention = makeHarness();
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const mutations = new PlayerMutationCoordinator();
const handlers = {};
registerQuestStoryCommands(handlers, {
  repo: {
    savePlayerRewardOnce: async () => {
      await gate;
      return true;
    },
  },
  quest: {
    get: (id) =>
      id === "q1" ? { id, name: "A Test Quest", giver: "npc1" } : null,
    state: (p, id) =>
      (p.quests[id] ||= {
        accepted: false,
        complete: false,
        claimed: false,
        progress: 0,
      }),
    claim: (p, id) => {
      const st = p.quests[id];
      if (!st.accepted) return [false, "Accept this quest first."];
      if (st.claimed) return [false, "Quest reward already claimed."];
      st.claimed = true;
      st.accepted = false;
      return [true, { reward: { xp: 1, gold: 1 }, next: null }];
    },
  },
  reward: (p, xp, gold) => {
    p.xp += xp;
    p.gold += gold;
  },
  playerMutations: mutations,
  world: {
    zoneNpcs: () => [{ id: "npc1", x: 0, y: 0 }],
    normalizedMeters: (_z, n) => n,
  },
  npcInteractionService: { isActiveNpcNearby: () => true },
});
const concurrentPlayer = {
  id: "p1",
  zone: "z",
  x: 0,
  y: 0,
  xp: 0,
  gold: 0,
  quests: {
    q1: { accepted: true, complete: true, claimed: false, progress: 1 },
  },
  inventory: [],
  storyFlags: {},
};
const first = handlers.turnin_quest(concurrentPlayer, { questId: "q1" });
const second = handlers.turnin_quest(concurrentPlayer, { questId: "q1" });
await Promise.resolve();
await Promise.resolve();
release();
const results = await Promise.all([first, second]);
assert.equal(
  results.filter((r) => r[0]).length,
  1,
  "only one of two simultaneous turn-ins succeeds",
);
assert.equal(
  concurrentPlayer.gold,
  1,
  "concurrent duplicate turn-in awards once",
);
assert.equal(mutations.pendingKeys, 0, "turn-in lock is released");

console.log(
  "Audit batch 22 passed (16 assertions: success, duplicate claim, save rollback, and concurrent turn-in).",
);
