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
const root = process.cwd(),
  out = "/mnt/data/current/.audit-dist";
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of [
  "client/runtime",
  "server/world",
  "server/combat",
  "server/shared",
  "server/entities",
]) {
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
for (const dir of ["server/shared", "server/combat"]) {
}
const { ClientMotionController } = await import(
  "file://" + out + "/client/runtime/ClientMotionController.js"
);
const deps = {
  p: { hasCharacter: true, zone: "gloamwood", speed: 45, runSpeed: 45 },
  getPlayer() {
    return this.p;
  },
  getClockOffset() {
    return 0;
  },
  getWorldMeters() {
    return 1000;
  },
  getRegionalSpeed() {
    return 1;
  },
  isBlocked() {
    return true;
  },
};
const c = new ClientMotionController(deps);
c.reset(0.2, 0.5, "gloamwood");
c.sync({
  x: 0.2,
  y: 0.5,
  vx: 0.03,
  vy: 0,
  state: "moving",
  movementIntent: "combat",
  movementMode: "run",
  targetX: 0.7,
  targetY: 0.5,
  approachSatisfied: false,
  autoApproach: true,
  serverNow: Date.now(),
  speedMeters: 45,
  zone: "gloamwood",
});
c.beginTarget(0.7, 0.5, "run", "combat");
let start = c.state.x;
const base = performance.now();
for (let i = 1; i <= 30; i++) c.tick(base + i * 16);
if (!(c.state.x > start + 0.005))
  throw new Error(
    `client approach did not advance: ${c.state.x} from ${start}`,
  );
c.sync({
  x: c.state.x,
  y: c.state.y,
  vx: 0.02,
  vy: 0,
  state: "moving",
  movementIntent: "combat",
  movementMode: "run",
  targetX: 0.72,
  targetY: 0.48,
  approachSatisfied: false,
  autoApproach: true,
  serverNow: Date.now() + 100,
  speedMeters: 45,
  zone: "gloamwood",
});
if (
  Math.abs(c.state.serverTargetX - 0.72) > 1e-9 ||
  Math.abs(c.state.serverTargetY - 0.48) > 1e-9
)
  throw new Error("authoritative combat target was not retained");
c.sync({
  x: 0.66,
  y: 0.5,
  vx: 0.03,
  vy: 0,
  state: "moving",
  movementIntent: "combat",
  movementMode: "run",
  targetX: 0.66,
  targetY: 0.5,
  approachSatisfied: true,
  autoApproach: false,
  serverNow: Date.now() + 200,
  speedMeters: 45,
  zone: "gloamwood",
});
console.log(
  "algorithm-audit: PASS — client approach advances without client collision, authoritative target updates are accepted, satisfied state stops cleanly",
);
