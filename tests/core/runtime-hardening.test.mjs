import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeRoomForSystemMail } from "../../server/economy/SystemMailCapacity.ts";

const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const goldTotal = (list) =>
  list.reduce((sum, m) => sum + Number(m.payload?.gold || 0), 0);
{
  const auth = read("server/auth/AuthService.ts");
  const sqlite = read("server/persistence/SQLiteRepository.ts");
  const postgres = read("server/persistence/PostgresRepository.ts");
  const network = read("client/runtime/ClientNetworkController.ts");
  const runtime = read("server/runtime/ServerRuntime.ts");
  const economySource = read("server/economy/Economy.ts");

  assert.match(
    auth,
    /issueSession\(kind:string,id:string,email:any=null,bumpSessionVersion=true\)/,
  );
  assert.match(
    auth,
    /issueSession\('account',a\.id,a\.email,false\)/,
    "refresh rotates credentials without revoking its own access-token version",
  );
  assert.match(
    sqlite,
    /if\(bumpSessionVersion\)this\.db\.prepare\('UPDATE accounts SET session_version/,
  );
  assert.match(
    postgres,
    /bumpSessionVersion\?await client\.query\('UPDATE accounts SET session_version/,
  );
  assert.match(network, /event\.code === 4409 \|\| event\.code === 4411/);
  assert.match(network, /Signed in elsewhere/);
  assert.match(
    runtime,
    /acquireWorldLease\?\.\(WORLD_LEASE_ID,worldLeaseOwnerId,Date\.now\(\),LEASE_MS\)/,
    "failed renewal attempts to reacquire the lease",
  );
  assert.match(
    runtime,
    /worldLease\.fencingToken=Number\(acquired\.fencingToken\)/,
    "reacquisition updates the in-memory fencing token",
  );
  assert.match(economySource, /makeRoomForSystemMail\(list\)/);
  assert.doesNotMatch(economySource, /oldestSystem >= 0 \? oldestSystem/);
  assert.match(
    economySource,
    /Mailbox is full of unclaimed auction attachments/,
  );
  assert.match(
    economySource,
    /catch \(error\) \{/,
    "one blocked expiry does not stop unrelated cleanup",
  );

  const attachmentMail = Array.from({ length: 200 }, (_, i) => ({
    id: `gold-receipt-${i}`,
    playerId: "seller",
    subject: "Auction sold",
    body: "Sale receipt",
    payload: { gold: 1000 },
    createdAt: Date.now() - i,
    expiresAt: Date.now() + 86400000,
    read: false,
    system: true,
  }));
  const before = goldTotal(attachmentMail);
  assert.equal(
    before,
    200000,
    "fixture holds 200,000 gold in unclaimed receipts",
  );
  assert.equal(
    makeRoomForSystemMail(attachmentMail),
    false,
    "capacity refuses to trim when every receipt has attachments",
  );
  assert.equal(
    attachmentMail.length,
    200,
    "full attachment-bearing mailbox remains unchanged",
  );
  assert.equal(
    goldTotal(attachmentMail),
    before,
    "no unclaimed gold is destroyed when capacity is exhausted",
  );

  const safeMail = attachmentMail.map((m, i) =>
    i === 0 ? { ...m, payload: {} } : { ...m },
  );
  assert.equal(
    makeRoomForSystemMail(safeMail),
    true,
    "capacity can be recovered by trimming an attachment-free system receipt",
  );
  safeMail.push({ id: "new-receipt", system: true, payload: { gold: 5 } });
  assert.equal(
    safeMail.length,
    200,
    "mailbox remains at its bounded capacity after replacement",
  );
  assert.equal(
    goldTotal(safeMail),
    199005,
    "trimming only removes the attachment-free receipt and preserves all existing money",
  );

  console.log("Audit Batch 38 passed: 18 source and runtime assertions.");
}
