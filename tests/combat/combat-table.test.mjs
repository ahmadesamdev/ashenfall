import assert from "node:assert/strict";
import {
  COMBAT_TABLE,
  playerMissChance,
  critSuppression,
  attackMisses,
  playerAvoidance,
  rollAvoidance,
  applyDiminishingReturns,
  isBossLike,
} from "../../dist/server/combat/CombatTable.js";
import { applyIncomingPartyDamage } from "../../dist/server/combat/PartyCombat.js";

const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const player = (extra = {}) => ({
  level: 10,
  stats: { agility: 10 },
  bonuses: {},
  ...extra,
});
const mob = (level, extra = {}) => ({ level, ...extra });

near(playerMissChance(player(), mob(10)), 0.05, 1e-9, "same level");
near(
  playerMissChance(player(), mob(5)),
  0.05,
  1e-9,
  "lower level mobs are not easier to hit than 5%",
);
near(playerMissChance(player(), mob(13)), 0.08, 1e-9, "three levels above");
near(
  playerMissChance(player(), mob(10, { boss: true })),
  0.08,
  1e-9,
  "boss counts as +3 levels",
);
near(
  playerMissChance(player({ bonuses: { hit: 5 } }), mob(10)),
  0,
  1e-9,
  "hit rating removes the base miss",
);
near(
  playerMissChance(player(), mob(60)),
  COMBAT_TABLE.missCap,
  1e-9,
  "miss chance is capped",
);
assert.equal(isBossLike({ boss: true }), true);
assert.equal(isBossLike({}), false);

assert.equal(critSuppression(player(), mob(10)), 0);
near(
  critSuppression(player(), mob(10, { boss: true })),
  1.5,
  1e-9,
  "boss suppresses 1.5 points",
);
assert.ok(
  critSuppression(player(), mob(80)) <= COMBAT_TABLE.critSuppressionCap,
);

const stunned = {
  level: 10,
  statuses: [{ id: "stunned", until: Date.now() + 5000 }],
  stats: { agility: 200 },
  bonuses: { dodge: 50 },
};
assert.deepEqual(playerAvoidance(stunned, 10), { miss: 0, dodge: 0 });
assert.equal(
  rollAvoidance(stunned, 10, () => 0),
  null,
);
assert.equal(
  attackMisses(player(), { ...mob(10), statuses: ["stunned"] }, {}, () => 0),
  false,
);

const base = playerAvoidance(player(), 10);
near(base.miss, 0.05, 1e-9, "avoid miss");
near(base.dodge, 0.03, 1e-9, "avoid dodge");
assert.ok(
  playerAvoidance(player({ stats: { agility: 50 } }), 10).dodge > base.dodge,
  "agility raises dodge",
);
assert.ok(
  playerAvoidance(player({ bonuses: { dodge: 10 } }), 10).dodge > base.dodge,
  "gear dodge raises dodge",
);
const stacked = playerAvoidance(
  player({ stats: { agility: 999 }, bonuses: { dodge: 90 } }),
  10,
);
near(
  stacked.miss + stacked.dodge,
  COMBAT_TABLE.avoidanceCap / 100,
  1e-9,
  "avoidance cap",
);
assert.ok(
  playerAvoidance(player(), 25).miss <= 0.1 &&
    playerAvoidance(player(), 25).miss >= 0.02,
  "miss vs much higher level attackers stays bounded",
);
assert.equal(
  rollAvoidance(player(), 10, () => 0.01),
  "miss",
);
assert.equal(
  rollAvoidance(player(), 10, () => 0.07),
  "dodge",
);
assert.equal(
  rollAvoidance(player(), 10, () => 0.5),
  null,
);

