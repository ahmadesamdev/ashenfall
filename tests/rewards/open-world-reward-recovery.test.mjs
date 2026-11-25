import assert from "node:assert/strict";
import { OpenWorldDirector } from "../../server/world/OpenWorldDirector.ts";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const player = {
  id: "open-world-player",
  hasCharacter: true,
  online: true,
  zone: "gloamwood",
  gold: 20,
  totalXp: 100,
  factionReputation: {},
  openWorld: { regions: {} },
  _rewardLedger: [],
};
const durableKeys = new Set();
let failNext = true;
let saveAttempts = 0;
let worldState = null;
let stateWrites = 0;
const repo = {
  getPlayer: (id) => (id === player.id ? player : null),
  loadWorldState(id) {
    return id === "open-world-activity-v1" ? worldState : null;
  },
  saveWorldState(data, id) {
    if (id === "open-world-activity-v1") worldState = structuredClone(data);
  },
  async saveWorldStateNow(data, id) {
    assert.equal(id, "open-world-activity-v1");
    worldState = structuredClone(data);
    stateWrites++;
  },
  async savePlayerRewardOnce(p, key) {
    assert.ok(
      worldState?.zones?.gloamwood?.id === contract.id,
      "contract identity is durable before payout",
    );
    saveAttempts++;
    if (failNext) {
      failNext = false;
      throw new Error("injected durable write failure");
    }
    if (durableKeys.has(key)) return false;
    durableKeys.add(key);
    p._rewardLedger = [...(p._rewardLedger || []), key].slice(-5000);
    return true;
  },
};
const world = { players: [player], mobs: new Map() };
const mutations = new PlayerMutationCoordinator();
const director = new OpenWorldDirector(world, repo, mutations);
director.rewardXp = (p, xp) => {
  p.totalXp += xp;
};
const contract = {
  id: "contract-stable-id",
  zone: "gloamwood",
  name: "Lantern Watch",
  faction: "lantern_guard",
  progress: 8,
  goal: 8,
  completed: true,
  rewardStatus: "pending",
  endsAt: Date.now() + 60_000,
  contributors: { [player.id]: 3 },
  reward: { xp: 120, gold: 45, rep: 12 },
};
director.state.gloamwood = contract;

await assert.rejects(
  director.completeContract(contract),
  /injected durable write failure/,
);
assert.equal(player.gold, 20, "failed reward write rolls gold back");
assert.equal(player.totalXp, 100, "failed reward write rolls XP back");
assert.deepEqual(
  player.openWorld,
  { regions: {} },
  "failed reward write rolls region completion back",
);
assert.equal(
  director.playerMutations.isLocked(player.id),
  false,
  "failed commit releases the player lock",
);

contract.completed = false;
await director.completeContract(contract);
assert.equal(player.gold, 67, "successful retry grants gold once");
assert.equal(player.totalXp, 226, "successful retry grants XP once");
assert.equal(player.openWorld.regions.gloamwood.completed, 1);
assert.equal(durableKeys.size, 1);
await director.completeContract(contract);
assert.equal(
  player.gold,
  67,
  "replaying the same contract does not duplicate gold",
);
assert.equal(
  player.totalXp,
  226,
  "replaying the same contract does not duplicate XP",
);
assert.equal(
  saveAttempts,
  2,
  "saved reward ledger short-circuits duplicate payout",
);
assert.equal(
  director.playerMutations.pendingKeys,
  0,
  "reward locks are fully released",
);
assert.equal(
  worldState.zones.gloamwood.rewardStatus,
  "committed",
  "completed reward state is persisted",
);
assert.ok(
  stateWrites >= 2,
  "durable state is written before and after reward commit",
);
const recovered = new OpenWorldDirector(world, repo, mutations);
assert.equal(
  recovered.state.gloamwood.id,
  contract.id,
  "active contract ID survives restart",
);
assert.equal(
  recovered.state.gloamwood.rewardStatus,
  "committed",
  "committed status survives restart",
);
console.log(
  "open-world reward recovery: PASS — failed write rolls back, retry commits once, contract state survives restart, stable reward key prevents duplicate payout",
);

