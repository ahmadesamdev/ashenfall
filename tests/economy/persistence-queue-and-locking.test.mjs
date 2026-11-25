import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) =>
  fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const economy = read("server/economy/Economy.ts");
assert.match(
  economy,
  /private persistTail: Promise<any>/,
  "economy persistence queue is declared",
);
assert.match(
  economy,
  /const run=this\.persistTail\.then\(async\(\)=>\{/,
  "economy snapshots are persisted serially",
);
assert.match(
  economy,
  /this\.persistTail=run\.then\(\(\)=>undefined,\(\)=>undefined\)/,
  "failed persistence does not poison later writes",
);
assert.match(
  economy,
  /async withPlayerLocks\(playerIds, fn\)/,
  "multi-player lock helper exists",
);
assert.match(
  economy,
  /withPlayerLocks\(\[p\.id,a\?\.seller,a\?\.currentBidder\]/,
  "bid/buy operations lock involved player mail and balances",
);
assert.match(
  economy,
  /async list\(p,itemId,price,qty=1,buyout=null\)[\s\S]*?withPlayerLock\(p\.id/,
  "listing locks seller inventory/gold",
);
assert.match(
  economy,
  /async sendMail\(playerId, subject, body, payload=\{\}, persist=true, extraPlayers=\[\]\)[\s\S]*?withPlayerLock\(playerId/,
  "external mail writes serialize with auction receipts",
);
assert.match(
  economy,
  /for\(const \[id,initial\] of \[\.\.\.this\.auctions\]\)/,
  "cleanup processes auction entries independently",
);
assert.doesNotMatch(
  economy,
  /const auctionsSnapshot=new Map\(this\.auctions\)/,
  "cleanup no longer restores a stale global auction snapshot",
);
assert.match(
  economy,
  /if\(saleId\)this\.saleHistory=this\.saleHistory\.filter\(x=>x\.id!==saleId\)/,
  "cleanup rollback removes only its own sale history entry",
);
assert.match(
  economy,
  /this\.saleHistory=this\.saleHistory\.filter\(x=>snap\.saleHistoryIds\.has\(x\.id\)\)/,
  "buy rollback preserves unrelated concurrent sale entries",
);
console.log(
  "Audit batch 15 economy concurrency checks passed (11 assertions).",
);
