import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CombatEngine } from "../../dist/server/combat/CombatEngine.js";
import { PvpCombatService } from "../../dist/server/combat/PvpCombatService.js";
import {
  mitigationMultiplier,
  armorConstant,
  mobArmorScale,
  rollDamage,
} from "../../dist/server/combat/CombatFormula.js";

const abilities = JSON.parse(
  fs.readFileSync(
    new URL("../../game-data/abilities/abilities.json", import.meta.url),
    "utf8",
  ),
);
const byId = Object.fromEntries(abilities.map((a) => [a.id, a]));

const casters = abilities.filter((a) => Number(a.castTime) > 0);
assert.ok(casters.length >= 30, "cast-time abilities exist");
for (const a of casters) {
  assert.ok(
    a.castTime >= 1 && a.castTime <= 3,
    `${a.id} cast time in a sane range`,
  );
  assert.ok(
    !a.selfBuff && !a.movement && a.id !== "basic_strike",
    `${a.id} is not an instant-only ability`,
  );
  assert.ok(
    !(a.tags || []).includes("interrupt"),
    `${a.id}: interrupts must stay instant`,
  );
}
assert.equal(
  byId.basic_strike.castTime,
  undefined,
  "auto-attacks never have a cast time",
);
assert.ok(
  byId.arcane_bolt.power > 1.0,
  "cast-time fillers are compensated so rotation DPS is preserved",
);

function makeEngine(extra = {}) {
  const eng = Object.create(CombatEngine.prototype);
  eng.abilities = byId;
  eng.gearActiveMultiplier = () => 1;
  eng.world = {
    worldMetersFor: () => 1000,
    byIdMob: () => null,
    ...extra.world,
  };
  eng.encounters = new Map();
  eng.get = (id) => eng.encounters.get(id);
  eng.preflight = false;
  eng.completionGrants = new WeakMap();
  eng.transformedAbility = (p, a) => a;
  eng.isStunned = (p, n) =>
    (p.statuses || []).some((s) => s?.id === "stunned" && s.until > n);
  eng.requestWorldCastNow =
    extra.now ||
    ((p, id) =>
      eng.preflight ? [true, "preflight"] : [true, "executed", { id }]);
  eng._requestNow =
    extra.encNow ||
    ((p, id) =>
      eng.preflight ? [true, "preflight"] : [true, { executed: true, id }]);
  return eng;
}
const player = (extra = {}) => ({
  id: "p1",
  x: 0.5,
  y: 0.5,
  zone: "z",
  level: 5,
  combat: {},
  bonuses: {},
  statuses: [],
  cooldowns: {},
  worldCombatLog: [],
  ...extra,
});

{
  const eng = makeEngine();
  const p = player();
  assert.equal(eng.castMs(p, byId.arcane_bolt), 1500);
  assert.equal(eng.castMs(p, byId.basic_strike), 0);
  assert.equal(
    eng.castMs(p, byId.shield_bash || { id: "x" }),
    0,
    "instants stay instant",
  );
  assert.equal(
    eng.castMs(player({ bonuses: { haste: 50 } }), byId.arcane_bolt),
    1000,
  );
  assert.equal(
    eng.castMs(player({ bonuses: { haste: 5000 } }), byId.arcane_bolt),
    250,
    "floor",
  );
}

{
  const calls = [];
  const eng = makeEngine({
    now: (p, id) => {
      calls.push(eng.preflight ? "pre" : "run");
      return eng.preflight ? [true, "preflight"] : [true, "executed"];
    },
  });
  const p = player();
  const mob = { id: "m1", hp: 10, state: "alive", zone: "z" };
  const t0 = Date.now();
  const r = eng.requestWorldCast(p, "arcane_bolt", mob);
  assert.equal(r[0], true);
  assert.equal(r[1].casting, true);
  assert.deepEqual(calls, ["pre"], "validated but not executed");
  assert.equal(p.combat.casting.abilityId, "arcane_bolt");
  assert.ok(p.combat.gcdReadyAt > t0, "GCD starts with the cast");
  assert.equal(
    eng.requestWorldCast(p, "arcane_bolt", mob)[1],
    "You are already casting.",
  );
  assert.equal(
    eng.requestWorldCast(p, "frost_lance", mob)[1],
    "You are already casting.",
  );
  assert.equal(eng.requestWorldCast(p, "arcane_bolt", mob)[0], false);
  eng.grantCompletion(p, "arcane_bolt");
  assert.equal(eng.requestWorldCast(p, "arcane_bolt", mob)[1], "executed");
  assert.deepEqual(calls, ["pre", "run"]);
  eng.grantCompletion(p, "arcane_bolt");
  p.combat.casting = null;
  assert.equal(
    eng.consumeCompletion(p, "frost_lance"),
    false,
    "a grant is bound to its ability",
  );
  assert.equal(eng.consumeCompletion(p, "arcane_bolt"), true);
  assert.equal(
    eng.consumeCompletion(p, "arcane_bolt"),
    false,
    "a grant is single-use",
  );
}

