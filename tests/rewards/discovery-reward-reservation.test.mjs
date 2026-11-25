import assert from "node:assert/strict";
import { DiscoveryEngine } from "../../server/world/DiscoveryEngine.ts";

const repo = {
  loadWorldState() {
    return null;
  },
  saveWorldState() {},
};
const world = {
  normalizedMeters() {
    return 1;
  },
};
const engine = new DiscoveryEngine(repo, world, {}, {}, {}, [
  { id: "gloamwood" },
]);
const discovery = {
  id: "disc_retry_test",
  regionId: "gloamwood",
  kind: "ecological",
  name: "Wilds in Motion",
  description: "test",
  icon: "🐾",
  x: 0.5,
  y: 0.5,
  createdTick: 0,
  expiresTick: 900,
  sourceEventIds: [],
  severity: "regional",
  rarity: "rare",
  discoveredBy: [],
};
engine.discoveries.set(discovery.id, discovery);
const player = {
  id: "player-discovery-retry",
  online: true,
  hasCharacter: true,
  dungeon: null,
  zone: "gloamwood",
  x: 0.5,
  y: 0.5,
};
const first = engine.tick([player], 1, Date.now());
assert.equal(first.length, 1, "discovery produces a reward candidate");
assert.deepEqual(
  discovery.discoveredBy,
  [],
  "candidate is not consumed before durable player reward commits",
);
const retry = engine.tick([player], 2, Date.now());
assert.equal(
  retry.length,
  1,
  "failed reward can be offered again on the next tick",
);
assert.equal(
  engine.markDiscovered(discovery.id, player.id),
  true,
  "durable reward coordinator can mark success",
);
assert.deepEqual(discovery.discoveredBy, [player.id]);
const afterCommit = engine.tick([player], 3, Date.now());
assert.equal(afterCommit.length, 0, "committed discovery is no longer offered");
assert.equal(
  engine.markDiscovered(discovery.id, player.id),
  false,
  "reconciliation is idempotent",
);
console.log(
  "discovery reward reservation: PASS — candidate remains retryable until durable reward commit and marking is idempotent",
);
