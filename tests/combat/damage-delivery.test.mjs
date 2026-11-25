// Every skill that should hurt a mob in range must hurt it, and projectiles must never swallow committed damage.
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadGameCatalog } from "../../dist/server/data/DataCatalog.js";
import { World } from "../../dist/server/world/World.js";
import { CombatEngine } from "../../dist/server/combat/CombatEngine.js";
import { CombatProjectileService } from "../../dist/server/combat/CombatProjectileService.js";
import { Inventory } from "../../dist/server/inventory/Inventory.js";
import { createPlayer } from "../../dist/server/entities/Player.js";

const c = loadGameCatalog(process.cwd());
let clock = Date.now();
const realNow = Date.now;
Date.now = () => clock;
try {
  const inv = new Inventory(c.items, c.combatGearSynergies, c.itemization);
  const world = new World(
    c.zones,
    c.worldMobDefs,
    c.npcs,
    c.gates,
    c.worldLayout,
    c.worldZoneProgression,
    c.mobBehaviorProfiles,
    c.npcScheduleProfiles.profiles || {},
    c.regionTraversalProfiles,
  );
  world.players = [];
  const combat = new CombatEngine({
    abilities: c.abilities,
    enemies: c.enemies,
    items: c.items,
    inv,
    world,
    combatSynergies: c.combatSynergies,
    talentTransformations: c.talentTransformations,
    combatResources: c.combatResources,
    combatRotations: c.combatRotations,
  });
  const mobs = [...world.mobs.values()].filter((m) => m.state !== "dead");
  const zone = c.zones.find((z) => mobs.some((m) => m.zone === z.id));
  const mob = mobs.find((m) => m.zone === zone.id);

  // 1. every class: every damaging ability (instant, cast-time and projectile) lowers the mob's HP.
  const dead = [];
  for (const cls of Object.values(c.classes)) {
    const p = createPlayer("T", cls, zone);
    p.online = true;
    p.hasCharacter = true;
    p.level = 10;
    p.equipment.shield = "wooden_shield";
    p.combat.revengeUntil = clock + 1e9;
    world.players.push(p);
    inv.recalc?.(p);
    for (const id of p.abilityIds) {
      const a = c.abilities[id] || {};
      if (!(a.power > 0) || a.selfBuff || a.heal) continue;
      mob.hp = mob.maxHp = 1e6;
      mob.state = "idle";
      mob.zone = p.zone;
      mob.x = p.x + 0.0005;
      mob.y = p.y;
      mob.armor = 0;
      p.resolve = p.maxResolve = 1000;
      p.hp = p.maxHp = 1e6;
      p.cooldowns = {};
      p.combat.gcdReadyAt = 0;
      p.combat.autoAttackNextAt = 0;
      p.combat.casting = null;
      clock += 5000;
      const before = mob.hp;
      for (let tries = 0; tries < 8 && mob.hp >= before; tries++) {
        combat.requestWorldCast(p, id, mob);
        for (let i = 0; i < 80; i++) {
          clock += 50;
          const ct = combat.tickCast(p, clock);
          if (ct?.complete) {
            combat.grantCompletion(p, id, clock);
            p.combat.gcdReadyAt = 0;
            combat.requestWorldCast(p, id, mob);
            p.combat.casting = null;
          }
          combat.tickProjectiles(clock);
        }
        p.cooldowns = {};
        p.combat.gcdReadyAt = 0;
        p.combat.autoAttackNextAt = 0;
        p.combat.casting = null;
      }
      if (mob.hp >= before) dead.push(`${cls.id}:${id}`);
    }
  }
  assert.deepEqual(
    dead,
    [],
    `abilities that never damaged an in-range mob: ${dead.join(", ")}`,
  );

  // 2. a projectile that cannot catch a fleeing target still lands (damage was committed when it was cast).
  let impacts = 0;
  const target = { id: "m", x: 0.5, y: 0.5, state: "engaged", zone: "z" };
  const owner = { id: "p", x: 0.4, y: 0.5, zone: "z", combatFx: [] };
  const svc = new CombatProjectileService({
    world: {
      worldMetersFor: () => 1000,
      mobs: new Map([["m", target]]),
      players: [owner],
    },
    onImpact: () => {
      impacts++;
      return [true, {}];
    },
  });
  const proj = svc.launch(
    owner,
    {
      id: "steady_shot",
      combatFeel: { projectileHoming: true, projectileKind: "arrow" },
    },
    target,
    10,
    false,
    clock,
    {},
  );
  for (let t = 0; t < 40; t++) {
    clock += 50;
    target.x += 0.004;
    svc.tick(clock);
  }
  assert.equal(
    impacts,
    1,
    "late projectile must still deliver its damage exactly once",
  );
  assert.equal(svc.projectiles.size, 0, "projectile removed after impact");
} finally {
  Date.now = realNow;
}

// 3. source guards for the swing refund and the out-of-range notice
const eng = fs.readFileSync("server/combat/CombatEngine.ts", "utf8");
assert.ok(
  eng.includes("swingSnapshot") &&
    eng.includes("p.combat.autoAttackNextAt=swingSnapshot.next"),
  "an auto-attack that did not connect must not burn the swing timer",
);
assert.ok(
  fs
    .readFileSync("server/runtime/ServerRuntime.ts", "utf8")
    .includes("Out of range"),
  "held-back auto-attacks must tell the player why",
);
console.log("damage-delivery: PASS");