{
  const eng = makeEngine({ now: () => [false, "Out of range."] });
  const p = player();
  assert.deepEqual(eng.requestWorldCast(p, "arcane_bolt", { id: "m" }), [
    false,
    "Out of range.",
  ]);
  assert.equal(p.combat.casting, undefined);
  const queued = makeEngine({ now: () => [true, { queued: true }] });
  const p2 = player();
  assert.equal(
    queued.requestWorldCast(p2, "arcane_bolt", { id: "m" })[1].queued,
    true,
    "GCD queueing passes through",
  );
  assert.equal(p2.combat.casting, undefined);
}

{
  const eng = makeEngine();
  const p = player();
  assert.equal(
    eng.requestWorldCast(p, "basic_strike", { id: "m" })[1],
    "executed",
  );
  assert.equal(p.combat.casting, undefined);
}

{
  const eng = makeEngine();
  const held = player({ moveInput: { dx: 1, dy: 0 } });
  assert.equal(
    eng.requestWorldCast(held, "arcane_bolt", { id: "m" })[1],
    "You must stand still to cast.",
  );
  const clicking = player({ moveState: "moving", targetX: 0.9, targetY: 0.9 });
  assert.equal(
    eng.requestWorldCast(clicking, "arcane_bolt", { id: "m" })[0],
    true,
  );
  assert.equal(clicking.moveState, "idle");
  assert.equal(clicking.targetX, clicking.x);
}

{
  const mob = { id: "m1", hp: 10, state: "alive", zone: "z" };
  const eng = makeEngine({ world: { byIdMob: () => mob } });
  const start = () => {
    const p = player();
    eng.requestWorldCast(p, "arcane_bolt", mob);
    return p;
  };
  let p = start();
  const end = p.combat.casting.endsAt;
  assert.equal(eng.tickCast(p, end - 100), null, "still casting");
  assert.equal(eng.tickCast(p, end + 1).complete.abilityId, "arcane_bolt");
  assert.equal(p.combat.casting.completing, true);
  assert.equal(
    eng.tickCast(p, end + 2),
    null,
    "completing casts are not re-completed",
  );
  p = start();
  p.dead = true;
  assert.equal(
    eng.tickCast(p, p.combat.casting.startedAt + 10).cancelled,
    "You died.",
  );
  assert.equal(p.combat.casting, null);
  p = start();
  p.statuses.push({ id: "stunned", until: Date.now() + 9999 });
  assert.equal(eng.tickCast(p, Date.now()).cancelled, "Interrupted.");
  p = start();
  p.x += 0.01;
  assert.equal(eng.tickCast(p, Date.now()).cancelled, "You moved.");
  p = start();
  mob.hp = 0;
  assert.equal(eng.tickCast(p, Date.now()).cancelled, "Target lost.");
  mob.hp = 10;
  p = start();
  mob.zone = "other";
  assert.equal(eng.tickCast(p, Date.now()).cancelled, "Target lost.");
  mob.zone = "z";
  p = start();
  assert.equal(
    eng.tickCast(p, p.combat.casting.endsAt + 5000).cancelled,
    "stale",
    "stale casts (e.g. after a reload) are discarded",
  );
  p = start();
  assert.equal(eng.cancelCast(p, "Cancelled."), true);
  assert.equal(eng.cancelCast(p), false);
  assert.ok(p.worldCombatLog.some((l) => /Cancelled/.test(l.msg)));
  p = start();
  p.combat.castLockUntil = Date.now() + 3000;
  p.combat.casting = null;
  assert.equal(
    eng.requestWorldCast(p, "arcane_bolt", mob)[1],
    "Your spells are locked out.",
    "interrupt lockout blocks cast-time spells",
  );
}

