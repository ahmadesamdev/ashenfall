import assert from "node:assert/strict";
import { sweepGeneratedItemRegistry } from "../../server/shared/GeneratedItemRegistry.ts";

const now = 2_000_000_000_000;
const items = {
  onlineGear: { id: "onlineGear", generated: true },
  offlineGear: { id: "offlineGear", generated: true },
  auctionGear: { id: "auctionGear", generated: true },
  mailGear: { id: "mailGear", generated: true },
  chestGear: { id: "chestGear", generated: true },
  rollGear: { id: "rollGear", generated: true },
  buybackGear: { id: "buybackGear", generated: true },
  expiredBuyback: { id: "expiredBuyback", generated: true },
  transferredGear: { id: "transferredGear", generated: true },
  orphan: { id: "orphan", generated: true },
  baseItem: { id: "baseItem", generated: false },
};
const online = {
  id: "online",
  online: true,
  inventory: [{ itemId: "onlineGear", qty: 1 }],
  equipment: {},
  generatedItems: {
    onlineGear: items.onlineGear,
    orphan: items.orphan,
    expiredBuyback: items.expiredBuyback,
  },
  pendingLootRolls: [{ itemId: "rollGear", baseItemId: "baseItem" }],
  dungeonRewardChests: [
    { rewards: { items: [{ itemId: "chestGear", qty: 1 }] } },
  ],
  recentSales: [
    { itemId: "buybackGear", qty: 1, soldAt: now - 1000 },
    { itemId: "expiredBuyback", qty: 1, soldAt: now - 31 * 60 * 1000 },
  ],
};
const offline = {
  id: "offline",
  online: false,
  inventory: [{ itemId: "offlineGear", qty: 1 }],
  equipment: {},
  generatedItems: {
    offlineGear: items.offlineGear,
    auctionGear: items.auctionGear,
    mailGear: items.mailGear,
    transferredGear: items.transferredGear,
    orphan: items.orphan,
  },
};
const recipient = {
  id: "recipient",
  online: true,
  inventory: [{ itemId: "transferredGear", qty: 1 }],
  equipment: {},
  generatedItems: {},
};
const economy = {
  auctions: new Map([["a1", { itemId: "auctionGear" }]]),
  mail: new Map([
    ["offline", [{ payload: { items: [{ itemId: "mailGear", qty: 1 }] } }]],
  ]),
};
const result = sweepGeneratedItemRegistry({
  players: [online, offline, recipient],
  items,
  economy,
  now,
});
assert.equal(
  result.removedDefinitions,
  3,
  "offline-only owned item and unreferenced generated definitions are not kept globally",
);
assert.equal(
  result.prunedPlayerDefinitions,
  4,
  "orphan and expired buyback definitions are pruned from the owning player",
);
for (const id of [
  "onlineGear",
  "auctionGear",
  "mailGear",
  "chestGear",
  "rollGear",
  "buybackGear",
])
  assert.ok(
    items[id],
    `${id} must remain globally registered while live/economy referenced`,
  );
assert.equal(
  items.offlineGear,
  undefined,
  "offline inventory keeps its durable per-player definition, not a process-global one",
);
assert.ok(
  items.transferredGear,
  "a generated item transferred to an online owner remains registered",
);
assert.equal(
  recipient.generatedItems.transferredGear,
  items.transferredGear,
  "transferred item definition is persisted on the receiving owner",
);
assert.equal(
  offline.generatedItems.transferredGear,
  undefined,
  "the previous owner no longer needs to retain a transferred item definition",
);
assert.equal(
  items.orphan,
  undefined,
  "unreferenced generated definition must be removed",
);
assert.equal(
  items.expiredBuyback,
  undefined,
  "expired buyback must not pin a generated definition",
);
assert.ok(
  offline.generatedItems.offlineGear,
  "offline owned definition remains available for rehydration",
);
assert.ok(
  offline.generatedItems.auctionGear,
  "auction item definition remains persisted for recovery",
);
assert.ok(
  offline.generatedItems.mailGear,
  "mail attachment definition remains persisted for recovery",
);
assert.equal(
  online.generatedItems.orphan,
  undefined,
  "stale per-player definition is pruned",
);
assert.equal(
  online.generatedItems.expiredBuyback,
  undefined,
  "expired buyback definition is pruned",
);
assert.ok(
  items.baseItem && !items.baseItem.generated,
  "static catalog definitions are never removed",
);

const second = sweepGeneratedItemRegistry({
  players: [online, offline, recipient],
  items,
  economy,
  now,
});
assert.equal(second.removedDefinitions, 0);
assert.equal(second.prunedPlayerDefinitions, 0);
assert.equal(
  second.changedPlayers.length,
  0,
  "repeat sweep does not require additional persistence",
);
assert.equal(economy.auctions.get("a1").itemId, "auctionGear");

const offlineSource = {
  id: "source2",
  online: false,
  inventory: [],
  equipment: {},
  generatedItems: {
    dormantTransfer: { id: "dormantTransfer", generated: true },
  },
};
const offlineRecipient = {
  id: "recipient2",
  online: false,
  inventory: [{ itemId: "dormantTransfer", qty: 1 }],
  equipment: {},
  generatedItems: {},
};
const dormantItems = {};
const dormant = sweepGeneratedItemRegistry({
  players: [offlineSource, offlineRecipient],
  items: dormantItems,
  economy: { auctions: new Map(), mail: new Map() },
  now,
});
assert.equal(
  dormantItems.dormantTransfer,
  undefined,
  "offline-only transfer does not pollute the global catalog",
);
assert.ok(
  offlineRecipient.generatedItems.dormantTransfer,
  "offline recipient persists the transferred definition for login recovery",
);
assert.ok(
  dormant.changedPlayers.includes(offlineRecipient),
  "caller is told to persist the newly attached definition",
);
console.log(
  "generated item registry regression: PASS — online ownership, offline rehydration, auctions, mail, reward chests, loot rolls, buyback expiry, orphan pruning, idempotence",
);
