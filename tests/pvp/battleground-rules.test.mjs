import fs from "node:fs";
import assert from "node:assert/strict";
const queue = fs.readFileSync("server/runtime/QueueService.ts", "utf8");
const pvp = fs.readFileSync("server/runtime/commands/PvpCommands.ts", "utf8");
const coordinator = fs.readFileSync(
  "server/runtime/AuthoritativeSimulationCoordinator.ts",
  "utf8",
);
assert.match(
  queue,
  /p\.zone='battleground';p\.x=team==='red'\?\.18:\.82/,
  "BG participants must be moved to a shared zone and opposing spawn positions",
);
assert.match(
  queue,
  /fromZone:original\.zone,fromX:original\.x,fromY:original\.y/,
  "BG entry must preserve return location",
);
assert.match(
  pvp,
  /if\(p\.dead\|\|Number\(p\.hp\|\|0\)<=0\)return\[false,'You cannot attack while defeated\.'/,
  "Dead players must not attack in BG",
);
assert.match(
  pvp,
  /You cannot capture an objective while defeated/,
  "Dead players must not capture objectives",
);
assert.match(
  pvp,
  /clearPvpTemplate\(x\)/,
  "Capture victory must restore original PvP stats",
);
assert.match(
  pvp,
  /clearPvpTemplate\(p\)/,
  "Leaving BG must restore original PvP stats",
);
assert.match(
  coordinator,
  /const winner=bg\.score\.red===bg\.score\.blue\?null:\(bg\.score\.red>bg\.score\.blue\?'red':'blue'\)/,
  "BG timeout must use score to determine winner",
);
assert.match(
  coordinator,
  /team===winner\?'victory':'defeat'/,
  "BG timeout must record per-player results",
);
assert.match(
  coordinator,
  /finishArena\(m,m\.teamA\.includes\(p\.id\)\?'B':'A','boundary'\)/,
  "Arena boundary leaver must lose",
);
console.log("Audit batch 3 source regressions passed (9 checks).");
