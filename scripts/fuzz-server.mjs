import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { WebSocket } from "ws";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const COMMANDS = Number(process.argv[2] || 1500),
  CLIENTS = Number(process.argv[3] || 3);
let seed = Number(process.argv[4] || 1);
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pick = (a) => a[Math.floor(rnd() * a.length)];
const PORT = 3900 + Math.floor(Math.random() * 90);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ashenfall-fuzz-"));
const read = (n) => JSON.parse(fs.readFileSync(path.join(root, n), "utf8"));
const ids = {
  items: read("game-data/items/items.json").map((x) => x.id),
  abilities: read("game-data/abilities/abilities.json").map((x) => x.id),
  quests: read("game-data/quests/quests.json").map((x) => x.id),
  npcs: read("game-data/npcs.json").map((x) => x.id),
  zones: read("game-data/zones/zones.json").map((x) => x.id),
  enemies: read("game-data/enemies/enemies.json").map((x) => x.id),
  dungeons: read("game-data/dungeons.json").map((x) => x.id),
  recipes: read("game-data/recipes.json").map((x) => x.id),
  classes: read("game-data/classes/classes.json").map((x) => x.id),
};
const all = Object.values(ids).flat();
const hostile = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "hasOwnProperty",
  "",
  " ",
  "<img src=x onerror=alert(1)>",
  "A".repeat(5000),
  -1,
  0,
  1,
  2 ** 53,
  1e308,
  -1e308,
  "NaN",
  "Infinity",
  null,
  true,
  false,
  [],
  {},
  [1, 2, 3],
  { a: { b: 1 } },
  "../../etc/passwd",
  "\u0000",
  "😀",
  0.5,
  -0.5,
  "1e999",
];
const keys = [
  "abilityId",
  "itemId",
  "qty",
  "price",
  "buyout",
  "auctionId",
  "bid",
  "questId",
  "npcId",
  "targetId",
  "targetPlayerId",
  "zoneId",
  "gateId",
  "x",
  "y",
  "dx",
  "dy",
  "mode",
  "text",
  "name",
  "classId",
  "recipeId",
  "shopId",
  "slot",
  "tokenId",
  "setId",
  "gemId",
  "itemIds",
  "mobId",
  "enemyId",
  "dungeonId",
  "partyId",
  "guildId",
  "rank",
  "role",
  "choice",
  "rollId",
  "tradeId",
  "gold",
  "amount",
  "id",
  "playerId",
  "oreId",
  "lootId",
  "chestId",
  "talentId",
  "buildId",
  "statPoints",
  "stat",
  "outcome",
  "contractId",
  "opportunityId",
  "description",
  "motd",
];
const sourceActions = new Set();
for (const f of fs.readdirSync(path.join(root, "server/runtime"), {
  recursive: true,
})) {
  if (!String(f).endsWith(".ts")) continue;
  for (const m of fs
    .readFileSync(path.join(root, "server/runtime", String(f)), "utf8")
    .matchAll(/handlers\['([a-z_0-9]+)'\]/g))
    sourceActions.add(m[1]);
}
const skip = new Set(["logout"]);
const actions = [...sourceActions].filter((a) => !skip.has(a));
const value = () =>
  rnd() < 0.55
    ? pick(all)
    : rnd() < 0.5
      ? pick(hostile)
      : Math.floor(rnd() * 40) - 5;
const makeCommand = () => {
  const cmd = {
    action: pick(actions),
    requestId: "r" + Math.floor(rnd() * 1e9),
  };
  for (let i = 0, n = Math.floor(rnd() * 6); i < n; i++)
    cmd[pick(keys)] = value();
  return cmd;
};

const canary = path.join(tmp, "canary.cjs");
fs.writeFileSync(
  canary,
  `
const base=new Set(Object.getOwnPropertyNames(Object.prototype));
setInterval(()=>{const now=Object.getOwnPropertyNames(Object.prototype).filter(k=>!base.has(k));if(now.length)console.error('FUZZ_POLLUTED',now.join(','));},100);
process.on('unhandledRejection',e=>console.error('FUZZ_UNHANDLED_REJECTION',e&&e.stack||e));
process.on('uncaughtException',e=>{console.error('FUZZ_UNCAUGHT',e&&e.stack||e);process.exit(99);});
`,
);
const server = spawn(
  process.execPath,
  ["--require", canary, path.join(root, "dist/server/index.js")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "development",
      ASHENFALL_REPOSITORY: "sqlite",
      ASHENFALL_SQLITE_FILE: path.join(tmp, "fuzz.sqlite"),
      ASHENFALL_JWT_SECRET: crypto.randomBytes(48).toString("base64url"),
      ASHENFALL_COMMANDS_PER_SECOND: "5000",
      BCRYPT_ROUNDS: "4",
    },
  },
);
let stderr = "",
  stdout = "",
  exited = null;
