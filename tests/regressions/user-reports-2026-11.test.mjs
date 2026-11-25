import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { WorldMovementService } from "../../dist/server/world/WorldMovementService.js";
import { WorldCombatService } from "../../dist/server/world/WorldCombatService.js";

const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// 1. Sprite facing: every class sprite except the rogue is drawn facing LEFT in its source art.
const renderer = read("client/runtime/WorldRenderer.ts");
const m = renderer.match(/const SPRITE_BASE_DIRECTION:any=\{([^}]*)\}/);
assert.ok(m, "SPRITE_BASE_DIRECTION missing");
const dirs = Object.fromEntries(
  m[1]
    .split(",")
    .map((s) => s.split(":").map((x) => x.trim()))
    .map(([k, v]) => [k, Number(v)]),
);
for (const id of [
  "vanguard",
  "arcanist",
  "warden",
  "ranger",
  "templar",
  "occultist",
  "reaver",
  "hierophant",
])
  assert.equal(dirs[id], -1, `${id} sprite art faces left`);
assert.equal(dirs.shadowblade, 1, "shadowblade (Rogue) art faces right");
// drawWorldSprite must flip only when the wanted facing differs from the art's native facing
assert.ok(
  renderer.includes("const scaleX=facing===base?1:-1;"),
  "sprite flip rule changed",
);

// 2. A dead player's stale movement input must be cleared so they do not walk after respawn.
const host = {
  zoneConfig: () => ({ worldMeters: 10000 }),
  isBlocked: () => false,
  resolveWalkableStep: (_z, _x, _y, nx, ny) => ({
    x: nx,
    y: ny,
    blocked: false,
  }),
  normalizedMeters: (_z, mtr) => mtr / 10000,
  worldMetersFor: () => 10000,
  zoneGates: () => [],
  zoneNpcs: () => [],
  travel: () => [false, ""],
  approachPoint: (p) => ({ x: p.x, y: p.y }),
};
const svc = new WorldMovementService(host);
const p = {
  id: "p1",
  zone: "z",
  x: 0.5,
  y: 0.5,
  dead: true,
  moveInput: { x: 1, y: 0 },
  moveState: "moving",
  velocityX: 3,
  velocityY: 0,
  targetX: 0.9,
  targetY: 0.5,
  combat: {},
};
svc.updatePlayerMovement(p, 1);
assert.equal(p.moveInput, null);
assert.equal(p.moveState, "idle");
assert.equal(p.x, 0.5);
assert.equal(p.velocityX, 0);

// 3. Loot pickup mid-fight must not throw when the mob has no attackers map.
const mob = { id: "m1", state: "idle", zone: "z" };
const world = {
  lootPiles: new Map([
    [
      "l1",
      {
        id: "l1",
        zone: "z",
        x: 0.5,
        y: 0.5,
        eligible: ["p2"],
        expiresAt: Date.now() + 5000,
        items: [],
        gold: 1,
      },
    ],
  ]),
  byIdMob: () => mob,
  normalizedMeters: () => 0.1,
};
const cs = new WorldCombatService(world);
const looter = {
  id: "p2",
  zone: "z",
  x: 0.5,
  y: 0.5,
  worldCombatMobId: "m1",
  targetMobId: "m1",
  combat: {},
};
assert.doesNotThrow(() => cs.pickupLoot(looter, "l1"));

// 4. Source guards for the combat-command and DoT fixes
const cmds = read("server/runtime/commands/WorldCombatCommands.ts");
assert.ok(
  (cmds.match(/sameDungeonInstance\(m,p\)/g) || []).length >= 5,
  "target/attack/ability handlers must check dungeon instance",
);
assert.ok(
  read("server/runtime/WorldCombatSimulationService.ts").includes(
    "finalizeMobDeath(null,m)",
  ),
  "sourceless DoT kills must finalize the mob",
);
assert.ok(
  read("client/ClientApplicationRuntime.ts").includes(
    "if(e.ctrlKey||e.metaKey||e.altKey)return;",
  ),
  "modifier chords must not start WASD movement",
);
const css = read("client/style.css");
assert.ok(
  /body\.auth-gate \.viewport-wrap canvas#minimap[\s\S]*display:none!important/.test(
    css,
  ),
  "minimap must be hidden behind the auth gate",
);
console.log(
  "release-fixes-2026-11-23: PASS — sprite facing, dead-player movement reset, loot-pickup guard, instance-safe targeting, sourceless DoT kill, modifier-key movement",
);
