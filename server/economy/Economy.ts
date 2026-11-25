import { EconomyStateStore } from "./EconomyState.js";
import { AuctionService } from "./services/AuctionService.js";
import { MailService } from "./services/MailService.js";
import { MarketAnalyticsService } from "./services/MarketAnalyticsService.js";
import { makeRoomForSystemMail } from "./SystemMailCapacity.js";
const AUCTION_DURATION = 7 * 24 * 60 * 60 * 1000;
const MAX_MAIL = 100;
const MAIL_RETENTION = 30 * 24 * 60 * 60 * 1000;
const MAIL_MAX_SUBJECT = 120;
const MAIL_MAX_BODY = 1000;
const MAX_ACTIVE_LISTINGS = 50;
const LISTING_FEE_RATE = 0.02;
const SALE_TAX_RATE = 0.05;
const MIN_LISTING_FEE = 1;
const MIN_SALE_TAX = 1;

class Economy {
  private inv: any;
  private repo: any;
  private items: Record<string, any>;
  private auctions: Map<string, any>;
  private mail: Map<string, any[]>;
  private sequence: number;
  private auctionLocks: Map<string, Promise<any>>;
  private playerLocks: Map<string, Promise<any>>;
  private saleHistory: any[];
  private cleanupPromise: Promise<any> | null;
  private nextCleanupAt: number;
  private cleanupWarnedAt: Map<string, number>;
  private persistTail: Promise<any>;
  private stateStore: EconomyStateStore;
  private auctionService: AuctionService;
  private mailService: MailService;
  private marketAnalyticsService: MarketAnalyticsService;
  private readyPromise: Promise<any>;
  private playerMutations: any;
  constructor(inv, repo, items, playerMutations = null) {
    this.inv = inv;
    this.repo = repo;
    this.playerMutations = playerMutations;
    this.items = items || inv?.items || {};
    this.auctions = new Map();
    this.mail = new Map();
    this.sequence = 0;
    this.auctionLocks = new Map();
    this.playerLocks = new Map();
    this.saleHistory = [];
    this.cleanupPromise = null;
    this.nextCleanupAt = 0;
    this.cleanupWarnedAt = new Map();
    this.persistTail = Promise.resolve();
    this.stateStore = new EconomyStateStore();
    this.auctionService = new AuctionService(this);
    this.mailService = new MailService(this);
    this.marketAnalyticsService = new MarketAnalyticsService(this);
    this.readyPromise = this.initialize();
  }
  async initialize() {
    let state = null;
    if (this.repo?.loadEconomyStateAsync)
      state = await this.repo.loadEconomyStateAsync();
    else state = this.repo?.loadEconomyState?.() || {};
    state ||= {};
    for (const a of Array.isArray(state.auctions) ? state.auctions : [])
      if (a?.id) this.auctions.set(String(a.id), a);
    for (const sale of Array.isArray(state.saleHistory)
      ? state.saleHistory
      : [])
      if (sale?.id) this.saleHistory.push(sale);
    this.saleHistory = this.saleHistory
      .filter(
        (x) => Number(x.soldAt || 0) > Date.now() - 30 * 24 * 60 * 60 * 1000,
      )
      .slice(-20000);
    for (const [id, messages] of Object.entries(state.mail || {})) {
      const normalized = (Array.isArray(messages) ? messages : [])
        .map((m) => this.normalizeMail(m, id))
        .filter(Boolean);
      this.mail.set(String(id), normalized);
    }
    await this.cleanup(Date.now(), false);
    return this;
  }
  async ready() {
    await this.readyPromise;
    return this;
  }
  economyState() {
    return {
      auctions: [...this.auctions.values()],
      mail: Object.fromEntries(this.mail.entries()),
      saleHistory: this.saleHistory.slice(-20000),
    };
  }
  async persist(players = []) {
    const run = this.persistTail.then(async () => {
      const data = this.economyState();
      if (this.repo?.savePlayersAndEconomyAtomically)
        return this.repo.savePlayersAndEconomyAtomically(players, data);
      for (const p of players) this.repo?.savePlayer?.(p);
      if (this.repo?.saveEconomyStateNow)
        return this.repo.saveEconomyStateNow(data);
      return this.repo?.saveEconomyState?.(data);
    });
    this.persistTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  save() {
    return this.repo?.saveEconomyState?.(this.economyState());
  }
  id(prefix) {
    return `${prefix}_${Date.now()}_${++this.sequence}_${Math.random().toString(36).slice(2, 8)}`;
  }
  async withAuctionLock(key, fn) {
    const k = String(key);
    const prior = this.auctionLocks.get(k) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const chain = prior.then(() => gate);
    this.auctionLocks.set(k, chain);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.auctionLocks.get(k) === chain) this.auctionLocks.delete(k);
    }
  }
  async withPlayerLock(playerId, fn) {
    if (this.playerMutations?.withPlayer)
      return this.playerMutations.withPlayer(String(playerId), fn);
    const k = String(playerId);
    const prior = this.playerLocks.get(k) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const chain = prior.then(() => gate);
    this.playerLocks.set(k, chain);
    await prior;
    try {
      return await fn();
    } finally {
      release();
      if (this.playerLocks.get(k) === chain) this.playerLocks.delete(k);
    }
  }
  async withPlayerLocks(playerIds, fn) {
    if (this.playerMutations?.withPlayers)
      return this.playerMutations.withPlayers(playerIds, fn);
    const ids = [
      ...new Set((playerIds || []).filter((x) => x != null).map(String)),
    ].sort();
    const acquire = async (index) =>
      index >= ids.length
        ? fn()
        : this.withPlayerLock(ids[index], () => acquire(index + 1));
    return acquire(0);
  }
  itemDef(id) {
    return this.items[id] || {};
  }
  normalizeMail(raw, playerId) {
    if (!raw?.id) return null;
    const createdAt = Number(raw.createdAt || Date.now());
    return {
      id: String(raw.id),
      playerId: String(raw.playerId || playerId),
      subject: String(raw.subject || "Ashenfall Mail").slice(
        0,
        MAIL_MAX_SUBJECT,
      ),
      body: String(raw.body || "").slice(0, MAIL_MAX_BODY),
      payload:
        raw.payload && typeof raw.payload === "object" ? raw.payload : {},
      createdAt,
      expiresAt: Number(raw.expiresAt || createdAt + MAIL_RETENTION),
      read: !!raw.read,
      system: !!raw.system,
    };
  }
  mailFor(playerId) {
    const list = this.mail.get(String(playerId)) || [];
    this.mail.set(String(playerId), list);
    return list;
  }
  pushMail(playerId, subject, body, payload: any = {}, now = Date.now()) {
    this.purgeMail(playerId, now, false);
    const list = this.mailFor(playerId);
    const system = !!(
      payload &&
      typeof payload === "object" &&
      (payload.systemMail === true || payload.systemReceipt === true)
    );
    const limit = system ? MAX_MAIL + 100 : MAX_MAIL;
    if (list.length >= limit && system) {
      if (!makeRoomForSystemMail(list)) {
        throw new Error(
          "Mailbox is full of unclaimed auction attachments. Claim mail before retrying.",
        );
      }
    }
    if (list.length >= limit) throw new Error("Mailbox is full.");
    const cleanPayload: any =
      payload && typeof payload === "object" ? { ...payload } : {};
    delete cleanPayload.systemMail;
    delete cleanPayload.systemReceipt;
    const message = {
      id: this.id("mail"),
      playerId: String(playerId),
      subject: String(subject).slice(0, MAIL_MAX_SUBJECT),
      body: String(body).slice(0, MAIL_MAX_BODY),
      payload: cleanPayload,
      createdAt: now,
      expiresAt: now + MAIL_RETENTION,
      read: false,
      system,
    };
    list.push(message);
    return message;
  }
  mailSummary(playerId) {
    const list = this.mailFor(playerId);
    return {
      total: list.length,
      unread: list.filter((m) => !m.read).length,
      withAttachments: list.filter(
        (m) => (m.payload?.items?.length || m.payload?.gold) > 0,
      ).length,
    };
  }
  async sendMail(
    playerId,
    subject,
    body,
    payload = {},
    persist = true,
    extraPlayers = [],
  ) {
    return this.withPlayerLock(playerId, async () => {
      const list = this.mailFor(playerId),
        before = list.slice();
      try {
        const message = this.pushMail(playerId, subject, body, payload);
        if (persist) await this.persist(extraPlayers);
        return message;
      } catch (error) {
        this.mail.set(String(playerId), before);
        throw error;
      }
    });
  }
  purgeMail(playerId, now = Date.now(), persist = true) {
    const key = String(playerId),
      list = this.mailFor(key);
    const kept = list.filter((m) => {
      const payload = m?.payload || {};
      const hasItems =
        Array.isArray(payload.items) &&
        payload.items.some((item: any) => Number(item?.qty ?? 1) > 0);
      const hasGold = Number(payload.gold || 0) > 0;
      return Number(m.expiresAt || 0) > now || hasItems || hasGold;
    });
    const changed = kept.length !== list.length;
    if (changed) this.mail.set(key, kept);
    if (changed && persist)
      Promise.resolve(this.save()).catch((error: any) =>
        console.warn(
          "[mail] purge persistence failed",
          error?.message || error,
        ),
      );
    return changed;
  }
  async markMailRead(p, mailId, read = true) {
    return this.withPlayerLock(p.id, async () => {
      await this.ready();
      this.purgeMail(p.id, Date.now(), false);
      const m = this.mailFor(p.id).find((x) => x.id === String(mailId));
      if (!m) return [false, "Mail not found."];
      const previous = m.read;
      m.read = !!read;
      try {
        await this.persist([p]);
        return [
          true,
          read ? "Mail marked as read." : "Mail marked as unread.",
          { mailId: m.id, read: m.read },
        ];
      } catch (e) {
        m.read = previous;
        return [false, "Mail update could not be committed."];
      }
    });
  }
  async deleteMail(p, mailId) {
    return this.withPlayerLock(p.id, async () => {
      await this.ready();
      this.purgeMail(p.id, Date.now(), false);
      const list = this.mailFor(p.id),
        i = list.findIndex((m) => m.id === String(mailId));
      if (i < 0) return [false, "Mail not found."];
      const m = list[i];
      if (
        (m.payload?.items?.length || 0) > 0 ||
        Number(m.payload?.gold || 0) > 0
      )
        return [false, "Claim the attachments before deleting this mail."];
      list.splice(i, 1);
      try {
        await this.persist([p]);
        return [true, "Mail deleted.", { mailId: m.id }];
      } catch (e) {
        list.splice(i, 0, m);
        return [false, "Mail deletion could not be committed."];
      }
    });
  }
  async claimAllMail(p) {
    return this.withPlayerLock(p.id, async () => {
      await this.ready();
      this.purgeMail(p.id, Date.now(), false);
      const list = this.mailFor(p.id).slice();
      const attach = list.filter(
        (m) =>
          (Array.isArray(m.payload?.items) && m.payload.items.length) ||
          Number(m.payload?.gold || 0) > 0,
      );
      if (!attach.length)
        return [true, "There are no attachments to claim.", { claimed: [] }];
      const allItems = attach.flatMap((m) =>
        Array.isArray(m.payload?.items) ? m.payload.items : [],
      );
      if (allItems.length && !this.inv.canGiveMany(p, allItems))
        return [
          false,
          "Free enough bag space before claiming all attachments.",
        ];
      const totalGold = attach.reduce(
        (n, m) => n + Math.max(0, Math.floor(Number(m.payload?.gold) || 0)),
        0,
      );
      const snap = {
        gold: p.gold,
        inventory: p.inventory.map((x) => ({ ...x })),
        mail: list,
      };
      try {
        p.gold = (Number(p.gold) || 0) + totalGold;
        for (const x of allItems)
          if (!this.inv.give(p, x.itemId, x.qty)) throw new Error("delivery");
        const ids = new Set(attach.map((m) => m.id));
        this.mail.set(
          String(p.id),
          list.filter((m) => !ids.has(m.id)),
        );
        this.inv.recalc(p);
        await this.persist([p]);
        return [
          true,
          `Claimed ${attach.length} mail attachments.`,
          {
            claimed: attach.map((m) => m.id),
            gold: totalGold,
            items: allItems,
          },
        ];
      } catch (e) {
        p.gold = snap.gold;
        p.inventory = snap.inventory;
        this.mail.set(String(p.id), snap.mail);
        this.inv.recalc(p);
        return [false, "Claim all failed; nothing was changed."];
      }
    });
  }
  async claimMail(p, mailId) {
    return this.withPlayerLock(p.id, async () => {
      await this.ready();
      const list = this.mailFor(p.id),
        i = list.findIndex((m) => m.id === mailId);
      if (i < 0) return [false, "Mail not found."];
      const m = list[i],
        items = Array.isArray(m.payload?.items) ? m.payload.items : [],
        gold = Math.max(0, Math.floor(Number(m.payload?.gold) || 0));
      m.read = true;
      if (items.length && !this.inv.canGiveMany(p, items))
        return [false, "Free bag space before claiming this mail."];
      const snap = {
        gold: p.gold,
        inventory: p.inventory.map((x) => ({ ...x })),
        mail: list.slice(),
      };
      try {
        if (gold > 0) p.gold = (Number(p.gold) || 0) + gold;
        for (const x of items)
          if (!this.inv.give(p, x.itemId, x.qty)) throw new Error("delivery");
        list.splice(i, 1);
        this.inv.recalc(p);
        await this.persist([p]);
        return [true, "Mail claimed.", { mailId: m.id, gold, items }];
      } catch (e) {
        p.gold = snap.gold;
        p.inventory = snap.inventory;
        this.mail.set(String(p.id), snap.mail);
        this.inv.recalc(p);
        return [false, "Mail claim failed; nothing was changed."];
      }
    });
  }
  search(filters: Record<string, any> = {}) {
    const now = Date.now();
    const q = String(filters.query || filters.itemId || "")
      .trim()
      .toLowerCase();
    const rarity = filters.rarity ? String(filters.rarity).toLowerCase() : null;
    const minLevel =
      filters.minLevel == null ? 0 : Math.max(0, Number(filters.minLevel) || 0);
    const maxLevel =
      filters.maxLevel == null
        ? Number.MAX_SAFE_INTEGER
        : Math.max(minLevel, Number(filters.maxLevel) || minLevel);
    const minPrice =
      filters.minPrice == null ? 0 : Math.max(0, Number(filters.minPrice) || 0);
    const maxPrice =
      filters.maxPrice == null
        ? Number.MAX_SAFE_INTEGER
        : Math.max(minPrice, Number(filters.maxPrice) || minPrice);
    const sort = String(filters.sort || "newest");
    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const pageSize = Math.min(
      50,
      Math.max(1, Math.floor(Number(filters.pageSize) || 20)),
    );
    const rows = [...this.auctions.values()]
      .filter((a) => {
        if (Number(a.expiresAt || 0) <= now) return false;
        const d = this.itemDef(a.itemId);
        const hay = `${a.itemId} ${d.name || ""}`.toLowerCase();
        const level = Number(d.itemLevel || d.level || 0);
        const price = Number(a.buyout || a.currentBid || a.startPrice || 0);
        if (q && !hay.includes(q)) return false;
        if (rarity && String(d.rarity || "").toLowerCase() !== rarity)
          return false;
        if (
          level < minLevel ||
          level > maxLevel ||
          price < minPrice ||
          price > maxPrice
        )
          return false;
        return true;
      })
      .map((a) => {
        const d = this.itemDef(a.itemId);
        return {
          ...a,
          itemName: d.name || a.itemId,
          icon: d.icon || null,
          rarity: d.rarity || "common",
          level: Number(d.itemLevel || d.level || 0),
          price: Number(a.buyout || a.currentBid || a.startPrice || 0),
        };
      });
    rows.sort((a, b) =>
      sort === "price_asc"
        ? a.price - b.price
        : sort === "price_desc"
          ? b.price - a.price
          : sort === "level_asc"
            ? a.level - b.level
            : sort === "level_desc"
              ? b.level - a.level
              : sort === "ending"
                ? a.expiresAt - b.expiresAt
                : b.createdAt - a.createdAt,
    );
    const start = (page - 1) * pageSize;
    return {
      total: rows.length,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(rows.length / pageSize)),
      listings: rows.slice(start, start + pageSize),
    };
  }
  marketStats(itemId, days = 7) {
    const id = String(itemId || "");
    const windowDays = Math.min(30, Math.max(1, Number(days) || 7));
    const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const sales = this.saleHistory.filter(
      (x) => x.itemId === id && Number(x.soldAt || 0) >= since,
    );
    const prices = sales
      .map((x) => Number(x.unitPrice || 0))
      .filter((x) => x > 0);
    const volume = sales.reduce(
      (n, x) => n + Math.max(0, Number(x.qty) || 0),
      0,
    );
    const average = prices.length
      ? Number((prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2))
      : null;
    return {
      itemId: id,
      days: windowDays,
      average,
      lowest: prices.length ? Math.min(...prices) : null,
      highest: prices.length ? Math.max(...prices) : null,
      volume,
      salesCount: sales.length,
      lastSale: sales.at(-1) || null,
    };
  }
  sellerHistory(playerId, days = 30) {
    const since =
      Date.now() -
      Math.min(30, Math.max(1, Number(days) || 30)) * 24 * 60 * 60 * 1000;
    return this.saleHistory
      .filter(
        (x) =>
          String(x.sellerId) === String(playerId) &&
          Number(x.soldAt || 0) >= since,
      )
      .slice(-200)
      .reverse();
  }
  recordSale(a, price, qty, tax, proceeds, soldAt = Date.now()) {
    const q = Math.max(1, Number(qty) || 1);
    const sale = {
      id: this.id("sale"),
      auctionId: a.id,
      itemId: a.itemId,
      sellerId: a.seller,
      buyerId: a.currentBidder,
      qty: q,
      price: Math.max(0, Number(price) || 0),
      unitPrice: Math.max(0, Number(price) || 0) / q,
      tax: Math.max(0, Number(tax) || 0),
      proceeds: Math.max(0, Number(proceeds) || 0),
      soldAt,
    };
    this.saleHistory.push(sale);
    if (this.saleHistory.length > 20000)
      this.saleHistory = this.saleHistory.slice(-20000);
    return sale;
  }
  async list(p, itemId, price, qty = 1, buyout = null) {
    return this.withAuctionLock(`seller:${p.id}`, () =>
      this.withPlayerLock(p.id, () =>
        this._list(p, itemId, price, qty, buyout),
      ),
    );
  }
  async _list(p, itemId, price, qty = 1, buyout = null) {
    await this.ready();
    if (
      [...this.auctions.values()].filter((a) => a.seller === p.id).length >=
      MAX_ACTIVE_LISTINGS
    )
      return [
        false,
        `You can have at most ${MAX_ACTIVE_LISTINGS} active listings.`,
      ];
    const it = p.inventory.find((x) => x.itemId === itemId && x.qty > 0);
    if (!it) return [false, "Missing item."];
    if (p.equipment && Object.values(p.equipment).includes(itemId))
      return [false, "Unequip the item before listing it."];
    const def = this.itemDef(itemId);
    if (def?.soulbound || def?.tradeable === false)
      return [false, "That item cannot be listed."];
    const MAX_PRICE = 1_000_000_000;
    const maxQty = Math.max(
        1,
        Math.min(Number(it.qty) || 1, Math.floor(Number(qty) || 1)),
      ),
      start = Math.min(MAX_PRICE, Math.max(1, Math.floor(Number(price) || 0)));
    const bo =
      buyout == null
        ? null
        : Math.min(MAX_PRICE, Math.max(start, Math.floor(Number(buyout) || 0)));
    const listingFee = Math.max(
      MIN_LISTING_FEE,
      Math.floor(Math.max(start, bo || 0) * LISTING_FEE_RATE),
    );
    if (p.gold < listingFee)
      return [false, `You need ${listingFee} gold for the listing fee.`];
    const snap = {
      gold: p.gold,
      inventory: p.inventory.map((x) => ({ ...x })),
    };
    const id = this.id("auc"),
      a = {
        id,
        seller: p.id,
        sellerName: p.name,
        itemId,
        qty: maxQty,
        startPrice: start,
        currentBid: start,
        currentBidder: null,
        buyout: bo,
        createdAt: Date.now(),
        expiresAt: Date.now() + AUCTION_DURATION,
        listingFee,
        version: 1,
      };
    try {
      if (!this.inv.remove(p, itemId, maxQty)) return [false, "Missing item."];
      p.gold -= listingFee;
      this.auctions.set(id, a);
      this.inv.recalc(p);
      await this.persist([p]);
      return [
        true,
        `Listed ${def.name || itemId} ×${maxQty} for ${start} gold.`,
        {
          auctionId: id,
          item: def.name || itemId,
          qty: maxQty,
          listingFee,
          buyout: bo,
        },
      ];
    } catch (e) {
      p.gold = snap.gold;
      p.inventory = snap.inventory;
      this.auctions.delete(id);
      this.inv.recalc(p);
      return [
        false,
        "Listing could not be committed; no item or gold was changed.",
      ];
    }
  }
  async cancel(p, id) {
    return this.withAuctionLock(id, () =>
      this.withPlayerLock(p.id, () => this._cancel(p, id)),
    );
  }
  async _cancel(p, id) {
    await this.ready();
    const a = this.auctions.get(id);
    if (!a || a.seller !== p.id) return [false, "Listing not found."];
    if (a.currentBidder)
      return [
        false,
        "A bid has been placed; this listing cannot be cancelled.",
      ];
    const msg = this.pushMail(
      p.id,
      "Auction cancelled",
      `Your ${this.itemDef(a.itemId).name || a.itemId} listing was cancelled.`,
      {
        items: [{ itemId: a.itemId, qty: a.qty }],
        auctionId: id,
        systemReceipt: true,
      },
    );
    const list = this.mailFor(p.id);
    this.auctions.delete(id);
    try {
      await this.persist([]);
      return [
        true,
        "Listing cancelled. The item was sent to your mail.",
        { auctionId: id },
      ];
    } catch (e) {
      this.auctions.set(id, a);
      list.splice(list.indexOf(msg), 1);
      return [false, "Cancellation could not be committed."];
    }
  }
  async bid(p, id, amount, players) {
    return this.withAuctionLock(id, () => {
      const a = this.auctions.get(id);
      return this.withPlayerLocks([p.id, a?.seller, a?.currentBidder], () =>
        this._bid(p, id, amount, players),
      );
    });
  }
  async _bid(p, id, amount, players) {
    await this.ready();
    const a = this.auctions.get(id);
    if (!a) return [false, "Listing missing."];
    if (a.seller === p.id)
      return [false, "You cannot bid on your own listing."];
    if (a.expiresAt <= Date.now()) return [false, "This auction has expired."];
    const minimum = Math.max(
        a.startPrice + 1,
        (Number(a.currentBid) || a.startPrice) + 1,
      ),
      bid = Math.floor(Number(amount) || 0);
    if (bid < minimum)
      return [
        false,
        `Minimum bid is ${minimum} gold. No gold was charged.`,
        { minimumBid: minimum },
      ];
    const effectiveBid =
      a.buyout && bid >= a.buyout
        ? Math.max(a.buyout, Number(a.currentBid) || 0)
        : bid;
    const alreadyHeld =
        a.currentBidder === p.id ? Math.max(0, Number(a.heldBid) || 0) : 0,
      additional = Math.max(0, effectiveBid - alreadyHeld);
    if (additional > p.gold)
      return [false, "Not enough available gold for that bid."];
    if (a.buyout && bid >= a.buyout) return this._buy(p, id, players, true);
    const previous = a.currentBidder,
      previousHeld = Number(a.heldBid) || 0;
    const previousPlayer =
      previous && previous !== p.id ? players.get(previous) : null;
    const snap = {
      gold: p.gold,
      auction: { ...a },
      mail: previous ? this.mailFor(previous).slice() : null,
    };
    try {
      p.gold -= additional;
      a.currentBid = bid;
      a.currentBidder = p.id;
      a.bidderName = p.name;
      a.heldBid = bid;
      a.version = (a.version || 0) + 1;
      if (previous && previous !== p.id && previousHeld > 0)
        this.pushMail(
          previous,
          "Outbid",
          `You were outbid on ${this.itemDef(a.itemId).name || a.itemId}.`,
          { gold: previousHeld, auctionId: id, systemReceipt: true },
        );
      await this.persist([p, ...(previousPlayer ? [previousPlayer] : [])]);
      return [
        true,
        `Bid placed: ${bid} gold.`,
        { auctionId: id, bid, held: bid },
      ];
    } catch (e) {
      p.gold = snap.gold;
      Object.assign(a, snap.auction);
      if (previous) this.mail.set(String(previous), snap.mail || []);
      return [false, "Bid could not be committed; no gold was changed."];
    }
  }
  async buy(p, id, players, fromBid = false) {
    return this.withAuctionLock(id, () => {
      const a = this.auctions.get(id);
      return this.withPlayerLocks([p.id, a?.seller, a?.currentBidder], () =>
        this._buy(p, id, players, fromBid),
      );
    });
  }
  async _buy(p, id, players, fromBid = false) {
    await this.ready();
    const a = this.auctions.get(id);
    if (!a) return [false, "Listing missing."];
    if (a.seller === p.id) return [false, "You cannot buy your own listing."];
    if (!fromBid && a.expiresAt <= Date.now())
      return [false, "This auction has expired."];
    const buyout = Number(a.buyout) || 0;
    if (!fromBid && buyout <= 0)
      return [false, "This listing has no buyout price. Place a bid instead."];
    const price = fromBid
      ? Math.max(buyout, Number(a.currentBid || 0))
      : buyout;
    if (!Number.isFinite(price) || price <= 0)
      return [false, "This listing does not have a valid buyout price."];
    const held =
        a.currentBidder === p.id ? Math.max(0, Number(a.heldBid) || 0) : 0,
      additional = Math.max(0, price - held),
      qty = Math.max(1, Number(a.qty) || 1);
    if (additional > p.gold) return [false, "Not enough gold."];
    if (!this.inv.canGive(p, a.itemId, qty))
      return [false, "Your bag is full."];
    const seller = players.get(a.seller),
      previousBidder =
        a.currentBidder && a.currentBidder !== p.id ? a.currentBidder : null,
      previousHeld = previousBidder ? Math.max(0, Number(a.heldBid) || 0) : 0;
    const snap = {
      gold: p.gold,
      inventory: p.inventory.map((x) => ({ ...x })),
      sellerGold: seller?.gold,
      auction: { ...a },
      previousMail: previousBidder
        ? this.mailFor(previousBidder).slice()
        : null,
      sellerMail: this.mailFor(a.seller).slice(),
      saleHistoryIds: new Set(this.saleHistory.map((x) => x.id)),
    };
    try {
      if (!this.inv.give(p, a.itemId, qty)) throw new Error("delivery");
      p.gold -= additional;
      if (previousBidder && previousHeld > 0)
        this.pushMail(
          previousBidder,
          "Outbid",
          `The auction for ${this.itemDef(a.itemId).name || a.itemId} ended in a buyout.`,
          { gold: previousHeld, auctionId: id, systemReceipt: true },
        );
      const tax = Math.max(MIN_SALE_TAX, Math.floor(price * SALE_TAX_RATE)),
        proceeds = Math.max(0, price - tax);
      this.recordSale(a, price, qty, tax, proceeds);
      if (seller && seller.online)
        seller.gold = (Number(seller.gold) || 0) + proceeds;
      else
        this.pushMail(
          a.seller,
          "Auction sale",
          `Your ${this.itemDef(a.itemId).name || a.itemId} sold for ${price} gold.`,
          {
            gold: proceeds,
            auctionId: id,
            itemId: a.itemId,
            qty,
            systemReceipt: true,
          },
        );
      this.auctions.delete(id);
      this.inv.recalc(p);
      if (seller) this.inv.recalc(seller);
      await this.persist([p, ...(seller && seller.online ? [seller] : [])]);
      return [
        true,
        `Bought ${this.itemDef(a.itemId).name || a.itemId} ×${qty} for ${price} gold.`,
        { auctionId: id, price, tax, proceeds, sellerId: a.seller },
      ];
    } catch (e) {
      p.gold = snap.gold;
      p.inventory = snap.inventory;
      if (seller && snap.sellerGold != null) seller.gold = snap.sellerGold;
      Object.assign(a, snap.auction);
      this.auctions.set(id, a);
      if (previousBidder)
        this.mail.set(String(previousBidder), snap.previousMail || []);
      this.mail.set(String(a.seller), snap.sellerMail || []);
      this.saleHistory = this.saleHistory.filter((x) =>
        snap.saleHistoryIds.has(x.id),
      );
      this.inv.recalc(p);
      if (seller) this.inv.recalc(seller);
      const reason = String(e instanceof Error ? e.message : e || "");
      if (/mailbox is full of unclaimed auction attachments/i.test(reason))
        return [
          false,
          "The seller’s mailbox is full of unclaimed auction attachments. The seller must claim their mail before this buyout can complete. No gold or items were changed.",
        ];
      return [
        false,
        "Purchase could not be committed; no gold or items were changed.",
      ];
    }
  }
  async cleanup(now = Date.now(), persist = true): Promise<any> {
    if (this.cleanupPromise) return this.cleanupPromise;
    if (now < this.nextCleanupAt) return false;
    this.nextCleanupAt = now + 1000;
    this.cleanupPromise = (async () => {
      let changed = false;
      for (const [id, initial] of [...this.auctions]) {
        if (Number(initial.expiresAt || 0) <= 0 || initial.expiresAt > now)
          continue;
        try {
          await this.withAuctionLock(id, async () => {
            const current = this.auctions.get(id);
            if (
              !current ||
              Number(current.expiresAt || 0) <= 0 ||
              current.expiresAt > now
            )
              return;
            const playerIds = [current.seller, current.currentBidder].filter(
              Boolean,
            );
            await this.withPlayerLocks(playerIds, async () => {
              const a = this.auctions.get(id);
              if (!a || Number(a.expiresAt || 0) <= 0 || a.expiresAt > now)
                return;
              const mailBefore = new Map(
                playerIds.map((pid) => [
                  String(pid),
                  this.mailFor(pid).slice(),
                ]),
              );
              const auctionBefore = { ...a };
              let saleId = null;
              try {
                if (a.currentBidder) {
                  const finalPrice = Math.max(0, Number(a.currentBid) || 0),
                    tax = Math.max(
                      MIN_SALE_TAX,
                      Math.floor(finalPrice * SALE_TAX_RATE),
                    ),
                    proceeds = Math.max(0, finalPrice - tax);
                  const sale = this.recordSale(
                    a,
                    finalPrice,
                    Math.max(1, Number(a.qty) || 1),
                    tax,
                    proceeds,
                    now,
                  );
                  saleId = sale.id;
                  this.pushMail(
                    a.seller,
                    "Auction sold",
                    `Your ${this.itemDef(a.itemId).name || a.itemId} sold for ${finalPrice} gold.`,
                    { gold: proceeds, auctionId: id, systemReceipt: true },
                    now,
                  );
                  this.pushMail(
                    a.currentBidder,
                    "Auction won",
                    `You won ${this.itemDef(a.itemId).name || a.itemId}.`,
                    {
                      items: [{ itemId: a.itemId, qty: a.qty }],
                      auctionId: id,
                      systemReceipt: true,
                    },
                    now,
                  );
                } else
                  this.pushMail(
                    a.seller,
                    "Auction expired",
                    `Your ${this.itemDef(a.itemId).name || a.itemId} listing expired.`,
                    {
                      items: [{ itemId: a.itemId, qty: a.qty }],
                      auctionId: id,
                      systemReceipt: true,
                    },
                    now,
                  );
                this.auctions.delete(id);
                if (persist) await this.persist([]);
                changed = true;
                this.cleanupWarnedAt.delete(String(id));
              } catch (error) {
                this.auctions.set(id, auctionBefore);
                for (const [pid, list] of mailBefore) this.mail.set(pid, list);
                if (saleId)
                  this.saleHistory = this.saleHistory.filter(
                    (x) => x.id !== saleId,
                  );
                throw error;
              }
            });
          });
        } catch (error) {
          const warningKey = String(id),
            lastWarn = this.cleanupWarnedAt.get(warningKey) || 0;
          if (now - lastWarn >= 30_000) {
            this.cleanupWarnedAt.set(warningKey, now);
            console.warn("[auction] cleanup deferred for listing", {
              auctionId: warningKey,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
      for (const [id, lastWarn] of this.cleanupWarnedAt)
        if (!this.auctions.has(id) || now - lastWarn > 24 * 60 * 60 * 1000)
          this.cleanupWarnedAt.delete(id);
      return changed;
    })();
    try {
      return await this.cleanupPromise;
    } finally {
      this.cleanupPromise = null;
    }
  }
}
export { Economy };
