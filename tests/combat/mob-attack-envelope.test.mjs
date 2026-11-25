import assert from "node:assert/strict";
import { MobSimulationService } from "../../dist/server/world/MobSimulationService.js";

const player = {
  id: "player-1",
  online: true,
  dead: false,
  hp: 150,
  maxHp: 150,
  armor: 0,
  zone: "test-zone",
  x: 0.50195,
  y: 0.5,
  targetMobId: "wolf-1",
  worldCombatMobId: "wolf-1",
  movementIntent: "combat",
  moveInput: null,
  combat: {
    autoAttack: true,
    autoApproach: false,
    manualMove: false,
    queuedWorldAbility: null,
    approachSatisfied: true,
    guardUntil: 0,
    shieldWallUntil: 0,
    barrierUntil: 0,
  },
  worldCombatLog: [],
  combatFx: [],
  attack: 10,
};
const mob = {
  id: "wolf-1",
  name: "Test Wolf",
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
  temper: "aggressive",
  speedMeters: 5.5,
  attackRangeMeters: 18,
  attackers: { "player-1": 10 },
  aggroTarget: "player-1",
  ignoredAggroPlayers: {},
  lastAttack: 0,
  targetX: 0.5,
  targetY: 0.5,
  velocityX: 0,
  velocityY: 0,
  statuses: [],
};
const world = {
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
  addMobThreat(target, attacker, amount) {
    target.attackers[attacker.id] =
      Number(target.attackers[attacker.id] || 0) + amount;
  },
  engageMobAgainstPlayer(attacker, target) {
    attacker.worldCombatMobId = target.id;
    attacker.targetMobId = target.id;
    attacker.combat.autoAttack = true;
    attacker.combat.autoApproach = false;
    attacker.combat.approachSatisfied = true;
  },
};
const simulation = new MobSimulationService(world);
const startX = mob.x;
const startDistance = Math.hypot(player.x - mob.x, player.y - mob.y) * 10000;
assert.ok(
  startDistance > 18 && startDistance <= 20.5,
  `scenario must start in the former dead band; got ${startDistance}m`,
);
let hpBefore = player.hp;
const realRandom = Math.random;
Math.random = () => 0.999;
try {
  for (let i = 0; i < 160; i++) simulation.update(0.05, [player]);
} finally {
  Math.random = realRandom;
}
assert.ok(
  mob.x > startX,
  "mob must move through the former 18–20.5m dead band",
);
assert.ok(
  Math.hypot(player.x - mob.x, player.y - mob.y) <= 18.001,
  "mob must close to its attack envelope without overshooting",
);
assert.ok(
  player.hp < hpBefore,
  "mob must actually attack after reaching range",
);
const heldX = mob.x;
player.x += 0.0004;
simulation.update(0.05, [player]);
assert.ok(
  mob.x > heldX,
  "mob must resume pursuit when its target moves out of range",
);
console.log(
  "mob-attack-envelope: PASS — no dead band, capped approach step, attacks in range, resumes pursuit",
);
