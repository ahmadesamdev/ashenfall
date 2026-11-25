import assert from "node:assert/strict";
import fs from "node:fs";
import { Inventory } from "../../dist/server/inventory/Inventory.js";
import { DungeonEngine } from "../../dist/server/world/DungeonEngine.js";
import { QuestEngine } from "../../dist/server/quests/QuestEngine.js";
import { LoadoutService } from "../../dist/server/progression/LoadoutService.js";
import { createProgressionService } from "../../dist/server/runtime/ProgressionService.js";

const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const items = {
  sword: { id: "sword", type: "weapon", name: "Sword" },
  helm: { id: "helm", type: "helmet", name: "Helm" },
  pot: { id: "pot", type: "consumable", name: "Pot" },
};
const inv = new Inventory(items, {}, {});
const sword = () => ({ itemId: "sword", qty: 1 });

{
  const p = {
    inventory: Array.from({ length: 30 }, sword),
    equipment: {},
    gold: 0,
  };
  assert.equal(inv.canGive(p, "sword", 1), false);
  assert.equal(inv.give(p, "sword", 1), false);
  assert.equal(p.inventory.length, 30);
  const q = {
    inventory: Array.from({ length: 29 }, sword),
    equipment: {},
    gold: 0,
  };
  assert.equal(inv.canGive(q, "sword", 2), false, "two copies need two slots");
  assert.equal(inv.give(q, "sword", 1), true);
  assert.equal(q.inventory.length, 30);
}
{
  const p = { inventory: [sword(), sword(), sword()], equipment: {} };
  assert.equal(inv.remove(p, "sword", 4), false);
  assert.equal(p.inventory.length, 3, "failed removal changes nothing");
  assert.equal(inv.remove(p, "sword", 2), true);
  assert.equal(p.inventory.length, 1);
}
assert.equal(
  inv.ownsItem({ inventory: [], equipment: { ring: null } }, null),
  false,
);
assert.equal(
  inv.ownsItem({ inventory: [], equipment: { ring: "sword" } }, "sword"),
  true,
);
{
  const gear = {
    helm: { id: "helm", type: "helmet", name: "Helm", slot: "helmet" },
    helm2: { id: "helm2", type: "helmet", name: "Helm2", slot: "helmet" },
  };
  const filler = Array.from({ length: 29 }, (_, n) => {
    gear[`pot${n}`] = { id: `pot${n}`, type: "consumable", name: "Pot" };
    return { itemId: `pot${n}`, qty: 1 };
  });
  const swap = new Inventory(gear, {}, {});
  swap.recalc = () => {};
  const p = {
    level: 5,
    inventory: [{ itemId: "helm2", qty: 1 }, ...filler],
    equipment: { helmet: "helm" },
    gold: 0,
  };
  const [ok] = swap.equip(p, "helm2");
  assert.equal(ok, true);
  assert.equal(p.equipment.helmet, "helm2");
  assert.equal(p.inventory.length, 30);
  assert.ok(
    p.inventory.some((x) => x.itemId === "helm"),
    "previous helm returns to the bag",
  );
}

const chars = read("server/runtime/commands/CharacterCommands.ts");
assert.match(
  chars,
  /Object\.hasOwn\(unlocks,abilityKey\)/,
  "learn_skill rejects prototype keys",
);
assert.match(
  chars,
  /Object\.hasOwn\(classes\|\|\{\},classKey\)/,
  "create_character rejects prototype keys",
);
assert.match(chars, /You cannot rest during PvP combat/);
assert.match(chars, /Character names must be 2-20 characters/);
const economy = read("server/economy/Economy.ts");
assert.match(
  economy,
  /Math\.max\(start,bo\|\|0\)\*LISTING_FEE_RATE/,
  "listing fee covers the buyout price",
);
assert.match(
  economy,
  /effectiveBid/,
  "buyout-level bids are affordability-checked at the buyout price",
);
const runtime = read("server/runtime/ServerRuntime.ts");
assert.match(runtime, /wsOriginAllowed\(request\)/);
assert.ok(
  runtime.indexOf("commandLimiter.allow()") <
    runtime.indexOf("isPrincipalCurrent"),
  "rate limit precedes the durable session lookup",
);
for (const f of [
  "server/persistence/SQLiteRepository.ts",
  "server/persistence/PostgresRepository.ts",
]) {
  const src = read(f);
  assert.doesNotMatch(
    src,
    /LOWER\(email\)=LOWER/,
    `${f} looks accounts up by the unique email index`,
  );
  assert.doesNotMatch(
    src,
    /Math\.pow\(2,\s*(Math\.min\(8,5\)|5)\)/,
    `${f} outbox backoff depends on attempts`,
  );
}

