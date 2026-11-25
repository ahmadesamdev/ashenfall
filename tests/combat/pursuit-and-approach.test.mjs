import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const localTypeScript = path.join(
  process.cwd(),
  "node_modules",
  "typescript",
  "lib",
  "typescript.js",
);
const globalTypeScriptCandidates = [
  process.env.NODE_PATH
    ? path.join(process.env.NODE_PATH, "typescript", "lib", "typescript.js")
    : null,
  "/usr/local/lib/node_modules/typescript/lib/typescript.js",
  "/usr/lib/node_modules/typescript/lib/typescript.js",
].filter(Boolean);
const typeScriptPath = fs.existsSync(localTypeScript)
  ? localTypeScript
  : globalTypeScriptCandidates.find((candidate) => fs.existsSync(candidate)) ||
    null;
if (!typeScriptPath)
  throw new Error(
    "TypeScript is not installed. Run npm ci from the project root before running this script.",
  );
const tsModule = await import(pathToFileURL(typeScriptPath).href);
const ts = tsModule.default || tsModule;

const root = process.cwd();
const out = "/mnt/data/ashenfall-hardening-dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ["server/world", "server/combat", "server/shared"]) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(abs, f), "utf8");
    const js = ts.transpileModule(src, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
      },
    }).outputText;
    const dest = path.join(out, dir, f.replace(/\.ts$/, ".js"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, js);
  }
}
const { WorldMovementService } = await import(
  "file://" + out + "/server/world/WorldMovementService.js"
);
const world = {
  zoneConfig: () => ({ worldMeters: 1000 }),
  isBlocked: () => false,
  resolveWalkableStep(_z, _x, _y, nx, ny) {
    return { x: nx, y: ny, blocked: false };
  },
  normalizedMeters: (_z, m) => m / 1000,
  worldMetersFor: () => 1000,
  zoneGates: () => [],
  zoneNpcs: () => [],
  travel: () => [true, "ok"],
  approachPoint(player, target, stop = 18) {
    const d = Math.hypot(player.x - target.x, player.y - target.y);
    if (d <= stop / 1000) return { x: player.x, y: player.y };
    return {
      x: target.x + ((player.x - target.x) / d) * (stop / 1000),
      y: target.y + ((player.y - target.y) / d) * (stop / 1000),
    };
  },
  byIdMob(id) {
    return this.mob?.id === id ? this.mob : null;
  },
};
const service = new WorldMovementService(world);
const stoppedPlayer = {
  id: "stop-test",
  zone: "z",
  x: 0.2,
  y: 0.5,
  targetMobId: "m",
  movementIntent: "combat",
  moveState: "moving",
  moveInput: null,
  combat: {
    autoApproach: true,
    autoAttack: true,
    manualMove: false,
    queuedWorldAbility: "heavy_strike",
    approachSatisfied: false,
  },
};
service.stop(stoppedPlayer);
if (
  stoppedPlayer.combat.autoApproach ||
  stoppedPlayer.combat.queuedWorldAbility ||
  !stoppedPlayer.combat.manualMove ||
  stoppedPlayer.movementIntent !== "manual" ||
  stoppedPlayer.moveState !== "idle"
)
  throw new Error("stop command left combat pursuit ownership active");
const p = {
  id: "p",
  zone: "z",
  x: 0.2,
  y: 0.5,
  targetMobId: "m",
  movementIntent: "combat",
  moveState: "moving",
  movementMode: "run",
  speed: 45,
  runSpeed: 45,
  moveInput: null,
  combat: {
    autoApproach: true,
    manualMove: false,
    approachSatisfied: false,
    approachRangeMeters: 18,
  },
};
world.mob = { id: "m", zone: "z", x: 0.8, y: 0.5, state: "engaged" };
const oldAp = world.approachPoint(p, { x: 0.6, y: 0.5 }, 18);
service.updatePlayerMovement(p, 0.05);
if (Math.abs(p.targetX - oldAp.x) < 1e-9)
  throw new Error("movement retained a stale mob destination");
