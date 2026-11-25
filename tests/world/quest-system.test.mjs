import fs from "node:fs";
import assert from "node:assert/strict";
import { QuestEngine } from "../../dist/server/quests/QuestEngine.js";

const quests = JSON.parse(
  fs.readFileSync(
    new URL("../../game-data/quests/quests.json", import.meta.url),
    "utf8",
  ),
);
const world = { players: [], worldEventState: {}, normalizedMeters: () => 1 };
const inv = { has: () => false, give: () => {} };
const engine = new QuestEngine(quests, inv, world);
const player = {
  id: "quest-test",
  level: 20,
  classId: "vanguard",
  zone: "gloamwood",
  x: 0.2,
  y: 0.5,
  online: true,
  dead: false,
  partyId: null,
  quests: {},
  storyFlags: {},
};
engine.ensure(player);

const lost = engine.state(player, "lost_patrol");
const side = engine.state(player, "lantern_guard_side");
lost.accepted = true;
lost.visible = true;
side.accepted = true;
side.visible = true;

for (let i = 0; i < 3; i++) engine.onKill(player, "hollow_wolf");
assert.equal(player.quests.lost_patrol.progress, 1);
assert.equal(player.quests.lost_patrol.complete, true);
assert.equal(player.quests.lantern_guard_side.progress, 3);
assert.equal(player.quests.lantern_guard_side.complete, true);

const fresh = {
  id: "quest-test-2",
  level: 20,
  classId: "vanguard",
  zone: "gloamwood",
  x: 0.2,
  y: 0.5,
  online: true,
  dead: false,
  partyId: null,
  quests: {},
  storyFlags: {},
};
engine.ensure(fresh);
const offers = engine.offersForNpc(fresh, {
  questIds: ["lost_patrol", "lantern_guard_side"],
});
assert.equal(offers.length, 2);
assert.ok(offers.every((x) => x.requirementsMet === false));

const locked = engine.state(fresh, "lost_patrol");
const accepted = engine.accept(fresh, "lost_patrol");
assert.equal(accepted[0], false);
assert.equal(locked.accepted, false);

console.log(
  "quest-system: PASS — kill progress, completion, prerequisites and locked NPC offers verified",
);
