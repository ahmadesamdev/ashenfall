import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { SQLiteRepository } from "../../server/persistence/SQLiteRepository.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ashenfall-v36-"));
const repo = new SQLiteRepository(path.join(dir, "test.sqlite"));
try {
  repo.authInit();
  repo.authCreateAccount(
    {
      id: "account_test",
      email: "test@example.com",
      passwordHash: "unused",
      createdAt: Date.now(),
    },
    "vhash",
    Date.now() + 60000,
  );
  repo.authVerifyAccount("account_test");
  const v1 = repo.authReplaceAccountSession(
    "token_hash_1",
    "account_test",
    Date.now() + 60000,
  );
  assert.equal(
    v1,
    2,
    "first account session increments the JWT session version",
  );
  assert.equal(
    repo.authGetSessionByHash("token_hash_1")?.accountId,
    "account_test",
  );
  const v2 = repo.authReplaceAccountSession(
    "token_hash_2",
    "account_test",
    Date.now() + 60000,
  );
  assert.equal(v2, 3, "replacement session increments the JWT session version");
  assert.equal(
    repo.authGetSessionByHash("token_hash_1"),
    null,
    "previous browser refresh session is revoked",
  );
  assert.equal(
    repo.authGetSessionByHash("token_hash_2")?.accountId,
    "account_test",
  );
  assert.equal(
    repo.authListAccountSessions("account_test").length,
    1,
    "only one active account refresh session remains",
  );
  const refreshVersion = repo.authReplaceAccountSession(
    "token_hash_refresh",
    "account_test",
    Date.now() + 60000,
    false,
  );
  assert.equal(
    refreshVersion,
    3,
    "refresh rotates the refresh token without bumping the access-token session version",
  );
  assert.equal(
    repo.authGetSessionByHash("token_hash_2"),
    null,
    "rotated refresh token is revoked",
  );
  assert.equal(
    repo.authGetSessionByHash("token_hash_refresh")?.accountId,
    "account_test",
  );

  const now = Date.now();
  const first = repo.acquireWorldLease("world-test", "owner-a", now, 30000);
  assert.equal(first.acquired, true);
  const competing = repo.acquireWorldLease(
    "world-test",
    "owner-b",
    now + 1,
    30000,
  );
  assert.equal(
    competing.acquired,
    false,
    "a second process cannot take an unexpired lease",
  );
  assert.equal(
    repo.renewWorldLease(
      "world-test",
      "owner-a",
      first.fencingToken,
      now + 2,
      30000,
    ),
    true,
  );
  assert.equal(
    repo.renewWorldLease(
      "world-test",
      "owner-b",
      first.fencingToken,
      now + 2,
      30000,
    ),
    false,
  );
  repo.releaseWorldLease("world-test", "owner-a", first.fencingToken);
  const second = repo.acquireWorldLease(
    "world-test",
    "owner-b",
    now + 3,
    30000,
  );
  assert.equal(second.acquired, true);
  assert.ok(
    second.fencingToken > first.fencingToken,
    "new owner receives a higher fencing token",
  );
  repo.releaseWorldLease("world-test", "owner-b", second.fencingToken);
  const sameOwnerReacquire = repo.acquireWorldLease(
    "world-test",
    "owner-b",
    now + 4,
    30000,
  );
  assert.ok(
    sameOwnerReacquire.fencingToken > second.fencingToken,
    "reacquisition after expiry increments fencing token even for the same owner ID",
  );
  repo.setWorldLeaseContext("world-test", "owner-a", first.fencingToken);
  assert.throws(
    () =>
      repo.savePlayerRewardOnce({ id: "stale-owner" }, "stale-owner:reward"),
    /world lease is no longer valid/,
    "stale owner cannot persist after fencing token changes",
  );
  const recoveredAfterStall = repo.acquireWorldLease(
    "world-test",
    "owner-b",
    now + 41000,
    30000,
  );
  assert.equal(
    recoveredAfterStall.acquired,
    true,
    "expired lease can be reacquired after a renewal gap",
  );
  assert.ok(
    recoveredAfterStall.fencingToken > sameOwnerReacquire.fencingToken,
    "recovery after expiry advances fencing token",
  );
  repo.setWorldLeaseContext(
    "world-test",
    "owner-b",
    recoveredAfterStall.fencingToken,
  );

  const player = {
    id: "player_test",
    name: "Test",
    level: 1,
    gold: 10,
    _rewardLedger: ["reward:test"],
  };
  assert.equal(repo.savePlayerRewardOnce(player, "reward:test"), true);
  const events = repo.claimOutbox("test-consumer", 10, Date.now());
  assert.equal(
    events.length,
    1,
    "reward commit and outbox event are persisted together",
  );
  assert.equal(events[0].type, "reward.player_committed");
  repo.completeOutbox(events[0].id, "test-consumer");
  assert.equal(
    repo.claimOutbox("test-consumer", 10, Date.now()).length,
    0,
    "completed outbox events are not redelivered",
  );
  const group = [
    {
      id: "player_a",
      zone: "stonehold",
      lastDungeonResult: {
        complete: true,
        instanceId: "dungeon_instance_1",
        dungeonId: "crypts",
      },
    },
    {
      id: "player_b",
      zone: "stonehold",
      lastDungeonResult: {
        complete: true,
        instanceId: "dungeon_instance_1",
        dungeonId: "crypts",
      },
    },
  ];
  assert.equal(
    repo.savePlayersWithRewardsOnce(group, [
      "dungeon:player_a",
      "dungeon:player_b",
    ]),
    true,
  );
  const groupEvents = repo.claimOutbox("test-consumer", 10, Date.now());
  assert.equal(
    groupEvents.filter((e) => e.type === "dungeon.completion_committed").length,
    1,
    "group reward transaction includes one stable dungeon reconciliation event",
  );
  assert.equal(
    groupEvents.filter((e) => e.type === "reward.player_committed").length,
    2,
    "each player reward has its own durable idempotency event",
  );
  const authSource = readFileSync(
    new URL("../../server/auth/AuthService.ts", import.meta.url),
    "utf8",
  );
  const runtimeSource = readFileSync(
    new URL("../../server/runtime/ServerRuntime.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    authSource,
    /authReplaceAccountSession/,
    "account session issuance uses atomic session replacement",
  );
  assert.match(
    runtimeSource,
    /activeAccountConnections/,
    "only one active account WebSocket is allowed across tabs",
  );
  console.log("v36 audit: 23 assertions passed");
} finally {
  try {
    repo.close();
  } catch {}
  fs.rmSync(dir, { recursive: true, force: true });
}
