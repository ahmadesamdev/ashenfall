import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  PORT = 3800 + Math.floor(Math.random() * 90),
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-"));
const srv = spawn(process.execPath, [path.join(root, "dist/server/index.js")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "development",
    ASHENFALL_REPOSITORY: "sqlite",
    ASHENFALL_SQLITE_FILE: path.join(tmp, "x.sqlite"),
    ASHENFALL_JWT_SECRET: crypto.randomBytes(48).toString("base64url"),
    ASHENFALL_COMMANDS_PER_SECOND: "5000",
  },
});
let err = "";
srv.stderr.on("data", (d) => (err += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break;
  } catch {}
  await sleep(200);
}
const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/guest`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
const cookies = res.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
  headers: { Cookie: cookies },
});
await new Promise((r) => ws.once("open", r));
let st = null;
const logs = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  const s =
    m.type === "state"
      ? m.data
      : m.type === "command_result"
        ? m.data?.state
        : null;
  if (s?.player) {
    st = s;
    for (const l of s.player.worldCombatLog || []) {
      logs.set(l.t + l.msg, l.msg);
    }
  }
});
const send = (o) =>
  ws.send(JSON.stringify({ requestId: "b" + Math.random(), ...o }));
send({
  action: "create_character",
  classId: process.argv[2] || "vanguard",
  name: "Bot" + Math.floor(Math.random() * 1e4),
});
await sleep(800);
const T0 = Date.now();
let stage = "";
while (Date.now() - T0 < (Number(process.argv[3]) || 75) * 1000) {
  await sleep(250);
  if (!st) continue;
  const p = st.player;
  if (p.dead) {
    send({ action: "respawn" });
    continue;
  }
  if (st.zoneInfo?.city) {
    const g = st.gates.find((x) => x.id === "east_gate");
    const d = Math.hypot(p.x - g.x, p.y - g.y);
    if (d > 0.03) send({ action: "move", x: g.x, y: g.y, mode: "run" });
    else send({ action: "use_gate", gateId: g.id });
    stage = "travel";
    continue;
  }
  const mobs = (st.mobs || [])
    .filter((m) => m.hp > 0 && m.state !== "dead")
    .sort(
      (a, b) =>
        Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
    );
  if (!mobs.length) {
    send({
      action: "move",
      x: Math.min(0.95, Math.max(0.05, p.x + (Math.random() - 0.5) * 0.2)),
      y: Math.min(0.95, Math.max(0.05, p.y + (Math.random() - 0.5) * 0.2)),
      mode: "run",
    });
    continue;
  }
  const m = mobs[0];
  stage = "fight";
  if (Math.hypot(m.x - p.x, m.y - p.y) > 0.012 && !p.combat?.casting)
    send({ action: "move", x: m.x, y: m.y, mode: "run" });
  send({ action: "attack_mob", mobId: m.id });
  if (Math.random() < 0.6)
    for (const a of p.abilityIds || [])
      send({ action: "use_world_ability", abilityId: a, mobId: m.id });
}
const all = [...logs.values()];
const c = (re) => all.filter((x) => re.test(x)).length;
const castNames = JSON.parse(
  fs.readFileSync(
    path.join(root, "game-data/abilities/abilities.json"),
    "utf8",
  ),
)
  .filter((a) => a.castTime > 0)
  .map((a) => a.name);
const castsDone = all.filter((x) =>
    castNames.some((n) => x.includes("You use " + n)),
  ).length,
  castsCancelled = all.filter((x) => x.startsWith("✖️")).length;
console.log(
  "cast-time abilities completed:",
  castsDone,
  "| cancelled:",
  castsCancelled,
);
console.log(
  "zone",
  st?.zoneInfo?.id,
  "level",
  st?.player?.level,
  "xp",
  st?.player?.xp,
  "logs",
  all.length,
);
console.log(
  "player misses:",
  c(/misses/i) - c(/misses you/i),
  "| player hits:",
  c(/You use|You hit|for \d+/i),
  "| mob misses you:",
  c(/misses you/),
  "| you dodge:",
  c(/You dodge/),
  "| mob hits you:",
  c(/hits you for/),
);
console.log("sample:", all.slice(-8).join(" || ").slice(0, 700));
const bad = err
  .split("\n")
  .filter((l) =>
    /TypeError|ReferenceError|RangeError|Cannot read|FUZZ_/.test(l),
  );
srv.kill();
if (bad.length) {
  console.error("combat-bot FAIL: server errors:", bad.slice(0, 5).join(" | "));
  process.exit(1);
}
const casterClasses = new Set([
  "arcanist",
  "occultist",
  "hierophant",
  "warden",
]);
if (casterClasses.has(process.argv[2] || "vanguard") && castsDone < 1) {
  console.error(
    "combat-bot FAIL: a caster class never completed a cast-time ability",
  );
  process.exit(1);
}
if (st?.zoneInfo?.city || c(/You use|for \d+/i) < 5) {
  console.error(
    "combat-bot FAIL: no combat took place (zone " +
      st?.zoneInfo?.id +
      ", " +
      all.length +
      " log lines)",
  );
  process.exit(1);
}
console.log(
  `combat-bot: PASS — ${process.argv[2] || "vanguard"} fought in ${st.zoneInfo.id}; misses/dodges/hits all flowed without server errors`,
);
process.exit(0);
