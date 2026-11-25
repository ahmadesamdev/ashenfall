import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const source = fs.readFileSync(
  "server/runtime/CombatVictoryService.ts",
  "utf8",
);
assert.match(
  source,
  /resolvingEncounters/,
  "encounter completion reserves an in-flight id before awaiting locks",
);
assert.match(
  source,
  /await this\.repo\.savePlayersWithRewardsOnce\(members,keys\)/,
  "dungeon completion awaits durable multi-player reward-key persistence",
);
assert.match(
  source,
  /withPlayers\(lockIds,execute\)/,
  "encounter rewards serialize all participant mutations",
);
assert.match(
  source,
  /completionPersistenceFailed/,
  "persistence failures are visible on the result",
);
const { CombatVictoryService } =
  await import("../../server/runtime/CombatVictoryService.ts");
const mutations = new PlayerMutationCoordinator();
const player = {
  id: "p1",
  level: 10,
  gold: 0,
  xp: 0,
  dungeon: { id: "d1", instanceId: "inst1" },
  lastDungeonResult: null,
};
const other = {
  id: "p2",
  level: 10,
  gold: 0,
  xp: 0,
  dungeon: { id: "d1", instanceId: "inst1" },
};
const players = new Map([
  ["p1", player],
  ["p2", other],
]);
const encounter = {
  id: "enc1",
  state: "won",
  dungeonId: "d1",
  participants: ["p1", "p2"],
  enemy: {
    id: "boss1",
    name: "Boss",
    ai: "boss",
    level: 10,
    xp: 0,
    gold: 0,
    loot: [],
  },
};
const encounters = new Map([["enc1", encounter]]);
let saveCalls = 0;
const repo = {
  getPlayer: (id) => players.get(String(id)),
  savePlayersWithRewardsOnce: async (members, keys) => {
    saveCalls++;
    if (saveCalls === 1) throw new Error("simulated save failure");
    for (let i = 0; i < members.length; i++) {
      const ledger = Array.isArray(members[i]._rewardLedger)
        ? members[i]._rewardLedger
        : [];
      if (ledger.includes(keys[i])) return false;
    }
    for (let i = 0; i < members.length; i++)
      members[i]._rewardLedger = [...(members[i]._rewardLedger || []), keys[i]];
    return true;
  },
};
let rewards = 0;
const service = new CombatVictoryService({
  combat: { get: (id) => encounters.get(id), encounters },
  world: { players: [player, other], travel: () => {} },
  dungeonEngine: {
    onVictory: () => ({
      complete: true,
      name: "Test Dungeon",
      instanceId: "inst1",
      dungeonId: "d1",
      reward: { xp: 0, gold: 0, gearRolls: 0 },
      rewardMemberIds: ["p1", "p2"],
      returnZones: {},
    }),
  },
  repo,
  playerMutations: mutations,
  dungeons: [],
  rewardMobKill: (p) => {
    rewards++;
    p.gold += 1;
  },
  reward: () => {},
  awardEncounterLoot: () => {},
  createDungeonCompletionRewards: (members) =>
    members.map((m) => {
      m.dungeonRewardChests ||= [];
      let c = m.dungeonRewardChests.find(
        (x) => x.id === `dchest_inst1_${m.id}`,
      );
      if (!c) {
        c = {
          id: `dchest_inst1_${m.id}`,
          claimedAt: null,
          rewards: { xp: 0, gold: 0, items: [] },
        };
        m.dungeonRewardChests.push(c);
      }
      return c;
    }),
});
const originalError = console.error;
console.error = () => {};
const concurrent = await Promise.all([
  service.encounterVictory(player, "enc1"),
  service.encounterVictory(player, "enc1"),
]);
console.error = originalError;
assert.equal(
  concurrent.filter(Boolean).length,
  0,
  "both concurrent callers report no successful completion when the one persistence attempt fails",
);
assert.equal(
  saveCalls,
  1,
  "only one persistence attempt is made for concurrent victory callbacks",
);
assert.equal(player.gold, 0, "failed persistence restores player reward state");
assert.equal(
  encounters.has("enc1"),
  true,
  "failed completion leaves encounter available for retry",
);
assert.equal(
  await service.encounterVictory(player, "enc1"),
  true,
  "retry can complete after transient persistence failure",
);
assert.equal(saveCalls, 2, "retry persists completion");
assert.equal(player.gold, 1, "successful retry applies reward once");
assert.equal(
  other.dungeonRewardChests.length,
  1,
  "each participant gets one idempotent reward chest",
);
assert.equal(
  encounters.has("enc1"),
  false,
  "successful completion consumes encounter",
);
assert.equal(
  mutations.pendingKeys,
  0,
  "participant locks release after success and failure",
);
console.log(
  "Audit batch 21 passed (12 assertions including duplicate callback, persistence rollback and retry).",
);
