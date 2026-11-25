import assert from "node:assert/strict";
import fs from "node:fs";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const source = fs.readFileSync(
  new URL("../../server/world/WorldEvents.ts", import.meta.url),
  "utf8",
);
const tempUrl = new URL(
  "../../server/world/WorldEvents.durable-test.ts",
  import.meta.url,
);
fs.writeFileSync(
  tempUrl,
  source
    .replace("'./WorldConsequenceEngine.js'", "'./WorldConsequenceEngine.ts'")
    .replace(
      "'../../shared/OwnedRollback.js'",
      "'../../shared/OwnedRollback.ts'",
    ),
);
try {
  const { WorldEvents } = await import(tempUrl.href);
  const player = {
    id: "durable-event-player",
    hasCharacter: true,
    gold: 0,
    xp: 0,
    _rewardLedger: [],
  };
  const durableKeys = new Set();
  let worldState = null;
  let checkpointCalls = 0;
  let failInitialCheckpoint = true;
  let releaseCheckpoint;
  let blockFirstCheckpoint = false;
  let firstCheckpointStarted;
  const firstCheckpointGate = new Promise((resolve) => {
    releaseCheckpoint = resolve;
  });
  const firstCheckpointStartedGate = new Promise((resolve) => {
    firstCheckpointStarted = resolve;
  });
  const repo = {
    getPlayer: (id) => (id === player.id ? player : null),
    loadWorldState: () => worldState,
    saveWorldState: (data) => {
      worldState = structuredClone(data);
    },
    async saveWorldStateNow(data) {
      checkpointCalls++;
      if (blockFirstCheckpoint && checkpointCalls === 1) {
        firstCheckpointStarted();
        await firstCheckpointGate;
      }
      if (failInitialCheckpoint && checkpointCalls === 1)
        throw new Error("injected terminal checkpoint failure");
      worldState = structuredClone(data);
    },
    async savePlayerRewardOnce(p, key) {
      if (durableKeys.has(key)) return false;
      durableKeys.add(key);
      p._rewardLedger = [...(p._rewardLedger || []), key];
      return true;
    },
  };
  const mutations = new PlayerMutationCoordinator();
  const makeEngine = () => {
    const engine = new WorldEvents(
      { players: [], byId: {}, mobs: new Map(), worldEventState: {} },
      repo,
      (p, xp, gold) => {
        p.xp += xp;
        p.gold += gold;
      },
      { onWorldEvent: () => {}, onWorldEventConsequence: () => {} },
      {},
      { record: () => {} },
      mutations,
    );
    engine.consequence = { apply: () => {}, profile: () => ({}) };
    return engine;
  };
  const event = () => ({
    id: "event-durable-checkpoint",
    defId: "event-durable-checkpoint",
    name: "Durability Test",
    kind: "invasion",
    zone: "test-zone",
    goal: 1,
    progress: 1,
    startedAt: 1,
    endsAt: Date.now() + 10_000,
    participants: [player.id],
    contributions: { [player.id]: 1 },
    reward: { xp: 10, gold: 5 },
    mobIds: [],
    completed: false,
    rewardedParticipantIds: [],
    outcomeRecorded: false,
  });

  let engine = makeEngine();
  engine.active = event();
  await assert.rejects(
    engine.complete(),
    /injected terminal checkpoint failure/,
  );
  assert.equal(
    player.gold,
    0,
    "no player payout occurs if the terminal event checkpoint fails",
  );
  assert.equal(
    durableKeys.size,
    0,
    "no reward key is claimed before the terminal event is durable",
  );

  failInitialCheckpoint = false;
  checkpointCalls = 0;
  engine = makeEngine();
  engine.active = event();
  blockFirstCheckpoint = true;
  const completion = engine.complete();
  await firstCheckpointStartedGate;
  await Promise.resolve();
  assert.equal(
    player.gold,
    0,
    "payout waits while the terminal checkpoint is unresolved",
  );
  assert.equal(
    durableKeys.size,
    0,
    "reward ledger is untouched before terminal checkpoint resolves",
  );
  releaseCheckpoint();
  await completion;
  blockFirstCheckpoint = false;
  assert.equal(player.gold, 5, "payout commits after terminal checkpoint");
  assert.equal(player.xp, 10, "XP commits after terminal checkpoint");
  assert.deepEqual(engine.active.rewardedParticipantIds, [player.id]);
  assert.ok(
    worldState?.active?.completed,
    "completed event state is durably checkpointed",
  );
  assert.ok(
    worldState?.active?.rewardedParticipantIds.includes(player.id),
    "participant completion marker is durable",
  );

  const player2 = {
    id: "post-commit-player",
    hasCharacter: true,
    gold: 0,
    xp: 0,
    _rewardLedger: [],
  };
  const keys2 = new Set();
  let state2 = null;
  let failAfterCommit = true;
  const repo2 = {
    getPlayer: (id) => (id === player2.id ? player2 : null),
    loadWorldState: () => state2,
    saveWorldState: (data) => {
      state2 = structuredClone(data);
    },
    async saveWorldStateNow(data) {
      if (
        failAfterCommit &&
        keys2.size &&
        data.active?.rewardedParticipantIds?.includes(player2.id)
      ) {
        throw new Error("post-commit event checkpoint failure");
      }
      state2 = structuredClone(data);
    },
    async savePlayerRewardOnce(p, key) {
      if (keys2.has(key)) return false;
      keys2.add(key);
      p._rewardLedger = [...(p._rewardLedger || []), key];
      return true;
    },
  };
  const engine2 = new WorldEvents(
    { players: [], byId: {}, mobs: new Map(), worldEventState: {} },
    repo2,
    (p, xp, gold) => {
      p.xp += xp;
      p.gold += gold;
    },
    { onWorldEvent: () => {}, onWorldEventConsequence: () => {} },
    {},
    { record: () => {} },
    new PlayerMutationCoordinator(),
  );
  engine2.consequence = { apply: () => {}, profile: () => ({}) };
  engine2.active = {
    ...event(),
    id: "post-commit-event",
    participants: [player2.id],
    contributions: { [player2.id]: 1 },
    rewardedParticipantIds: [],
  };
  await engine2.complete();
  assert.equal(
    player2.gold,
    5,
    "event checkpoint failure must not roll back a durable player reward in memory",
  );
  assert.equal(
    player2.xp,
    10,
    "durable XP remains visible after a later world-state checkpoint fails",
  );
  assert.deepEqual(
    engine2.active.rewardedParticipantIds,
    [],
    "failed event checkpoint leaves the participant marker retryable",
  );
  failAfterCommit = false;
  await engine2.complete();
  assert.equal(
    player2.gold,
    5,
    "retry after event checkpoint failure cannot duplicate gold",
  );
  assert.equal(
    player2.xp,
    10,
    "retry after event checkpoint failure cannot duplicate XP",
  );
  assert.deepEqual(engine2.active.rewardedParticipantIds, [player2.id]);

  let consequences = 0;
  const engine3 = makeEngine();
  engine3.active = { ...event(), completed: true, outcomeRecorded: false };
  engine3.state.regions["test-zone"] = {
    status: "recovering",
    completedCount: 1,
    failedCount: 0,
    lastEventId: engine3.active.id,
    lastOutcome: "completed",
    lastCompletedAt: 123,
    nextEligibleAt: 999,
  };
  engine3.consequence = {
    apply: () => {
      consequences++;
    },
    profile: () => ({}),
  };
  engine3.active.rewardedParticipantIds = [player.id];
  engine3.active.participants = [player.id];
  engine3.active.id = "event-durable-checkpoint";
  await engine3.complete();
  assert.equal(
    engine3.state.regions["test-zone"].completedCount,
    1,
    "replayed outcome does not increment completion counter",
  );
  assert.equal(
    consequences,
    0,
    "replayed outcome does not reapply regional consequence",
  );

  console.log(
    "World-event durable checkpoint tests: PASS — payout waits for terminal checkpoint, committed rewards survive later checkpoint failures, retries stay idempotent, and regional outcomes replay safely.",
  );
} finally {
  fs.rmSync(tempUrl, { force: true });
}
