import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (n) => JSON.parse(fs.readFileSync(path.join(root, n), "utf8"));
const quests = read("game-data/quests/quests.json");
const npcs = read("game-data/npcs.json");
const mobs = read("game-data/world-mobs.json");
const dungeons = read("game-data/dungeons.json");
const enemies = read("game-data/enemies/enemies.json");
const progression = read("game-data/progression.json");
const classesList = read("game-data/classes/classes.json");
const classes = Object.fromEntries(classesList.map((c) => [c.id, c]));
const abilitiesList = read("game-data/abilities/abilities.json");
const abilities = Object.fromEntries(abilitiesList.map((a) => [a.id, a]));
const talents = read("game-data/talents.json");
const trees = read("game-data/talent-trees.json");
const qBy = new Map(quests.map((q) => [q.id, q]));
const mobBy = new Map(mobs.map((m) => [m.type, m]));
const npcBy = new Map(npcs.map((n) => [n.id, n]));
const dungeonBy = new Map(dungeons.map((d) => [d.id, d]));
const enemyBy = new Map(enemies.map((e) => [e.id, e]));
const xpNext = (l) => Math.round(400 + 120 * Math.pow(l, 1.5));
const failures = [];
const checks = [];
const assert = (ok, msg) => {
  checks.push([ok, msg]);
  if (!ok) failures.push(msg);
};
assert(
  progression.levels.length === 60 && progression.levels.at(-1).level === 60,
  "progression must define levels 1-60",
);
assert(
  progression.levels[0].statPoints === 0 &&
    progression.levels[0].talentPoints === 0,
  "level 1 must not expose spendable earned points",
);
for (const q of quests) {
  if (q.giver)
    assert(npcBy.has(q.giver), `quest ${q.id} has missing giver ${q.giver}`);
  if (q.giver)
    assert(
      (npcBy.get(q.giver).questIds || []).includes(q.id) ||
        q.category === "world",
      `quest ${q.id} is not discoverable from giver ${q.giver}`,
    );
  for (const r of q.requires || [])
    assert(qBy.has(r), `quest ${q.id} has missing prerequisite ${r}`);
  if (q.type === "kill")
    assert(
      mobBy.has(q.enemy) || enemyBy.has(q.enemy),
      `quest ${q.id} has unresolved kill target ${q.enemy}`,
    );
  if (q.type === "talk")
    assert(
      npcBy.has(q.target),
      `quest ${q.id} has unresolved talk target ${q.target}`,
    );
  if (q.type === "dungeon")
    assert(
      dungeonBy.has(q.target),
      `quest ${q.id} has unresolved dungeon target ${q.target}`,
    );
}
for (const [classId] of Object.entries(classes)) {
  let level = 1,
    xp = 0;
  const claimed = new Set();
  let guard = 0;
  const relevant = quests.filter(
    (q) => q.category === "main_story" || q.category === "class",
  );
  while (claimed.size < relevant.length && guard++ < 1000) {
    let progressed = false;
    for (const q of relevant) {
      if (
        claimed.has(q.id) ||
        !(q.classId === classId || !q.classId || q.category === "main_story")
      )
        continue;
      if (!(q.requires || []).every((r) => claimed.has(r))) continue;
      while (level < (q.minLevel || 1)) {
        xp += Math.max(55, Math.round(55 * (1 + level * 0.12)));
        while (level < 60 && xp >= xpNext(level)) {
          xp -= xpNext(level);
          level++;
        }
      }
      xp += q.xp || 0;
      while (level < 60 && xp >= xpNext(level)) {
        xp -= xpNext(level);
        level++;
      }
      claimed.add(q.id);
      progressed = true;
    }
    if (!progressed) break;
  }
  const mainCount = quests.filter((q) => q.category === "main_story").length;
  assert(
    quests
      .filter((q) => q.category === "main_story")
      .every((q) => claimed.has(q.id)),
    `${classId}: main story chain cannot reach all ${mainCount} quests (stopped at ${claimed.size})`,
  );
  for (const buildId of Object.keys(trees.builds?.[classId] || {}).slice(
    0,
    1,
  )) {
    const nodes = trees.builds[classId][buildId];
    const ranks = new Map();
    let points = 0;
    let spent = 0;
    for (let lvl = 1; lvl <= 60; lvl++) {
      if (lvl > 1) points++;
      for (let safety = 0; safety < 100 && points > 0; safety++) {
        const node = nodes.find(
          (n) =>
            Number(n.minLevel || 1) <= lvl &&
            Number(ranks.get(n.talentId) || 0) < Number(n.rankCap || 1) &&
            (n.requires || []).every((r) => (ranks.get(r) || 0) > 0) &&
            (!n.requiresAny?.length ||
              n.requiresAny.some((r) => (ranks.get(r) || 0) > 0)) &&
            (!n.exclusiveGroup ||
              !nodes.some(
                (x) =>
                  x !== n &&
                  x.exclusiveGroup === n.exclusiveGroup &&
                  (ranks.get(x.talentId) || 0) > 0,
              )),
        );
        if (!node) break;
        ranks.set(node.talentId, (ranks.get(node.talentId) || 0) + 1);
        points--;
        spent++;
      }
    }
    assert(spent > 0, `${classId}: no talent can be learned`);
    assert(spent <= 59, `${classId}: talent simulation overspent points`);
  }
  const def = classes[classId];
  for (const [aid, lvl] of Object.entries(def.abilityUnlocks || {}))
    assert(
      !!abilities[aid],
      `${classId}: ability ${aid} missing from ability catalog`,
    );
}
for (const d of dungeons) {
  assert(
    Array.isArray(d.rooms) && d.rooms.length > 0,
    `dungeon ${d.id} has no rooms`,
  );
  assert(
    Array.isArray(d.stages) && d.stages.length > 0,
    `dungeon ${d.id} has no stages`,
  );
  assert(
    d.entrance &&
      Number.isFinite(Number(d.entrance.x)) &&
      Number.isFinite(Number(d.entrance.y)),
    `dungeon ${d.id} has no valid entrance`,
  );
}
console.log(
  `journey-sim: ${failures.length ? "FAIL" : "PASS"} — ${checks.length} checks, ${failures.length} failures`,
);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exitCode = 1;
}
