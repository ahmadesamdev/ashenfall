import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ashenfall-quest-ledger-"));
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const { registerQuestStoryCommands } = await import(
    pathToFileURL(path.resolve("server/runtime/commands/QuestStoryCommands.ts"))
      .href
  );
  const repo = new MemoryRepository(path.join(temp, "players.json"));
  const player = {
    id: "quest-player",
    zone: "stonehold",
    x: 10,
    y: 10,
    level: 5,
    xp: 10,
    gold: 2,
    inventory: [],
    quests: {
      story: { accepted: true, complete: true, claimed: false, progress: 1 },
    },
    storyFlags: {},
  };
  repo.savePlayer(player);
  let rewardCalls = 0;
  const q = { id: "story", name: "A Test Story", giver: "npc-1" };
  const quest = {
    get: (id) => (id === "story" ? q : null),
    state: (p, id) => p.quests[id],
    claim: (p, id) => {
      const state = p.quests[id];
      if (!state?.accepted)
        return [false, "Accept this quest from the quest giver first."];
      if (!state.complete) return [false, "Objective incomplete."];
      if (state.claimed) return [false, "Quest reward already claimed."];
      state.claimed = true;
      state.accepted = false;
      return [
        true,
        { reward: { xp: 20, gold: 5, item: null }, story: "Done", next: null },
      ];
    },
  };
  const handlers = {};
  registerQuestStoryCommands(handlers, {
    repo,
    quest,
    reward: (p, xp, gold) => {
      rewardCalls++;
      p.xp += xp;
      p.gold += gold;
    },
    world: {
      zoneNpcs: () => [{ id: "npc-1", x: 10, y: 10 }],
      normalizedMeters: (_zone, n) => n,
    },
    npcInteractionService: { isActiveNpcNearby: () => true },
    playerMutations: { withPlayer: (_id, fn) => fn() },
  });
  const result = await handlers.turnin_quest(player, { questId: "story" });
  assert.equal(result[0], true, "first quest turn-in succeeds");
  assert.equal(player.xp, 30, "XP reward applied");
  assert.equal(player.gold, 7, "gold reward applied");
  assert.equal(player.quests.story.claimed, true, "quest state marked claimed");
  assert.ok(
    player._rewardLedger.includes("quest:quest-player:story:claim"),
    "stable reward key recorded",
  );
  assert.equal(rewardCalls, 1, "reward helper called once");

  player.quests.story = {
    accepted: true,
    complete: true,
    claimed: false,
    progress: 1,
  };
  player.xp = 30;
  player.gold = 7;
  const duplicate = await handlers.turnin_quest(player, { questId: "story" });
  assert.equal(
    duplicate[0],
    false,
    "durable ledger rejects stale duplicate claim",
  );
  assert.equal(player.xp, 30, "duplicate rollback does not add XP");
  assert.equal(player.gold, 7, "duplicate rollback does not add gold");
  assert.equal(
    player.quests.story.claimed,
    false,
    "stale quest snapshot restored after ledger rejection",
  );
  assert.equal(
    rewardCalls,
    2,
    "reward computation can run before durable rejection but state is rolled back",
  );

  player._rewardLedger = [];
  player.quests.story = {
    accepted: true,
    complete: true,
    claimed: false,
    progress: 1,
  };
  const before = structuredClone(player);
  const saveRewardOnce = repo.savePlayerRewardOnce.bind(repo);
  repo.savePlayerRewardOnce = () => {
    throw new Error("simulated disk failure");
  };
  const failed = await handlers.turnin_quest(player, { questId: "story" });
  assert.equal(failed[0], false, "failed persistence is reported as failure");
  assert.equal(player.xp, before.xp, "XP restored after failed save");
  assert.equal(player.gold, before.gold, "gold restored after failed save");
  assert.deepEqual(
    player.quests,
    before.quests,
    "quest state restored after failed save",
  );
  assert.equal(
    player._rewardLedger.length,
    0,
    "no reward marker remains after failed save",
  );
  repo.savePlayerRewardOnce = saveRewardOnce;
  repo.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const handler = fs.readFileSync(
  "server/runtime/commands/QuestStoryCommands.ts",
  "utf8",
);
assert.match(
  handler,
  /const rewardKey=`quest:\$\{String\(p\.id\)\}:\$\{String\(cmd\.questId\)\}:claim`/,
  "quest claim uses stable per-player/per-quest key",
);
assert.match(
  handler,
  /await repo\.savePlayerRewardOnce\(p,rewardKey\)/,
  "turn-in awaits durable atomic reward commit",
);
assert.doesNotMatch(
  handler,
  /p\.lastQuestClaim=[\s\S]{0,220}repo\.savePlayerNow\(p\)/,
  "turn-in no longer uses non-idempotent save path",
);
console.log("Audit Batch 25 passed: 16 assertions.");
