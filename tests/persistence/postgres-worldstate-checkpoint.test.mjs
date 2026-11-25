import assert from "node:assert/strict";
import { PostgresRepository } from "../../server/persistence/PostgresRepository.ts";

function fakeRepository({ failInsert = false, gateInsert = null } = {}) {
  const repo = Object.create(PostgresRepository.prototype);
  repo.readyPromise = Promise.resolve();
  repo.writeQueue = Promise.resolve();
  repo.closed = true;
  repo.pendingWorldState = new Map();
  repo.pool = {};
  repo.leaseChecks = 0;
  repo.assertWorldLease = async () => {
    repo.leaseChecks++;
  };
  const statements = [];
  repo.pool.connect = async () => ({
    async query(sql, args) {
      statements.push({ sql: String(sql), args });
      if (String(sql).startsWith("INSERT INTO world_state")) {
        gateInsert?.entered?.();
        if (gateInsert?.wait) await gateInsert.wait;
        if (failInsert) throw new Error("injected world-state SQL failure");
      }
      return { rowCount: 1, rows: [] };
    },
    release() {
      statements.push({ sql: "RELEASE" });
    },
  });
  return { repo, statements };
}

const data = {
  version: 1,
  zones: { gloamwood: { id: "durable-contract", rewardStatus: "pending" } },
};
const success = fakeRepository();
await success.repo.saveWorldStateNow(data, "open-world-activity-v1");
assert.ok(success.statements.some((x) => x.sql === "BEGIN"));
assert.ok(
  success.statements.some((x) => x.sql.startsWith("INSERT INTO world_state")),
);
assert.ok(success.statements.some((x) => x.sql === "COMMIT"));
assert.ok(success.statements.some((x) => x.sql === "RELEASE"));
assert.equal(
  success.repo.leaseChecks,
  1,
  "critical write checks the active world lease",
);
assert.equal(
  success.repo.pendingWorldState.has("open-world-activity-v1"),
  false,
  "committed snapshot is removed from queued flushes",
);
assert.deepEqual(
  success.repo._worldStateCache.get("open-world-activity-v1"),
  data,
);

const failure = fakeRepository({ failInsert: true });
await assert.rejects(
  failure.repo.saveWorldStateNow(data, "open-world-activity-v1"),
  /injected world-state SQL failure/,
);
assert.ok(
  failure.statements.some((x) => x.sql === "ROLLBACK"),
  "failed checkpoint rolls back its SQL transaction",
);
assert.equal(
  failure.repo.pendingWorldState.has("open-world-activity-v1"),
  true,
  "failed checkpoint remains queued for retry",
);

let entered;
const enteredPromise = new Promise((resolve) => {
  entered = resolve;
});
let releaseInsert;
const wait = new Promise((resolve) => {
  releaseInsert = resolve;
});
const gate = fakeRepository({ gateInsert: { entered: () => entered(), wait } });
const first = { version: 1, zones: { gloamwood: { progress: 1 } } };
const later = { version: 1, zones: { gloamwood: { progress: 2 } } };
const inFlight = gate.repo.saveWorldStateNow(first, "open-world-activity-v1");
await enteredPromise;
gate.repo.saveWorldState(later, "open-world-activity-v1");
releaseInsert();
await inFlight;
assert.equal(
  gate.repo.pendingWorldState.get("open-world-activity-v1"),
  later,
  "a newer queued snapshot is not deleted by an older commit",
);
assert.deepEqual(
  gate.repo._worldStateCache.get("open-world-activity-v1"),
  later,
  "cache retains the newest snapshot",
);
console.log(
  "PostgreSQL world-state checkpoint: PASS — lease check, commit/rollback, retry retention, and concurrent newer-snapshot preservation",
);
