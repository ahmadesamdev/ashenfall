import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temp = fs.mkdtempSync(
  path.join(os.tmpdir(), "ashenfall-dungeon-completion-ledger-"),
);
try {
  const { MemoryRepository } = await import(
    pathToFileURL(path.resolve("server/persistence/MemoryRepository.ts")).href
  );
  const file = path.join(temp, "players.json");
  const repo = new MemoryRepository(file);
  const instance = "dungeon-run-27";
  const players = [
    {
      id: "party-a",
      gold: 10,
      dungeonRewardChests: [
        { id: `dchest_${instance}_party-a`, rewards: { xp: 10 } },
      ],
    },
    {
      id: "party-b",
      gold: 20,
      dungeonRewardChests: [
        { id: `dchest_${instance}_party-b`, rewards: { xp: 10 } },
      ],
    },
  ];
  const keys = players.map(
    (p) => `dungeon-completion:${instance}:${p.id}:final:chest`,
  );
  assert.equal(
    repo.savePlayersWithRewardsOnce(players, keys),
    true,
    "first group completion atomically commits",
  );
  assert.ok(
    players.every((p, i) => p._rewardLedger.includes(keys[i])),
    "each player gets a durable completion marker",
  );
  assert.equal(
    repo.savePlayersWithRewardsOnce(players, keys),
    false,
    "duplicate group completion is rejected",
  );

  const mixedPlayers = [
    { id: "party-c", gold: 30 },
    {
      id: "party-d",
      gold: 40,
      _rewardLedger: ["dungeon-completion:other:party-d:final:chest"],
    },
  ];
  const mixedKeys = [
    "dungeon-completion:other:party-c:final:chest",
    "dungeon-completion:other:party-d:final:chest",
  ];
  assert.equal(
    repo.savePlayersWithRewardsOnce(mixedPlayers, mixedKeys),
    false,
    "a duplicate among group keys rejects the entire transaction",
  );
  assert.ok(
    !mixedPlayers[0]._rewardLedger?.includes(mixedKeys[0]),
    "no partial reward key is retained after group rejection",
  );

  repo.close();
  const reloaded = new MemoryRepository(file);
  for (let i = 0; i < players.length; i++) {
    const saved = reloaded.getPlayer(players[i].id);
    assert.ok(
      saved?._rewardLedger?.includes(keys[i]),
      `completion key ${i} survives restart`,
    );
  }
  assert.equal(
    reloaded.savePlayersWithRewardsOnce(players, keys),
    false,
    "restart cannot replay a completed dungeon reward",
  );
  reloaded.close();
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const repoSource = fs.readFileSync("server/persistence/Repository.ts", "utf8");
const memorySource = fs.readFileSync(
  "server/persistence/MemoryRepository.ts",
  "utf8",
);
const sqliteSource = fs.readFileSync(
  "server/persistence/SQLiteRepository.ts",
  "utf8",
);
const pgSource = fs.readFileSync(
  "server/persistence/PostgresRepository.ts",
  "utf8",
);
const victorySource = fs.readFileSync(
  "server/runtime/CombatVictoryService.ts",
  "utf8",
);
const progressionSource = fs.readFileSync(
  "server/runtime/ProgressionService.ts",
  "utf8",
);
assert.match(
  repoSource,
  /savePlayersWithRewardsOnce\(players: PlayerRecord\[\], rewardKeys: string\[\]\)/,
  "repository contract exposes atomic group reward commits",
);
assert.match(
  memorySource,
  /savePlayersWithRewardsOnce\(players: PlayerRecord\[\], rewardKeys: string\[\]\)/,
  "memory adapter implements atomic group commits",
);
assert.match(
  sqliteSource,
  /savePlayersWithRewardsOnce\(players: PlayerRecord\[\], rewardKeys: string\[\]\)/,
  "SQLite adapter implements atomic group commits",
);
assert.match(
  pgSource,
  /savePlayersWithRewardsOnce\(players: PlayerRecord\[\], rewardKeys: string\[\]\)/,
  "PostgreSQL adapter implements atomic group commits",
);
assert.match(
  victorySource,
  /dungeon-completion:\$\{instanceId\}:\$\{String\(m\.id\)\}:final:chest/,
  "final chest key is stable by instance and player",
);
assert.match(
  victorySource,
  /dungeon-completion:\$\{instanceId\}:\$\{String\(m\.id\)\}:\$\{String\(dr\.optionalRoomId\|\|'optional'\)\}:chest/,
  "optional chest key is stable by instance, player and room",
);
assert.match(
  victorySource,
  /await this\.repo\.savePlayersWithRewardsOnce\(members,keys\)/,
  "completion awaits atomic durable commit",
);
assert.match(
  progressionSource,
  /const existing=member\.dungeonRewardChests\.find\(x=>x\.id===id\);\s*if\(existing\)return existing;/,
  "retry checks existing chest before generating reward gear",
);
assert.doesNotMatch(
  victorySource,
  /await this\.repo\.savePlayersAtomically\(members\)/,
  "dungeon completion no longer uses a non-idempotent group save",
);
console.log("Audit Batch 27 passed: 14 assertions.");