{
  let misses = 0,
    bossMisses = 0,
    dodges = 0,
    avoidMiss = 0;
  const N = 40000;
  for (let i = 0; i < N; i++) {
    if (attackMisses(player(), mob(10))) misses++;
    if (attackMisses(player(), mob(10, { boss: true }))) bossMisses++;
    const r = rollAvoidance(player(), 10);
    if (r === "dodge") dodges++;
    if (r === "miss") avoidMiss++;
  }
  near(misses / N, 0.05, 0.006, "observed miss rate");
  near(bossMisses / N, 0.08, 0.008, "observed boss miss rate");
  near(dodges / N, 0.03, 0.006, "observed dodge rate");
  near(avoidMiss / N, 0.05, 0.006, "observed incoming miss rate");
}

{
  const p = {
    level: 10,
    stats: { agility: 10 },
    bonuses: {},
    combat: {},
    statuses: [],
    classId: "ranger",
    equipment: {},
    resolve: 0,
    maxResolve: 0,
  };
  const always = () => 0;
  assert.equal(
    applyIncomingPartyDamage(p, 100, Date.now(), always, {
      avoidable: true,
      attackerLevel: 10,
    }).avoided,
    "miss",
  );
  assert.equal(
    applyIncomingPartyDamage(p, 100, Date.now(), always, {
      avoidable: true,
      attackerLevel: 10,
    }).damage,
    0,
  );
  assert.equal(
    applyIncomingPartyDamage(p, 100, Date.now(), always).avoided,
    undefined,
    "unflagged (scripted) damage is never avoided",
  );
  assert.ok(applyIncomingPartyDamage(p, 100, Date.now(), always).damage > 0);
  assert.equal(
    applyIncomingPartyDamage(p, 100, Date.now(), () => 0.9, {
      avoidable: true,
      attackerLevel: 10,
    }).avoided,
    undefined,
  );
}

{
  const t = { combat: {} },
    t0 = 1_000_000;
  assert.equal(applyDiminishingReturns(t, "stun", 4, t0), 4);
  assert.equal(applyDiminishingReturns(t, "stun", 4, t0 + 1000), 2);
  assert.equal(applyDiminishingReturns(t, "stun", 4, t0 + 2000), 1);
  assert.equal(
    applyDiminishingReturns(t, "stun", 4, t0 + 3000),
    0,
    "fourth application is immune",
  );
  assert.equal(
    applyDiminishingReturns(t, "stun", 4, t0 + 3000 + 17000),
    0,
    "still immune inside the reset window",
  );
  assert.equal(
    applyDiminishingReturns(t, "stun", 4, t0 + 20000 + 17000),
    0,
    "the refresh keeps the target immune",
  );
  assert.equal(
    applyDiminishingReturns(t, "stun", 4, t0 + 37000 + 18001),
    4,
    "resets once the window passes without new applications",
  );
  assert.equal(
    applyDiminishingReturns(t, "fear", 4, t0),
    4,
    "categories are tracked independently",
  );
}

{
  const { CombatEngine } =
    await import("../../dist/server/combat/CombatEngine.js");
  const eng = Object.create(CombatEngine.prototype);
  eng.gearActiveMultiplier = () => 1;
  const hasted = (h) => ({ bonuses: { haste: h } });
  assert.equal(eng.gcdMs(hasted(0), { gcd: 1.5 }), 1500);
  assert.ok(
    Math.abs(eng.gcdMs(hasted(50), { gcd: 1.5 }) - 1000) < 1e-6,
    "50% haste -> 1.0s",
  );
  assert.equal(eng.gcdMs(hasted(900), { gcd: 1.5 }), 750, "GCD floor");
  assert.equal(
    eng.gcdMs(hasted(900), { gcd: 0.5 }),
    500,
    "abilities with a shorter base GCD keep it",
  );
  assert.equal(eng.gcdMs(hasted(0), { gcd: 0 }), 0);
  assert.equal(eng.swingMs(hasted(0), 1500), 1500);
  assert.equal(eng.swingMs(hasted(100), 1500), 750);
  assert.equal(eng.swingMs(hasted(900), 1500), 650, "swing floor");
}
console.log(
  "combat-table: PASS — miss/dodge tables, level scaling, crit suppression, stun immunity, diminishing returns, GCD/swing haste floors",
);