const data = JSON.parse(read("game-data/items/items.json"));
for (const i of data) {
  if (i.type === "weapon")
    assert.ok(Number(i.power) > 0, `${i.id} has weapon power`);
  for (const k of ["sell", "stack", "attack"])
    assert.ok(!(k in i), `${i.id} uses legacy key ${k}`);
  if (i.type !== "material")
    assert.ok(!("stats" in i), `${i.id} uses legacy key stats`);
}
const pvpSvc = read("server/combat/PvpCombatService.ts");
assert.ok(
  pvpSvc.indexOf("'No enemy is inside the area.'") <
    pvpSvc.indexOf("p.resolve-=cost"),
  "empty self-AoE fails before spending resources",
);
assert.match(
  pvpSvc,
  /targetDamageTakenMultiplier\?\.\(target\)/,
  "basic PvP attacks honour damage-taken modifiers",
);
const pvpCmds = read("server/runtime/commands/PvpCommands.ts");
assert.match(
  pvpCmds,
  /!o\.online\|\|!o\.hasCharacter/,
  "open PvP cannot target offline characters",
);
assert.match(
  pvpCmds,
  /bg\.winner=team/,
  "battleground capture records the winner",
);
const queue = read("server/runtime/QueueService.ts");
assert.match(
  queue,
  /duelHonorLog/,
  "duel honor is rate-limited per opponent pair",
);
const engine = read("server/combat/CombatEngine.ts");
assert.doesNotMatch(
  engine,
  /killed:false\},n\);e\.enemyHp/,
  "encounter hits trigger gear effects once",
);
assert.match(engine, /killed:e\.enemyHp<=0/);
const dungeonCmds = read("server/runtime/commands/DungeonCommands.ts");
assert.match(
  dungeonCmds,
  /member\.pvp\|\|member\.battlegroundId/,
  "party dungeon entry rejects members in PvP",
);
assert.match(
  runtime,
  /scheduleStateFanout\(c,sections\)/,
  "command fan-out is coalesced",
);
assert.match(
  runtime,
  /TRANSIENT_COMMANDS\.has\(cmd\.action\)\)scheduleStateFanout/,
  "movement does not trigger a fan-out",
);

{
  const mk = (id, extra = {}) => ({
    id,
    online: true,
    dungeon: {
      id: "d1",
      instanceId: "inst1",
      leaderId: "a",
      fromZone: "stonehold",
    },
    ...extra,
  });
  const a = mk("a"),
    b = mk("b");
  const world = { players: [a, b], mobs: new Map() };
  const eng = new DungeonEngine(
    [{ id: "d1" }],
    { world, encounters: new Map() },
    {},
    {},
  );
  eng.instances.set("inst1", {
    id: "inst1",
    dungeonId: "d1",
    ownerId: "a",
    memberIds: ["a", "b"],
    state: "ACTIVE",
  });
  const r = eng.abandon(a);
  assert.equal(r[0], true);
  assert.ok(
    eng.instances.has("inst1"),
    "instance survives while another member remains",
  );
  assert.equal(
    b.dungeon.leaderId,
    "b",
    "leadership passes to the remaining member",
  );
  assert.equal(a.dungeon, null);
  const r2 = eng.abandon(b);
  assert.equal(r2[0], true);
  assert.ok(!eng.instances.has("inst1"), "last member closes the instance");
}

