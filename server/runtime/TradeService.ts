import { TradeDomainService } from "./services/TradeDomainService.js";
export function createTradeService(ctx: any) {
  const { inv, repo, world, quest, playerMutations } = ctx;
  const tradeRequests = new Map();
  const tradeSessions = new Map();

  function tradeState(p) {
    const pending = tradeRequests.get(p.id);
    const sid = [...tradeSessions.values()].find(
      (t) => t.a === p.id || t.b === p.id,
    );
    if (!sid)
      return {
        pending: pending
          ? {
              fromId: pending.from,
              fromName: repo.getPlayer(pending.from)?.name || "Player",
            }
          : null,
        session: null,
      };
    const otherId = sid.a === p.id ? sid.b : sid.a;
    const other = repo.getPlayer(otherId);
    const my = sid.offers[p.id] || { gold: 0, items: [] };
    const their = sid.offers[otherId] || { gold: 0, items: [] };
    return {
      pending: null,
      session: {
        id: sid.id,
        other: other
          ? {
              id: other.id,
              name: other.name,
              icon: other.icon,
              level: other.level,
            }
          : null,
        my,
        their,
        myLocked: !!sid.locked[p.id],
        theirLocked: !!sid.locked[otherId],
        myConfirmed: !!sid.confirmed[p.id],
        theirConfirmed: !!sid.confirmed[otherId],
        expiresAt: sid.expiresAt,
      },
    };
  }
  function findTradeSession(p) {
    return (
      [...tradeSessions.values()].find((t) => t.a === p.id || t.b === p.id) ||
      null
    );
  }
  function tradeDistanceOk(a, b) {
    return (
      !!a &&
      !!b &&
      a.online &&
      b.online &&
      a.zone === b.zone &&
      Math.hypot(a.x - b.x, a.y - b.y) <= world.normalizedMeters(a.zone, 25)
    );
  }
  function tradeOffer(p, cmd) {
    const t = findTradeSession(p);
    if (!t) return [false, "No active trade."];
    const other = repo.getPlayer(t.a === p.id ? t.b : t.a);
    if (Date.now() > Number(t.expiresAt || 0)) {
      tradeSessions.delete(t.id);
      return [false, "Trade expired."];
    }
    if (!tradeDistanceOk(p, other)) {
      tradeSessions.delete(t.id);
      return [
        false,
        "Trade cancelled because the players are no longer close enough.",
      ];
    }
    if (t.locked[p.id]) return [false, "Unlock your offer before changing it."];
    const o = t.offers[p.id] || (t.offers[p.id] = { gold: 0, items: [] });
    if (cmd.gold != null) {
      const g = Math.max(0, Math.floor(Number(cmd.gold) || 0));
      if (g > p.gold) return [false, "You do not have that much gold."];
      o.gold = g;
    }
    if (cmd.itemId) {
      const itemId = String(cmd.itemId),
        rawQty = Number(cmd.qty),
        already = o.items.find((x) => x.itemId === itemId);
      const def = inv.def(itemId);
      if (def?.soulbound || def?.tradeable === false)
        return [false, "That item cannot be traded."];
      if (Number.isFinite(rawQty) && rawQty < 0) {
        if (!already) return [false, "That item is not in your offer."];
        already.qty = Math.max(
          0,
          Number(already.qty || 0) -
            Math.min(999, Math.abs(Math.floor(rawQty))),
        );
        if (already.qty <= 0) o.items = o.items.filter((x) => x !== already);
      } else {
        const qty = Math.min(
          999,
          Math.max(
            1,
            Math.floor(Number.isFinite(rawQty) && rawQty !== 0 ? rawQty : 1),
          ),
        );
        const owned = p.inventory
          .filter((x) => x.itemId === itemId && x.qty > 0)
          .reduce((n, x) => n + Number(x.qty || 0), 0);
        const next = (already?.qty || 0) + qty;
        if (next > owned)
          return [false, "You do not have enough of that item."];
        if (already) already.qty = next;
        else o.items.push({ itemId, qty });
      }
    }
    const otherId = t.a === p.id ? t.b : t.a;
    t.locked[p.id] = false;
    t.locked[otherId] = false;
    t.confirmed[p.id] = false;
    t.confirmed[otherId] = false;
    t.updatedAt = Date.now();
    return [true, "Trade offer updated."];
  }
  function validateTradeOffers(a, b, oa, ob) {
    if (oa.gold > a.gold || ob.gold > b.gold)
      return [false, "Gold offer changed."];
    for (const x of oa.items) {
      const owned = a.inventory
        .filter((i) => i.itemId === x.itemId && i.qty > 0)
        .reduce((n, i) => n + Number(i.qty || 0), 0);
      if (owned < x.qty)
        return [false, "One of your item offers is no longer available."];
      const d = inv.def(x.itemId);
      if (d?.soulbound || d?.tradeable === false)
        return [false, "One of the offered items is no longer tradeable."];
    }
    for (const x of ob.items) {
      const owned = b.inventory
        .filter((i) => i.itemId === x.itemId && i.qty > 0)
        .reduce((n, i) => n + Number(i.qty || 0), 0);
      if (owned < x.qty)
        return [false, "The other player no longer has an offered item."];
      const d = inv.def(x.itemId);
      if (d?.soulbound || d?.tradeable === false)
        return [false, "One of the offered items is no longer tradeable."];
    }
    const simulate = (owner, ownOffer, incoming) => {
      const arr = owner.inventory.map((x) => ({ ...x }));
      const remove = (id, q) => {
        let remaining = Math.max(0, Number(q) || 0);
        for (const x of arr) {
          if (x.itemId !== id || x.qty <= 0) continue;
          const take = Math.min(Number(x.qty) || 0, remaining);
          x.qty -= take;
          remaining -= take;
          if (remaining <= 0) break;
        }
        for (let i = arr.length - 1; i >= 0; i--)
          if (Number(arr[i].qty || 0) <= 0) arr.splice(i, 1);
        return remaining <= 0;
      };
      const give = (id, q) => {
        const d = inv.def(id),
          stack = d?.type === "material" || d?.type === "consumable";
        if (stack) {
          const x = arr.find((i) => i.itemId === id && i.qty > 0);
          if (x) {
            x.qty += q;
            return true;
          }
        }
        if (arr.filter((i) => i.qty > 0).length + (stack ? 1 : q) > 30)
          return false;
        if (stack) arr.push({ itemId: id, qty: q });
        else for (let i = 0; i < q; i++) arr.push({ itemId: id, qty: 1 });
        return true;
      };
      for (const x of ownOffer.items)
        if (!remove(x.itemId, x.qty)) return false;
      for (const x of incoming.items) if (!give(x.itemId, x.qty)) return false;
      return true;
    };
    if (!simulate(a, oa, ob))
      return [
        false,
        "You do not have enough free inventory space for the trade.",
      ];
    if (!simulate(b, ob, oa))
      return [
        false,
        "The other player does not have enough free inventory space for the trade.",
      ];
    return [true];
  }
  async function completeTradeLocked(t) {
    if (!t || t.committing)
      return [false, "This trade is already being completed."];
    const a = repo.getPlayer(t.a),
      b = repo.getPlayer(t.b);
    if (!a || !b || !tradeDistanceOk(a, b))
      return [
        false,
        "Trade cancelled because the players are no longer available or close enough.",
      ];
    if (
      !t.locked[a.id] ||
      !t.locked[b.id] ||
      !t.confirmed[a.id] ||
      !t.confirmed[b.id]
    )
      return [false, "Both players must lock and confirm the trade."];
    const oa = t.offers[a.id] || { gold: 0, items: [] },
      ob = t.offers[b.id] || { gold: 0, items: [] };
    const valid = validateTradeOffers(a, b, oa, ob);
    if (!valid[0]) return valid;
    t.committing = true;
    const snapA = {
        inventory: a.inventory.map((x) => ({ ...x })),
        gold: a.gold,
        quests: structuredClone(a.quests ?? a.questStates ?? null),
      },
      snapB = {
        inventory: b.inventory.map((x) => ({ ...x })),
        gold: b.gold,
        quests: structuredClone(b.quests ?? b.questStates ?? null),
      };
    try {
      for (const x of oa.items)
        if (!inv.remove(a, x.itemId, x.qty)) throw new Error("a remove");
      for (const x of ob.items)
        if (!inv.remove(b, x.itemId, x.qty)) throw new Error("b remove");
      for (const x of oa.items)
        if (!inv.give(b, x.itemId, x.qty)) throw new Error("b give");
      for (const x of ob.items)
        if (!inv.give(a, x.itemId, x.qty)) throw new Error("a give");
      a.gold = a.gold - oa.gold + ob.gold;
      b.gold = b.gold - ob.gold + oa.gold;
      inv.recalc(a);
      inv.recalc(b);
      quest.onTrade(a);
      quest.onTrade(b);
      await repo.savePlayersAtomically([a, b]);
      return [
        true,
        "Trade completed.",
        { tradeId: t.id, aId: a.id, bId: b.id, aGold: a.gold, bGold: b.gold },
      ];
    } catch (error) {
      a.inventory = snapA.inventory;
      a.gold = snapA.gold;
      b.inventory = snapB.inventory;
      b.gold = snapB.gold;
      if (snapA.quests !== null) {
        if (a.quests !== undefined) a.quests = snapA.quests;
        else a.questStates = snapA.quests;
      }
      if (snapB.quests !== null) {
        if (b.quests !== undefined) b.quests = snapB.quests;
        else b.questStates = snapB.quests;
      }
      inv.recalc(a);
      inv.recalc(b);
      return [
        false,
        "Trade could not be committed; no items or gold were changed.",
      ];
    } finally {
      t.committing = false;
    }
  }
  async function completeTrade(t) {
    if (!t) return [false, "No active trade."];
    if (!playerMutations?.withPlayers) return completeTradeLocked(t);
    return playerMutations.withPlayers([t.a, t.b], () =>
      completeTradeLocked(t),
    );
  }

  const domainService = new TradeDomainService({
    tradeState,
    tradeOffer,
    completeTrade,
    tradeDistanceOk,
  });
  return {
    tradeRequests,
    tradeSessions,
    tradeState,
    findTradeSession,
    tradeDistanceOk,
    tradeOffer,
    completeTrade,
    domainService,
  };
}