const p1 = {
  id: "recovery-p1",
  hasCharacter: true,
  online: false,
  gold: 10,
  totalXp: 5,
  factionReputation: {},
  openWorld: { regions: {} },
  _rewardLedger: [],
};
const p2 = {
  id: "recovery-p2",
  hasCharacter: true,
  online: false,
  gold: 10,
  totalXp: 5,
  factionReputation: {},
  openWorld: { regions: {} },
  _rewardLedger: [],
};
let partialWorldState = null;
let partialAttempts = 0;
const partialKeys = new Set();
const partialRepo = {
  getPlayer(id) {
    return id === p1.id ? p1 : id === p2.id ? p2 : null;
  },
  loadWorldState(id) {
    return id === "open-world-activity-v1" ? partialWorldState : null;
  },
  saveWorldState(data, id) {
    if (id === "open-world-activity-v1")
      partialWorldState = structuredClone(data);
  },
  async saveWorldStateNow(data, id) {
    assert.equal(id, "open-world-activity-v1");
    partialWorldState = structuredClone(data);
  },
  async savePlayerRewardOnce(p, key) {
    partialAttempts++;
    if (partialAttempts === 2)
      throw new Error("injected second-contributor failure");
    if (partialKeys.has(key)) return false;
    partialKeys.add(key);
    p._rewardLedger = [...(p._rewardLedger || []), key];
    return true;
  },
};
const partialMutations = new PlayerMutationCoordinator();
const firstDirector = new OpenWorldDirector(
  { players: [], mobs: new Map() },
  partialRepo,
  partialMutations,
);
firstDirector.rewardXp = (p, xp) => {
  p.totalXp += xp;
};
const partialContract = {
  id: "restart-reward-contract",
  zone: "gloamwood",
  name: "Restart Recovery",
  faction: "lantern_guard",
  progress: 8,
  goal: 8,
  completed: true,
  rewardStatus: "pending",
  endsAt: Date.now() + 60_000,
  contributors: { [p1.id]: 2, [p2.id]: 1 },
  reward: { xp: 100, gold: 40, rep: 10 },
};
firstDirector.state.gloamwood = partialContract;
await assert.rejects(
  firstDirector.completeContract(partialContract),
  /injected second-contributor failure/,
);
assert.equal(
  p1.gold,
  51,
  "first contributor payout is durably committed before failure",
);
assert.equal(
  p2.gold,
  10,
  "second contributor has not been paid after injected failure",
);
assert.equal(
  partialWorldState.zones.gloamwood.rewardStatus,
  "pending",
  "partial payout leaves contract recoverable",
);
const restartedDirector = new OpenWorldDirector(
  { players: [], mobs: new Map() },
  partialRepo,
  partialMutations,
);
restartedDirector.rewardXp = (p, xp) => {
  p.totalXp += xp;
};
await restartedDirector.completeContract(restartedDirector.state.gloamwood);
assert.equal(p1.gold, 51, "recovery does not duplicate first contributor gold");
assert.equal(
  p1.totalXp,
  107,
  "recovery does not duplicate first contributor XP",
);
assert.equal(p2.gold, 50, "recovery grants second contributor gold");
assert.equal(p2.totalXp, 105, "recovery grants second contributor XP");
assert.equal(
  restartedDirector.state.gloamwood.rewardStatus,
  "committed",
  "recovered contract is marked committed",
);
console.log(
  "open-world partial-restart recovery: PASS — already-paid contributors are not duplicated and remaining payouts resume after restart",
);

