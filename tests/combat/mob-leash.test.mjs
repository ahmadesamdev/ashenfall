import assert from "node:assert/strict";
import { MobSimulationService } from "../../dist/server/world/MobSimulationService.js";

const makePlayer = (id, x, y, mobId) => ({
  id,
  name: id,
  online: true,
  dead: false,
  hp: 100,
  zone: "test-zone",
  x,
  y,
  targetMobId: mobId,
  worldCombatMobId: mobId,
  moveInput: null,
  movementIntent: "combat",
  combat: {
    autoAttack: true,
    autoApproach: true,
    manualMove: false,
    queuedWorldAbility: null,
    approachSatisfied: false,
  },
  armor: 0,
  attack: 10,
  combatFx: [],
  worldCombatLog: [],
});

const makeWorld = (mob) => ({
  mobs: new Map([[mob.id, mob]]),
  ores: new Map(),
  mobBehavior: { cleanupEncounters() {}, prepare: () => ({ flee: false }) },
  normalizedMeters: (_zone, meters) => Number(meters) / 10000,
  worldMetersFor: () => 10000,
  combatReturnDistanceNormalized: () => 0.004,
  regionalMobModifier: () => ({ damage: 1, speed: 1 }),
  regionalTraversalFor: () => ({
    roadAggroMultiplier: 1,
    offRoadAggroMultiplier: 1,
  }),
  distanceToRoadFor: () => 1000,
  isSafeWorldEntry: () => true,
  sameDungeonInstance: () => true,
  resolveWalkableStep: (_zone, _x, _y, nx, ny) => ({
    x: nx,
    y: ny,
    blocked: false,
  }),
  engageMobAgainstPlayer(player, target) {
    player.worldCombatMobId = target.id;
    player.targetMobId = target.id;
    player.combat.autoAttack = true;
    player.combat.autoApproach = false;
    player.combat.approachSatisfied = true;
  },
});

const makeMob = (overrides = {}) => ({
  id: "mob-1",
  zone: "test-zone",
  state: "engaged",
  returning: false,
  x: 0.5,
  y: 0.5,
  homeX: 0.5,
  homeY: 0.5,
  leashOriginX: 0.5,
  leashOriginY: 0.5,
  leashRadius: 0.16,
  hp: 100,
  maxHp: 100,
  attack: 1,
  armor: 0,
  temper: "passive",
  speedMeters: 5.5,
  attackRangeMeters: 35,
  attackers: {},
  aggroTarget: null,
  ignoredAggroPlayers: {},
  lastAttack: Date.now(),
  targetX: 0.5,
  targetY: 0.5,
  velocityX: 0,
  velocityY: 0,
  statuses: [],
  ...overrides,
});

{
  const mob = makeMob({
    attackers: { runner: 10, staying: 5 },
    aggroTarget: "runner",
  });
  const runner = makePlayer("runner", 0.52, 0.5, mob.id);
  const staying = makePlayer("staying", 0.502, 0.5, mob.id);
  const world = makeWorld(mob);
  new MobSimulationService(world).update(0.05, [runner, staying]);
  assert.equal(
    mob.attackers.runner,
    undefined,
    "leashing attacker is removed from threat",
  );
  assert.equal(mob.attackers.staying, 5, "in-range attacker keeps threat");
  assert.equal(
    mob.aggroTarget,
    "staying",
    "mob promotes the remaining valid attacker",
  );
  assert.equal(
    runner.worldCombatMobId,
    null,
    "leashing player combat link is cleared",
  );
  assert.equal(
    runner.combat.autoApproach,
    false,
    "leashing player cannot be pulled back into pursuit",
  );
  assert.equal(
    runner.combat.autoAttack,
    false,
    "leashing player auto-attack is cleared",
  );
  assert.equal(
    runner.combat.manualMove,
    true,
    "leash reset prevents client-side pursuit from restarting",
  );
}

{
  const mob = makeMob({
    x: 0.52,
    attackers: { first: 10, second: 5 },
    aggroTarget: "first",
  });
  const first = makePlayer("first", 0.502, 0.5, mob.id);
  const second = makePlayer("second", 0.503, 0.5, mob.id);
  const world = makeWorld(mob);
  new MobSimulationService(world).update(0.05, [first, second]);
  assert.equal(
    mob.state,
    "returning",
    "mob resets when its own body crosses the leash",
  );
  assert.equal(
    Object.keys(mob.attackers).length,
    0,
    "mob threat is cleared on full reset",
  );
  for (const player of [first, second]) {
    assert.equal(
      player.worldCombatMobId,
      null,
      `${player.id} combat link is cleared`,
    );
    assert.equal(
      player.combat.autoApproach,
      false,
      `${player.id} cannot resume stale pursuit`,
    );
    assert.equal(
      player.combat.autoAttack,
      false,
      `${player.id} auto-attack is cleared`,
    );
    assert.equal(
      player.combat.manualMove,
      true,
      `${player.id} cannot restart client-side pursuit after the mob reset`,
    );
  }
}

console.log(
  "mob-leash-regression: PASS — individual leashes preserve valid attackers; mob leash resets all stale combat links",
);

{
  const mob = makeMob({ state: "idle", attackers: {}, aggroTarget: null });
  const chaser = {
    ...makePlayer("chaser", 0.56, 0.5, mob.id),
    worldCombatMobId: null,
  };
  const stale = {
    ...makePlayer("stale", 0.56, 0.52, mob.id),
    worldCombatMobId: null,
  };
  stale.combat = { ...stale.combat, autoApproach: false };
  const world = makeWorld(mob);
  for (let i = 0; i < 5; i++)
    new MobSimulationService(world).update(0.05, [chaser, stale]);
  assert.equal(
    chaser.combat.autoApproach,
    true,
    "a player chasing an idle mob from beyond the leash distance keeps pursuing",
  );
  assert.equal(
    chaser.combat.manualMove,
    false,
    "pursuit is not converted into manual movement",
  );
  assert.equal(
    chaser.movementIntent,
    "combat",
    "chase intent is preserved until the player cancels it",
  );
  assert.equal(
    stale.combat.manualMove,
    true,
    "a stale far-away target that is not being pursued is still cleaned up",
  );
}

console.log(
  "mob-leash-approach-regression: PASS — approaching players are never cancelled by leash cleanup",
);