server.stderr.on("data", (d) => {
  stderr += d;
});
server.stdout.on("data", (d) => {
  stdout += d;
});
server.on("exit", (c) => {
  exited = c;
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = async (msg) => {
  console.error("FUZZ FAIL:", msg);
  console.error(
    stderr
      .split("\n")
      .filter((l) => /FUZZ_|Error|error/.test(l))
      .slice(-25)
      .join("\n"),
  );
  server.kill("SIGKILL");
  process.exit(1);
};

for (let i = 0; i < 100 && !exited; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break;
  } catch {}
  await sleep(200);
}
if (exited)
  await fail(`server exited during boot (${exited})\n${stderr}${stdout}`);

const stats = { sample: [], sent: 0, ok: 0, rejected: 0, errors: new Map() };
async function runClient(n) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/auth/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const cookies = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookies.includes("ashenfall_access"))
    throw new Error("guest auth failed: " + res.status);
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
    headers: { Cookie: cookies },
  });
  await new Promise((ok, bad) => {
    ws.once("open", ok);
    ws.once("error", bad);
  });
  ws.on("message", (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      stats.types = stats.types || new Map();
      stats.types.set(m.type, (stats.types.get(m.type) || 0) + 1);
      stats.results =
        (stats.results || 0) + (m.type === "command_result" ? 1 : 0);
      if (m.type === "command_result" && stats.sample.length < 8)
        stats.sample.push(JSON.stringify(m).slice(0, 160));
      if (m.type === "command_result") {
        m.data?.ok === false ? stats.rejected++ : stats.ok++;
      }
    } catch {}
  });
  let sentByClient = 0,
    resultsByClient = 0;
  ws.on("message", (raw) => {
    if (raw.length < 300 || String(raw).startsWith('{"type":"command_result"'))
      resultsByClient++;
  });
  const send = (o) => {
    stats.sent++;
    ws.send(JSON.stringify(o));
  };
  send({
    action: "create_character",
    classId: pick(ids.classes),
    name: `Fuzzer${n}${Math.floor(rnd() * 1000)}`,
  });
  await sleep(400);
  for (let i = 0; i < COMMANDS && !exited; i++) {
    send(makeCommand());
    sentByClient++;
    for (
      let w = 0;
      w < 400 && sentByClient - resultsByClient > 15 && !exited;
      w++
    )
      await sleep(25);
    if (ws.readyState !== WebSocket.OPEN) {
      const again = await fetch(`http://127.0.0.1:${PORT}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (!again) break;
      return;
    }
  }
  for (
    let w = 0;
    w < 900 && (stats.results || 0) < stats.sent * 0.9 && !exited;
    w++
  )
    await sleep(100);
  ws.close();
}
try {
  await Promise.all(Array.from({ length: CLIENTS }, (_, i) => runClient(i)));
} catch (e) {
  await fail("client error: " + e.message);
}
await sleep(800);
if (exited) await fail(`server crashed with exit code ${exited}`);
const bad = stderr
  .split("\n")
  .filter((l) =>
    /FUZZ_(POLLUTED|UNCAUGHT|UNHANDLED)|TypeError|ReferenceError|RangeError|Cannot read prop/.test(
      l,
    ),
  );
if (bad.length)
  await fail(
    `server logged ${bad.length} suspicious lines:\n${[...new Set(bad)].slice(0, 25).join("\n")}`,
  );
const health = await fetch(`http://127.0.0.1:${PORT}/ready`)
  .then((r) => r.status)
  .catch(() => 0);
server.kill("SIGTERM");
await sleep(1500);
{
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(tmp, "fuzz.sqlite"));
  const problems = [];
  for (const row of db.prepare("SELECT id,data FROM players").all()) {
    let p;
    try {
      p = JSON.parse(String(row.data));
    } catch {
      problems.push(`${row.id}: unparsable`);
      continue;
    }
    if (!p.hasCharacter) continue;
    const num = (
      k,
      v,
      { min = -Infinity, max = Infinity, int = false } = {},
    ) => {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        v < min ||
        v > max ||
        (int && !Number.isInteger(v))
      )
        problems.push(`${p.name}.${k}=${JSON.stringify(v)}`);
    };
    num("gold", p.gold, { min: 0, int: true });
    num("hp", p.hp, { min: 0 });
    num("maxHp", p.maxHp, { min: 1 });
    num("level", p.level, { min: 1, max: 60, int: true });
    num("xp", p.xp, { min: 0 });
    num("x", p.x, { min: 0, max: 1 });
    num("y", p.y, { min: 0, max: 1 });
    if (p.hp > p.maxHp + 1e-6)
      problems.push(`${p.name}.hp ${p.hp} > maxHp ${p.maxHp}`);
    if (!Array.isArray(p.inventory) || p.inventory.length > 30)
      problems.push(`${p.name}.inventory size ${p.inventory?.length}`);
    for (const it of p.inventory || [])
      if (!it?.itemId || !Number.isInteger(it.qty) || it.qty < 1)
        problems.push(`${p.name}.inventory bad entry ${JSON.stringify(it)}`);
    for (const k of Object.keys(p.quests || {}))
      if (!ids.quests.includes(k))
        problems.push(`${p.name}.quests has unknown key ${k}`);
    if (JSON.stringify(p).length > 400000)
      problems.push(`${p.name} payload ${JSON.stringify(p).length} bytes`);
  }
  if (problems.length) {
    console.error(
      "FUZZ FAIL: invariant violations:\n" +
        [...new Set(problems)].slice(0, 25).join("\n"),
    );
    process.exit(1);
  }
}
console.log(
  `fuzz-server: PASS — ${stats.sent} commands from ${CLIENTS} clients, server stayed up (ready=${health}), no pollution or unhandled errors`,
);
if (process.env.FUZZ_VERBOSE)
  console.log(
    JSON.stringify({
      types: [...(stats.types || [])],
      sample: stats.sample,
      ok: stats.ok,
      rejected: stats.rejected,
    }),
  );
process.exit(0);