{
  const qe = new QuestEngine(
    [{ id: "q1", name: "Q", type: "kill", enemy: "x", amount: 1 }],
    {
      has() {
        return false;
      },
      canGive() {
        return true;
      },
      remove() {
        return true;
      },
    },
    null,
  );
  const p = { level: 5, classId: "x", quests: {} };
  for (const bad of ["__proto__", "constructor", "prototype", "toString"]) {
    const r = qe.accept(p, bad);
    assert.equal(r[0], false, `quest id ${bad} must be rejected`);
  }
  assert.equal({}.accepted, undefined, "Object.prototype was not polluted");
  assert.equal(
    Object.keys(p.quests).length,
    0,
    "unknown quest ids are not persisted into the player record",
  );
  assert.equal(qe.get("q1")?.id, "q1");
}
{
  const gear = {
    helmA: {
      id: "helmA",
      type: "helmet",
      name: "Helm A",
      slot: "helmet",
      level: 1,
    },
    helmB: {
      id: "helmB",
      type: "helmet",
      name: "Helm B",
      slot: "helmet",
      level: 1,
    },
  };
  const bag = new Inventory(gear, {}, {});
  bag.recalc = () => {};
  const svc = new LoadoutService({
    items: gear,
    talents: {},
    classBuilds: {},
    talentTrees: {},
    inventory: bag,
    rebuildTalents() {},
  });
  const p = {
    classId: "x",
    level: 5,
    inventory: [{ itemId: "helmA", qty: 1 }],
    equipment: { helmet: "helmB" },
    stats: {},
    loadouts: [
      { id: "L1", equipment: { helmet: "helmA" }, stats: {}, talents: [] },
    ],
  };
  assert.equal(svc.apply(p, p.loadouts[0])[0], true);
  assert.equal(p.equipment.helmet, "helmA");
  assert.deepEqual(
    p.inventory,
    [{ itemId: "helmB", qty: 1 }],
    "previous gear returns to the bag; the new gear leaves it",
  );
  const full = {
    classId: "x",
    level: 5,
    inventory: Array.from({ length: 30 }, (_, i) => ({
      itemId: `junk${i}`,
      qty: 1,
    })).concat([]),
    equipment: { helmet: "helmB" },
    stats: {},
    loadouts: [
      { id: "L2", equipment: { helmet: null }, stats: {}, talents: [] },
    ],
  };
  for (let i = 0; i < 30; i++)
    gear[`junk${i}`] = { id: `junk${i}`, type: "material", name: "junk" };
  const snapshot = JSON.stringify([full.inventory, full.equipment]);
  assert.equal(
    svc.apply(full, full.loadouts[0])[0],
    false,
    "a full bag blocks unequipping",
  );
  assert.equal(
    JSON.stringify([full.inventory, full.equipment]),
    snapshot,
    "failed swap restores bag and gear exactly",
  );
}
const charCmds = read("server/runtime/commands/CharacterCommands.ts");
assert.match(
  charCmds,
  /You can only travel to a city this way/,
  "travel is restricted to cities",
);
assert.match(charCmds, /Leave your dungeon or PvP match before travelling/);
const movement = read("server/world/WorldMovementService.ts");
assert.match(movement, /isStunnedNow\(player\)/, "stunned players cannot move");
const social = read("server/social/Social.ts");
assert.match(
  social,
  /Number\(g\.memberCap\|\|50\)/,
  "guild capacity honours guild level rewards",
);
assert.doesNotMatch(social, /g\.members\.length>=50/);
const stateSvc = read("server/runtime/StateService.ts");
assert.match(
  stateSvc,
  /dungeon\?\.instanceId/,
  "nearby players are isolated per dungeon instance",
);
const story = read("server/progression/StoryProgression.ts");
assert.doesNotMatch(
  story,
  /totalXp=Number\(p\.totalXp\|\|0\)\+Number/,
  "story XP is granted through gainXp, not by editing totalXp",
);

