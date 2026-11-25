import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SQLiteRepository } from "../../server/persistence/SQLiteRepository.ts";
import { DurableOutboxWorker } from "../../server/shared/DurableOutboxWorker.ts";
import { CombatVictoryService } from "../../server/runtime/CombatVictoryService.ts";
import { isPrincipalCurrent } from "../../server/auth/SessionAuthority.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ashenfall-v37-"));
const repo = new SQLiteRepository(path.join(dir, "test.sqlite"));
try {
  const accounts = new Map([
    [
      "account-session",
      { id: "account-session", verified: true, sessionVersion: 8 },
    ],
  ]);
  const sessionRepo = {
    authGetAccountById: async (id) => accounts.get(id) || null,
  };
  assert.equal(
    await isPrincipalCurrent(sessionRepo, {
      kind: "account",
      accountId: "account-session",
      sessionVersion: 8,
    }),
    true,
    "current account session remains valid",
  );
  accounts.get("account-session").sessionVersion = 9;
  assert.equal(
    await isPrincipalCurrent(sessionRepo, {
      kind: "account",
      accountId: "account-session",
      sessionVersion: 8,
    }),
    false,
    "replaced session is rejected even when its socket lives on another process",
  );
  assert.equal(
    await isPrincipalCurrent(sessionRepo, {
      kind: "account",
      accountId: "account-session",
      sessionVersion: 9,
    }),
    true,
    "new account session remains valid",
  );
  accounts.get("account-session").verified = false;
  assert.equal(
    await isPrincipalCurrent(sessionRepo, {
      kind: "account",
      accountId: "account-session",
      sessionVersion: 9,
    }),
    false,
    "unverified/disabled account cannot keep a gameplay socket active",
  );

  const player = { id: "outbox-player", zone: "stonehold", gold: 25 };
  assert.equal(repo.savePlayerRewardOnce(player, "v37:outbox-retry"), true);
  const originalComplete = repo.completeOutbox.bind(repo);
  let failAcknowledge = true;
  repo.completeOutbox = (...args) => {
    if (failAcknowledge) {
      failAcknowledge = false;
      throw new Error("simulated crash before outbox acknowledgement");
    }
    return originalComplete(...args);
  };
  const seen = new Set();
  let sideEffectCount = 0;
  const worldSimulation = {
    snapshot: () => ({ simulationTick: 4 }),
    record: (event) => {
      if (seen.has(event.id)) return false;
      seen.add(event.id);
      sideEffectCount++;
      return true;
    },
    checkpoint: async () => true,
  };
  const worker = new DurableOutboxWorker(
    repo,
    worldSimulation,
    () => true,
    60000,
  );
  await worker.drain();
  assert.equal(
    sideEffectCount,
    1,
    "first delivery applies the stable world event",
  );
  const outboxRow = repo.db
    .prepare("SELECT id,status FROM durable_outbox WHERE id=?")
    .get("reward:v37:outbox-retry");
  assert.equal(
    outboxRow.status,
    "pending",
    "failed acknowledgement makes the event retryable",
  );
  repo.db
    .prepare("UPDATE durable_outbox SET available_at=? WHERE id=?")
    .run(Date.now(), outboxRow.id);
  await worker.drain();
  assert.equal(
    sideEffectCount,
    1,
    "redelivery does not repeat the world side effect",
  );
  assert.equal(
    repo.db
      .prepare("SELECT status FROM durable_outbox WHERE id=?")
      .get(outboxRow.id).status,
    "completed",
  );
  worker.stop();

  const member = {
    id: "dungeon-player",
    zone: "crypts",
    gold: 0,
    level: 10,
    dungeon: { id: "crypts", instanceId: "instance-v37" },
  };
  const encounter = {
    id: "enc-v37",
    state: "won",
    dungeonId: "crypts",
    optionalRoomId: null,
    participants: [member.id],
    enemy: {
      id: "boss-v37",
      name: "Test Boss",
      ai: "boss",
      xp: 20,
      gold: 10,
      loot: [],
    },
  };
  const instance = { id: "instance-v37", status: "active", progress: 2 };
  const dungeonEngine = {
    instances: new Map([[instance.id, structuredClone(instance)]]),
    onVictory: () => {
      dungeonEngine.instances.delete(instance.id);
      return {
        complete: true,
        instanceId: instance.id,
        dungeonId: "crypts",
        name: "Crypts",
        reward: {},
        rewardMemberIds: [member.id],
        returnZones: { [member.id]: "stonehold" },
      };
    },
  };
  let durableAttempts = 0;
  const fakeRepo = {
    getPlayer: (id) => (id === member.id ? member : null),
    savePlayersWithRewardsOnce: async (players, keys) => {
      durableAttempts++;
      if (durableAttempts === 1)
        throw new Error("injected durable write failure");
      for (const p of players)
        p._rewardLedger = [
          ...(p._rewardLedger || []),
          keys[players.indexOf(p)],
        ];
      return true;
    },
  };
  const combat = {
    get: () => encounter,
    encounters: new Map([[encounter.id, encounter]]),
  };
  const service = new CombatVictoryService({
    combat,
    world: {
      players: [member],
      travel: (p, zone) => {
        p.zone = zone;
      },
    },
    quest: {},
    dungeonEngine,
    repo: fakeRepo,
    rewardMobKill: () => {},
    reward: () => {},
    awardEncounterLoot: () => {},
    createDungeonCompletionRewards: () => [],
    dungeons: [{ id: "crypts", name: "Crypts" }],
  });
  const first = await service.encounterVictory(member, encounter.id);
  assert.equal(first, false, "failed durable reward commit reports failure");
  assert.ok(
    dungeonEngine.instances.has(instance.id),
    "dungeon instance is restored after failed commit",
  );
  assert.equal(
    member.zone,
    "crypts",
    "player snapshot and location are restored after failed commit",
  );
  const second = await service.encounterVictory(member, encounter.id);
  assert.equal(
    second,
    true,
    "same encounter can retry after persistence recovers",
  );
  assert.equal(
    durableAttempts,
    2,
    "retry reaches durable commit exactly once after injected failure",
  );
  assert.equal(
    member.zone,
    "stonehold",
    "successful retry applies the dungeon return zone",
  );

  console.log(
    "Audit Batch 37 passed: 16 failure-injection, session-authority, and idempotent-retry assertions.",
  );
} finally {
  try {
    repo.close();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}