{
  const eng = makeEngine();
  const p = player({ encounterId: "e1", targetPlayerId: "t" });
  const r = eng._request(p, "arcane_bolt", {});
  assert.equal(r[0], true);
  assert.equal(r[1].casting, true);
  assert.equal(p.combat.casting.kind, "encounter");
  assert.equal(p.combat.casting.command.action, "cast_ability");
  eng.encounters.set("e1", { state: "running" });
  assert.equal(eng.tickCast(p, Date.now()), null);
  eng.encounters.clear();
  assert.equal(eng.tickCast(p, Date.now()).cancelled, "Combat ended.");
}

{
  const eng = makeEngine();
  const p = player({
    encounterId: "e1",
    combat: {
      casting: { abilityId: "x", endsAt: Date.now() + 1000 },
      autoAttack: true,
    },
  });
  assert.equal(eng.processQueue(p, Date.now()), null);
  assert.equal(eng.autoAttack(p, Date.now()), null);
  assert.equal(eng.processWorldQueue(p, Date.now(), {}), null);
}

assert.equal(armorConstant(1), 100);
assert.equal(armorConstant(15), 100);
assert.equal(armorConstant(60), 100 + 45 * 17);
assert.ok(
  Math.abs(mitigationMultiplier(100, 10) - 0.5) < 1e-9,
  "unchanged below level 15",
);
assert.ok(
  mitigationMultiplier(1000, 60) > 0.4,
  "a geared level-60 character no longer takes only ~9% damage",
);
assert.ok(
  mitigationMultiplier(1000, 60) > mitigationMultiplier(1000, 15),
  "the same armor lets more damage through from a higher-level attacker",
);
{
  const mob = { level: 40, armor: 68 };
  const authored = 100 / (100 + mob.armor);
  assert.ok(
    Math.abs(
      mitigationMultiplier(mob.armor, 40, mobArmorScale(mob)) - authored,
    ) < 1e-9,
  );
  const dmg = rollDamage({
    attack: 100,
    power: 1,
    armor: mob.armor,
    attackerLevel: 40,
    armorScale: mobArmorScale(mob),
    critChance: 0,
  });
  assert.ok(dmg.damage > 0);
}
{
  const interruptAbility = abilities.find(
    (a) =>
      (a.tags || []).includes("interrupt") &&
      Number(a.power) > 0 &&
      !a.castTime,
  );
  assert.ok(interruptAbility, "an instant damaging interrupt exists for PvP");
  const eng = makeEngine();
  Object.assign(eng, {
    abilityResourceCost: (p, a) => Number(a.cost || 0),
    rangeMeters: () => 60,
    abilityRangeNormalized: () => 1,
    faceTarget() {},
    targetDamageTakenMultiplier: () => 1,
    healingMultiplier: () => 1,
    gearBeforeCast: () => ({}),
    gearAfterHit: () => [],
    gearAfterHeal: () => [],
    gearAbilityMultiplier: () => 1,
    buildAbilityMultiplier: () => 1,
    trackRotation() {},
    statusModifier: () => 1,
    barrierAmount: () => 0,
    applySelfBuffStatus() {},
    applyOffensiveDebuff() {},
    cleanseStatuses() {},
  });
  eng.world.normalizedMeters = (z, m) => m / 1000;
  eng.world.players = [];
  const pvp = new PvpCombatService(eng);
  const mk = (id, extra = {}) => ({
    id,
    name: id,
    online: true,
    zone: "z",
    x: 0.5,
    y: 0.5,
    level: 5,
    hp: 500,
    maxHp: 500,
    resolve: 100,
    maxResolve: 100,
    attack: 40,
    spellPower: 40,
    armor: 10,
    classId: "arcanist",
    abilityIds: ["arcane_bolt", "basic_strike", interruptAbility.id],
    combat: {},
    bonuses: {},
    statuses: [],
    cooldowns: {},
    equipment: {},
    stats: { agility: 10 },
    pvp: { state: "active" },
    ...extra,
  });
  const realRandom = Math.random;
  try {
    Math.random = () => 0.99;
    const caster = mk("A"),
      victim = mk("B");
    const n0 = Date.now();
    let r = pvp.executePvpCast(caster, byId.arcane_bolt, "B", [victim], [], n0);
    assert.equal(r[0], true, JSON.stringify(r));
    assert.equal(r[1].casting, true, "PvP cast-time abilities start a cast");
    assert.equal(victim.hp, 500, "no damage while casting");
    assert.equal(
      caster.resolve,
      100,
      "nothing is spent until the cast completes",
    );
    assert.equal(
      pvp.executePvpCast(
        caster,
        byId.arcane_bolt,
        "B",
        [victim],
        [],
        n0 + 10,
      )[1],
      "Global cooldown is active.",
      "GCD blocks a second press",
    );
    caster.combat.gcdReadyAt = 0;
    eng.grantCompletion(caster, "arcane_bolt", n0 + 1500);
    r = pvp.executePvpCast(
      caster,
      byId.arcane_bolt,
      "B",
      [victim],
      [],
      n0 + 1500,
    );
    assert.equal(r[0], true, JSON.stringify(r));
    assert.ok(victim.hp < 500, "completion deals damage");
    assert.ok(
      caster.resolve < 100 || !byId.arcane_bolt.cost,
      "cost is paid on completion",
    );
    const rogue = mk("C", {
        classId: "vanguard",
        abilityIds: [interruptAbility.id],
        equipment: { shield: "test_shield" },
      }),
      target = mk("D");
    target.combat.casting = {
      abilityId: "arcane_bolt",
      name: "Arcane Bolt",
      startedAt: n0,
      endsAt: n0 + 5000,
      castMs: 5000,
      kind: "pvp",
      gcdReadyAt: 0,
    };
    r = pvp.executePvpCast(
      rogue,
      byId[interruptAbility.id],
      "D",
      [target],
      [],
      n0 + 100,
    );
    assert.equal(r[0], true, JSON.stringify(r));
    assert.equal(target.combat.casting, null, "the cast was interrupted");
    assert.ok(target.combat.castLockUntil > n0 + 100, "and locked out");
    assert.equal(
      eng.beginCast(target, byId.arcane_bolt, n0 + 200, {
        kind: "pvp",
        command: {},
      })[1],
      "Your spells are locked out.",
    );
    Math.random = () => 0;
    const a2 = mk("E", {
        classId: "vanguard",
        abilityIds: [interruptAbility.id],
        equipment: { shield: "test_shield" },
      }),
      b2 = mk("F");
    r = pvp.executePvpCast(
      a2,
      byId[interruptAbility.id],
      "F",
      [b2],
      [],
      n0 + 300,
    );
    assert.equal(b2.hp, 500, "a missed or dodged PvP ability deals no damage");
    assert.match(String(r[1]), /miss/i);
  } finally {
    Math.random = realRandom;
  }
}

{
  const rows = JSON.parse(
    execFileSync(process.execPath, [
      fileURLToPath(
        new URL("../../scripts/balance-report.mjs", import.meta.url),
      ),
      "--json",
    ]).toString(),
  );
  const means = {};
  for (const r of rows) (means[r.class] ??= []).push(r.openRatio);
  for (const [cls, v] of Object.entries(means)) {
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    assert.ok(
      mean > 0.93 && mean < 0.97,
      `${cls}: average output is ${(mean * 100).toFixed(1)}% of the original kit (target 95%, the 5% miss tax)`,
    );
  }
  for (const level of [10, 30, 60]) {
    const at = rows.filter((r) => r.level === level).map((r) => r.openRatio);
    assert.ok(
      Math.max(...at) - Math.min(...at) < 0.06,
      `class output spread at level ${level} stays under 6 points`,
    );
  }
}

console.log(
  "cast-times: PASS — data, cast lifecycle, grants, interruptions, haste, encounter casts, PvP casts/interrupts/avoidance, level-scaled armor, class balance guard",
);
