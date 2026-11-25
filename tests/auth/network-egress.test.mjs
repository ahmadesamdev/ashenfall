import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const st = read("server/runtime/StateService.ts");
const rt = read("server/runtime/ServerRuntime.ts");
assert.ok(
  st.includes("STATE_KEEPALIVE_MS") && st.includes("c._stateSig===sig"),
  "unchanged full-state snapshots are skipped",
);
assert.ok(
  st.includes("MOTION_KEEPALIVE_MS") && st.includes("c._motionSig===sig"),
  "unchanged motion packets are skipped",
);
assert.ok(
  st.includes("serverNow:0") && st.includes("sequence:0"),
  "signatures ignore the clock and sequence",
);
assert.ok(
  /perMessageDeflate:\{threshold:512/.test(rt),
  "websocket compression is enabled",
);
console.log("network egress controls wired");
assert.ok(
  rt.includes("[net] connections=") && rt.includes("[net] connect"),
  "connection and traffic logging is wired",
);
for (const f of [
  "WorldSimulation",
  "WorldEcology",
  "RegionalEconomy",
  "EmergentWorldEvents",
  "Chronicle",
]) {
  assert.ok(
    read(`server/world/${f}.ts`).includes("checkpointIfDirty"),
    `${f} has a dirty-gated checkpoint`,
  );
}
assert.ok(
  rt.includes("worldSimulation.checkpointIfDirty") &&
    !rt.includes(
      "worldSimulation.checkpoint(Date.now());\n    regionalEconomy",
    ),
  "periodic checkpoint is dirty-gated",
);
assert.ok(
  read("server/shared/DurableOutboxWorker.ts").includes("idlePolls"),
  "outbox polling backs off when idle",
);
const sim = read("server/world/WorldSimulation.ts");
assert.ok(
  sim.includes("lastLedgerPersistAt") && sim.includes("900_000"),
  "the large event ledger is rewritten at most every 15 minutes",
);
assert.ok(
  sim.includes("this.persist(true, now, true)"),
  "shutdown still flushes everything",
);
assert.ok(
  read("server/persistence/PostgresRepository.ts").includes(
    "_lastWorldPayload",
  ) &&
    read("server/persistence/PostgresRepository.ts").includes(
      "Remember what is already stored",
    ),
  "unchanged world documents are not re-uploaded after boot",
);
assert.ok(
  rt.includes("[db] written_last_min") &&
    read("server/persistence/PostgresRepository.ts").includes("takeWriteStats"),
  "per-minute database write volume is logged",
);
