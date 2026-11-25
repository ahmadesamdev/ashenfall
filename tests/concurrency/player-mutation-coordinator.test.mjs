import assert from "node:assert/strict";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const coordinator = new PlayerMutationCoordinator();
const order = [];
let releaseFirst;
const firstGate = new Promise((resolve) => {
  releaseFirst = resolve;
});
const first = coordinator.withPlayer("p1", async () => {
  order.push("first-start");
  await firstGate;
  order.push("first-end");
});
const second = coordinator.withPlayer("p1", async () => {
  order.push("second");
});
assert.equal(
  coordinator.isLocked("p1"),
  true,
  "active and queued mutations both mark the player locked",
);
const other = coordinator.withPlayer("p2", async () => {
  order.push("other");
});
assert.equal(
  coordinator.isLocked("p2"),
  true,
  "independent active mutations are observable",
);
assert.equal(
  coordinator.isLocked("missing"),
  false,
  "uncontended players are not locked",
);
await other;
assert.equal(
  coordinator.isLocked("p2"),
  false,
  "independent lock clears after completion",
);
assert.deepEqual(
  order,
  ["first-start", "other"],
  "different players should not block each other",
);
releaseFirst();
await Promise.all([first, second]);
assert.deepEqual(
  order,
  ["first-start", "other", "first-end", "second"],
  "same-player mutations must be FIFO",
);

const nested = await coordinator.withPlayer("p3", () =>
  coordinator.withPlayer("p3", () => "reentrant"),
);
assert.equal(nested, "reentrant", "nested same-player work must not deadlock");

let both = 0;
await Promise.all([
  coordinator.withPlayers(["b", "a"], async () => {
    both++;
    await Promise.resolve();
  }),
  coordinator.withPlayers(["a", "b"], async () => {
    both++;
    await Promise.resolve();
  }),
]);
assert.equal(
  both,
  2,
  "multi-player locks in opposing input order must complete without deadlock",
);
assert.equal(
  coordinator.pendingKeys,
  0,
  "all lock tails should be released after completion",
);
assert.equal(
  coordinator.isLocked("p1"),
  false,
  "released player lock is no longer visible to simulation",
);
console.log(
  "player mutation coordinator regression: PASS — per-player FIFO, cross-player concurrency, reentrancy, sorted multi-locks, and cleanup",
);
