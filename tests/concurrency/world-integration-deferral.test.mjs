import assert from "node:assert/strict";
import { WorldIntegration } from "../../server/world/WorldIntegration.ts";
import { PlayerMutationCoordinator } from "../../server/shared/PlayerMutationCoordinator.ts";

const player = {
  id: "participant-1",
  hasCharacter: true,
  questConsequences: 0,
};
let saves = 0;
const repo = {
  getPlayer: (id) => (id === player.id ? player : null),
  savePlayer: (p) => {
    assert.equal(p, player);
    saves++;
  },
};
const playerMutations = new PlayerMutationCoordinator();
const integration = new WorldIntegration(repo, {
  playerMutations,
  quest: {
    onWorldEventConsequence: () => {
      player.questConsequences++;
    },
  },
});
const event = {
  id: "world-contract:test:1",
  type: "world_contract_outcome",
  regionId: "gloamwood",
  simulationTick: 10,
  actorId: player.id,
  payload: {
    kind: "world_event",
    outcome: "success",
    participantIds: [player.id],
  },
};
let release;
const gate = new Promise((resolve) => {
  release = resolve;
});
const holding = playerMutations.withPlayer(player.id, async () => {
  integration.ingestEvents([event], 10);
  assert.equal(
    player.questConsequences,
    0,
    "locked participant must not be mutated by world ledger ingestion",
  );
  assert.equal(
    integration.state.processedEventIds.includes(event.id),
    false,
    "deferred event must remain eligible for replay",
  );
  await gate;
});
release();
await holding;
integration.ingestEvents([event], 11);
assert.equal(
  player.questConsequences,
  1,
  "deferred consequence applies after the player lock is released",
);
assert.equal(saves, 1, "player consequence is persisted once");
assert.equal(
  integration.state.processedEventIds.includes(event.id),
  true,
  "successful event is marked processed",
);
console.log(
  "world integration mutation deferral: PASS — locked participant events remain replayable and apply once after unlock",
);
