import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const source = fs.readFileSync("server/world/WorldEvents.ts", "utf8");
fs.writeFileSync(
  "server/world/WorldEvents.test.ts",
  source
    .replace("'./WorldConsequenceEngine.js'", "'./WorldConsequenceEngine.ts'")
    .replace(
      "'../../shared/OwnedRollback.js'",
      "'../../shared/OwnedRollback.ts'",
    ),
);
const { WorldEvents } = await import("../../server/world/WorldEvents.test.ts");
const index = fs.readFileSync("server/index.ts", "utf8");
assert.match(
  source,
  /rewardedParticipantIds/,
  "world-event state persists per-player reward completion markers",
);
assert.match(
  source,
  /if\(pendingRewards\)\{this\.retryCompletion\(this\.active,'pending reward retry'\)/,
  "completed events retry outstanding participant rewards with rejection handling",
);
assert.match(
  source,
  /await this\.persistNow\(Date\.now\(\)\)/,
  "event completion uses durable checkpoints before rewards and after reward markers",
);
assert.match(
  source,
  /playerMutations\?\.withPlayer/,
  "world-event rewards serialize against other mutations for the same player",
);
assert.match(
  source,
  /this\.state\.active=this\.serializableEvent\(e\);this\.persist\(true,Date\.now\(\)\)/,
  "completion progress is persisted as each participant reward commits",
);
assert.match(
  index,
  /catalog\.worldEventConsequences,worldSimulation,playerMutations\)/,
  "runtime injects the shared player mutation coordinator into world events",
);

const players = new Map([
  ["a", { id: "a", hasCharacter: true, gold: 0, xp: 0 }],
  ["b", { id: "b", hasCharacter: true, gold: 0, xp: 0 }],
]);
let failFirstSaveForB = true;
const repo = {
  loadWorldState: () => null,
  saveWorldState: () => {},
  getPlayer: (id) => players.get(id),
  savePlayer: (p) => {
    players.set(p.id, p);
  },
  savePlayerRewardOnce: (p) => {
    if (p.id === "b" && failFirstSaveForB) {
      failFirstSaveForB = false;
      throw new Error("simulated persistence failure");
    }
    const ledger = Array.isArray(p._rewardLedger) ? p._rewardLedger : [];
    const key = String(
      p.lastWorldEventReward?.eventId
        ? `world-event:${p.lastWorldEventReward.eventId}:${p.id}:reward`
        : "",
    );
    if (!key) throw new Error("missing stable event reward key");
    if (ledger.includes(key)) return false;
    p._rewardLedger = [...ledger, key];
    players.set(p.id, p);
    return true;
  },
};
const world = { players: [], byId: {}, mobs: new Map(), worldEventState: {} };
const mutations = new PlayerMutationCoordinator();
const eventEngine = new WorldEvents(
  world,
  repo,
  (p, xp, gold) => {
    p.xp += xp;
    p.gold += gold;
  },
  {
    onWorldEvent: () => {},
    onWorldEventConsequence: () => {},
  },
  {},
  { record: () => {} },
  mutations,
);
eventEngine.consequence = { apply: () => {}, profile: () => ({}) };
eventEngine.active = {
  id: "event_test",
  defId: "event_test",
  name: "Test event",
  kind: "invasion",
  zone: "test_zone",
  goal: 1,
  progress: 1,
  startedAt: 1,
  endsAt: Date.now() + 10000,
  participants: ["a", "b"],
  contributions: { a: 1, b: 1 },
  reward: { xp: 10, gold: 5 },
  mobIds: [],
  completed: false,
  rewardedParticipantIds: [],
  outcomeRecorded: false,
};
await eventEngine.complete();
assert.equal(
  players.get("a").gold,
  5,
  "first participant receives the event gold once",
);
assert.equal(
  players.get("b").gold,
  0,
  "failed persistence rolls back the second participant reward",
);
assert.deepEqual(
  eventEngine.active.rewardedParticipantIds,
  ["a"],
  "only successfully committed participant is marked rewarded",
);
await Promise.all([eventEngine.complete(), eventEngine.complete()]);
assert.equal(
  players.get("a").gold,
  5,
  "re-entering completion does not duplicate a previously committed reward",
);
assert.equal(
  players.get("b").gold,
  5,
  "retry commits the previously failed participant reward",
);
assert.deepEqual(
  new Set(eventEngine.active.rewardedParticipantIds),
  new Set(["a", "b"]),
  "all participants are marked after successful commits",
);
assert.equal(
  mutations.pendingKeys,
  0,
  "player mutation locks are released after reward retries",
);
fs.unlinkSync("server/world/WorldEvents.test.ts");
console.log(
  "Audit batch 20 passed (13 assertions including reward rollback/retry and duplicate completion).",
);