{
  const lootItems = {
    ore: { id: "ore", type: "material", name: "Ore", stackable: true },
  };
  for (let i = 0; i < 30; i++)
    lootItems[`j${i}`] = { id: `j${i}`, type: "material", name: `J${i}` };
  const lootInv = new Inventory(lootItems, {}, {});
  lootInv.recalc = () => {};
  const mails = [];
  const economy = {
    pushMail: (...a) => {
      mails.push(a);
      return {};
    },
    persist: async () => {},
  };
  const svc = createProgressionService({
    economy,
    inv: lootInv,
    items: lootItems,
    itemization: {},
    talents: {},
    repo: {
      getPlayer() {},
      allPlayers() {
        return [];
      },
    },
    social: { notify() {} },
    quest: {},
    world: {},
    worldEvents: {},
    openWorld: {},
    classes: {},
    enemies: {},
    playerMutations: null,
    xpToNextLevel: () => 100,
    levelAdjustedXp: (x) => x,
    partyXpMultiplier: () => 1,
  });
  const p = {
    id: "p1",
    level: 1,
    inventory: Array.from({ length: 30 }, (_, i) => ({
      itemId: `j${i}`,
      qty: 1,
    })),
    equipment: {},
    gold: 0,
  };
  svc.reward(p, 0, 0, [{ itemId: "ore", qty: 3 }]);
  assert.equal(p.inventory.length, 30, "the bag stays at its cap");
  assert.equal(mails.length, 1, "overflow loot was mailed");
  assert.deepEqual(mails[0][3].items, [{ itemId: "ore", qty: 3 }]);
}
const pvpCmdSrc = read("server/runtime/commands/PvpCommands.ts");
assert.match(
  pvpCmdSrc,
  /You forfeited the duel/,
  "cancelling a duel mid-fight is a forfeit",
);
assert.match(
  pvpCmdSrc,
  /You cannot disengage while in combat/,
  "open-world PvP cannot be dropped mid-fight",
);
const progSrc = read("server/runtime/ProgressionService.ts");
assert.match(progSrc, /mailOverflow\(/);
const rt = read("server/runtime/ServerRuntime.ts");
assert.match(
  rt,
  /LIGHTWEIGHT_ACK_COMMANDS/,
  "successful movement/targeting acks skip the full state snapshot",
);
assert.match(
  rt,
  /findAccountCharacter\(ownerId\)/,
  "connection lookup uses the account index",
);
assert.match(rt, /ASHENFALL_METRICS_TOKEN/);
{
  const base = (lv) => 45 + ((74 / 1.18 - 45) * (lv - 10)) / 5;
  const byId = Object.fromEntries(data.map((i) => [i.id, i]));
  for (const i of data.filter(
    (x) => x.id.startsWith("gear11_chase_") && x.type === "weapon",
  ))
    assert.equal(
      i.power,
      Math.round(base(i.level) * 1.38),
      `${i.id} power follows the legendary multiplier`,
    );
  assert.equal(byId.vaultbreaker.power, Math.round(base(10) * 1.18));
}

{
  const eng = read("server/combat/CombatEngine.ts");
  assert.match(
    eng,
    /spendSnapshot/,
    "failed world casts restore resource, cooldown and GCD",
  );
  assert.match(
    eng,
    /hitAny=true;launched\+\+/,
    "projectile launches mark the cast as connected",
  );
  assert.match(
    eng,
    /if\(!r\?\.\[0\]\)\{lastFailure=/,
    "a rejected hit skips stuns, statuses and debuffs",
  );
  assert.match(eng, /gcdMs\(p,a\)/, "GCD goes through the haste floor");
  const enc = read("server/combat/EncounterEngine.ts");
  assert.match(
    enc,
    /threatOvertakeFactor\(challengerMelee\)/,
    "encounter aggro is sticky",
  );
  assert.match(
    read("server/world/MobSimulationService.ts"),
    /threatOvertakeFactor\(challengerInMelee\)/,
    "world aggro uses the WoW 110%/130% rule",
  );
}

console.log(
  "Audit Batch 49 passed: inventory, auction, command hardening, transport, item-data, PvP, combat, dungeon and fan-out assertions.",
);