const firstTarget = p.targetX;
world.mob.x = 0.9;
service.updatePlayerMovement(p, 0.05);
if (!(p.targetX > firstTarget))
  throw new Error("movement did not recompute toward the mob's new position");
if (p.targetX > 0.901 || p.targetX < 0.8)
  throw new Error(`unexpected live approach target ${p.targetX}`);
p.x = 0.882;
p.y = 0.5;
p.worldCombatMobId = "m";
p.combat.autoAttack = true;
p.combat.approachSatisfied = true;
p.combat.autoApproach = false;
p.moveState = "idle";
p.movementIntent = "combat";
world.mob.x = 0.9;
service.updatePlayerMovement(p, 0.05);
if (p.combat.autoApproach || p.moveState !== "idle")
  throw new Error(
    "player should remain stopped while the mob is within the attack-range hysteresis",
  );
world.mob.x = 0.95;
service.updatePlayerMovement(p, 0.05);
if (!p.combat.autoApproach || p.moveState !== "moving" || p.targetX <= 0.9)
  throw new Error(
    "active combat did not resume pursuit when the mob moved beyond range",
  );

const renderer = fs.readFileSync(
  path.join(root, "client/runtime/WorldRenderer.ts"),
  "utf8",
);
if (
  !renderer.includes(
    "const activeTarget=String(p.targetMobId||'')===String(m.id)",
  )
)
  throw new Error("approach line is still gated on bilateral combat ID");
if (
  !renderer.includes("const approachRequested=") ||
  !renderer.includes(
    "const showApproachLine=activeTarget&&approachRequested",
  ) ||
  !renderer.includes("localCombatIntent")
)
  throw new Error(
    "approach line does not follow live local/server combat approach state",
  );
if (renderer.includes("approachLineTargetId"))
  throw new Error("approach line remains latched after combat cancellation");
if (!renderer.includes("currentZoneId==='stonehold'"))
  throw new Error(
    "Stonehold must suppress the stray player-centred approach line",
  );
if (!renderer.includes("targetOnScreen=tm.x>=0&&tm.x<=w&&tm.y>=0&&tm.y<=h"))
  throw new Error("approach line must not extend to off-screen targets");
if (renderer.includes("!targetIsRendered"))
  throw new Error("approach line incorrectly depends on a warmed render cache");
if (
  !renderer.includes("const visuallySatisfied=distanceMeters<=stopMeters+1.5;")
)
  throw new Error(
    "approach line waits for a server snapshot after reaching local attack range",
  );
if (
  !renderer.includes("maxBackingW=1920,maxBackingH=1080") ||
  !renderer.includes("Math.min(1.5,window.devicePixelRatio||1)")
)
  throw new Error("world canvas pixel budget is not bounded for performance");

const commands = fs.readFileSync(
  path.join(root, "server/runtime/CommandHandlers.ts"),
  "utf8",
);
if (
  !commands.includes(
    "const cooldownSeconds=Math.max(1,Number(items[itemId]?.cooldown||1200))",
  )
)
  throw new Error("homeward stone does not use item-data cooldown");
if (commands.includes("inv.remove(p,itemId,1)"))
  throw new Error("homeward stone still consumes inventory");
const item = JSON.parse(
  fs.readFileSync(path.join(root, "game-data/items/items.json"), "utf8"),
);
const stone = item.find((x) => x.id === "ashen_homeward_stone");
if (!stone || stone.cooldown !== 1200)
  throw new Error("homeward stone data cooldown mismatch");
console.log(
  "movement-combat-hardening: PASS — live mob pursuit retargets, approach route is render-cache independent and range-aware, canvas pixel budget is capped, city beige stripe is removed, homeward stone is reusable with a 20-minute cooldown",
);