const rarePlayer = {
  id: "rare-recovery-player",
  hasCharacter: true,
  zone: "gloamwood",
  gold: 0,
  totalXp: 0,
  factionReputation: {},
  openWorld: { regions: {}, rareKills: {} },
  _rewardLedger: [],
};
let rareState = null;
let rareSaveAttempts = 0;
const rareKeys = new Set();
const rareRepo = {
  getPlayer(id) {
    return id === rarePlayer.id ? rarePlayer : null;
  },
  loadWorldState(id) {
    return id === "open-world-activity-v1" ? rareState : null;
  },
  saveWorldState(data, id) {
    if (id === "open-world-activity-v1") rareState = structuredClone(data);
  },
  async saveWorldStateNow(data, id) {
    assert.equal(id, "open-world-activity-v1");
    rareState = structuredClone(data);
  },
  async savePlayerRewardOnce(p, key) {
    rareSaveAttempts++;
    if (rareSaveAttempts === 1)
      throw new Error("injected rare-hunt persistence failure");
    if (rareKeys.has(key)) return false;
    rareKeys.add(key);
    p._rewardLedger = [...(p._rewardLedger || []), key];
    return true;
  },
};
const rareMutations = new PlayerMutationCoordinator();
const rareDirector = new OpenWorldDirector(
  { players: [rarePlayer], mobs: new Map() },
  rareRepo,
  rareMutations,
);
const rareDef = { type: "gloamwood_rare_test", name: "Rare Test Stalker" };
await assert.rejects(
  rareDirector.onRareKill(rarePlayer, rareDef, "mob-instance-rare-1"),
  /injected rare-hunt persistence failure/,
);
assert.equal(
  rareState.pendingRareRewards.length,
  1,
  "failed rare payout remains durably queued",
);
assert.equal(
  rarePlayer.factionReputation.lantern_guard || 0,
  0,
  "failed rare payout rolls reputation back",
);
const rareRestart = new OpenWorldDirector(
  { players: [rarePlayer], mobs: new Map() },
  rareRepo,
  rareMutations,
);
assert.equal(
  rareRestart.pendingRareRewards.size,
  1,
  "pending rare reward restores after restart",
);
await rareRestart.onRareKill(rarePlayer, rareDef, "mob-instance-rare-1");
assert.equal(
  rarePlayer.openWorld.rareKills.gloamwood_rare_test,
  1,
  "rare kill stat is applied once",
);
assert.equal(
  rarePlayer.factionReputation.lantern_guard,
  45,
  "rare reputation is applied once",
);
await rareRestart.onRareKill(rarePlayer, rareDef, "mob-instance-rare-1");
assert.equal(
  rarePlayer.openWorld.rareKills.gloamwood_rare_test,
  1,
  "replaying the same rare kill cannot duplicate stats",
);
assert.equal(
  rarePlayer.factionReputation.lantern_guard,
  45,
  "replaying the same rare kill cannot duplicate reputation",
);
assert.equal(
  rareRestart.pendingRareRewards.size,
  0,
  "committed rare reward is removed from pending recovery",
);
console.log(
  "rare-hunt reward recovery: PASS — durable pending record survives failure/restart and duplicate event cannot double grant reputation",
);

const latePlayer = {
  id: "rare-late-state-player",
  hasCharacter: true,
  zone: "gloamwood",
  gold: 0,
  totalXp: 0,
  factionReputation: {},
  openWorld: { regions: {}, rareKills: {} },
  _rewardLedger: [],
};
let lateState = null;
let lateKey = null;
let failStateAfterReward = true;
const lateRepo = {
  getPlayer(id) {
    return id === latePlayer.id ? latePlayer : null;
  },
  loadWorldState(id) {
    return id === "open-world-activity-v1" ? lateState : null;
  },
  saveWorldState(data, id) {
    if (id === "open-world-activity-v1") lateState = structuredClone(data);
  },
  async saveWorldStateNow(data, id) {
    assert.equal(id, "open-world-activity-v1");
    if (
      failStateAfterReward &&
      lateKey &&
      (latePlayer._rewardLedger || []).includes(lateKey) &&
      !data.pendingRareRewards.some((x) => x.key === lateKey)
    ) {
      throw new Error("injected pending-record cleanup failure");
    }
    lateState = structuredClone(data);
  },
  async savePlayerRewardOnce(p, key) {
    lateKey = key;
    if ((p._rewardLedger || []).includes(key)) return false;
    p._rewardLedger = [...(p._rewardLedger || []), key];
    return true;
  },
};
const lateDirector = new OpenWorldDirector(
  { players: [latePlayer], mobs: new Map() },
  lateRepo,
  new PlayerMutationCoordinator(),
);
await assert.rejects(
  lateDirector.onRareKill(latePlayer, rareDef, "mob-instance-rare-late"),
  /injected pending-record cleanup failure/,
);
assert.equal(
  latePlayer.factionReputation.lantern_guard,
  45,
  "player reward remains committed after cleanup failure",
);
assert.equal(
  lateDirector.pendingRareRewards.size,
  1,
  "failed cleanup retains in-memory retry state",
);
failStateAfterReward = false;
await lateDirector.onRareKill(latePlayer, rareDef, "mob-instance-rare-late");
assert.equal(
  latePlayer.factionReputation.lantern_guard,
  45,
  "cleanup retry does not duplicate durable reward",
);
assert.equal(
  latePlayer.openWorld.rareKills.gloamwood_rare_test,
  1,
  "cleanup retry does not duplicate rare kill count",
);
assert.equal(
  lateDirector.pendingRareRewards.size,
  0,
  "pending record clears after successful checkpoint",
);
console.log(
  "rare-hunt post-commit cleanup recovery: PASS — a failed pending-record cleanup retries without duplicating the durable player reward",
);
