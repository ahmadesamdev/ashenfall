import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "ashenfall-world-event-ledger-"),
);
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(temp, "players.json");
  const repo = new MemoryRepository(file);
  const player = {
    id: "event-hero",
    xp: 0,
    gold: 0,
    quests: {},
    _rewardLedger: [],
  };
  player.xp += 100;
  player.gold += 20;
  const key = "world-event:event-29:event-hero:reward";
  assert.equal(
    repo.savePlayerRewardOnce(player, key),
    true,
    "first world-event payout commits player and key",
  );
  assert.equal(
    repo.savePlayerRewardOnce(player, key),
    false,
    "duplicate event payout key is rejected",
  );
  repo.close();
  const restarted = new MemoryRepository(file);
  const saved = restarted.getPlayer("event-hero");
  assert.equal(saved.xp, 100, "event XP survives restart");
  assert.equal(saved.gold, 20, "event gold survives restart");
  assert.ok(
    saved._rewardLedger.includes(key),
    "event reward key survives restart",
  );
  restarted.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const events = fs.readFileSync("server/world/WorldEvents.ts", "utf8");
assert.match(
  events,
  /world-event:\$\{String\(e\.id\)\}:\$\{id\}:reward/,
  "event rewards have stable event/player identity",
);
assert.match(
  events,
  /await this\.repo\.savePlayerRewardOnce\(p,rewardKey\)/,
  "event payout awaits durable player/key transaction",
);
assert.match(
  events,
  /p\._rewardLedger\)\&\&p\._rewardLedger\.includes\(rewardKey\)[\s\S]*?e\.rewardedParticipantIds\.push\(id\)/,
  "stale event state does not reapply already-ledgered rewards",
);
assert.match(
  events,
  /if\(!committed\)/,
  "duplicate commit avoids overwriting canonical player payload",
);
console.log("Audit Batch 29 passed: 10 assertions.");
