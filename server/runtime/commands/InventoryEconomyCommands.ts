export function registerInventoryEconomyCommands(handlers: any, ctx: any) {
  const {
    bus,
    repo,
    activeSessions,
    reservedCharacterNames,
    guildOrganizations,
    worldIntegration,
    classes,
    classStories,
    storyChoices,
    lore,
    npcDialogue,
    storyline,
    worldStory,
    zones,
    world,
    inv,
    quest,
    combat,
    dungeonEngine,
    economy,
    social,
    profession,
    abilities,
    items,
    dungeons,
    recipes,
    shops,
    storyIntro,
    talents,
    talentTrees,
    classBuilds,
    MOVEMENT_SPEEDS,
    COMBAT_RANGES,
    normalizeAbilityRange,
    normalizeGameDistance,
    NPC_INTERACTION_METERS,
    NPC_STAND_METERS,
    AUTO_TARGET_MAX_METERS,
    battlegroundQueue,
    battlegrounds,
    pvpQueueTimes,
    pvpZone,
    pvpAllowed,
    pvpStats,
    finishDuel,
    startBattleground,
    battlegroundSnapshot,
    arenaQueues,
    arenaMatches,
    enqueueArena,
    leaveArenaQueue,
    finishArena,
    clearPvpTemplate,
    dungeonQueue,
    dungeonQueueService,
    dungeonQueueRole,
    dungeonQueueSnapshot,
    enqueueDungeonQueue,
    leaveDungeonPartyQueue,
    acceptDungeonMatch,
    declineDungeonMatch,
    removeDungeonQueue,
    tryMatchDungeonQueue,
    addChat,
    normalizeCharacterName,
    characterNameTaken,
    pushFx,
    rewardMobKill,
    reward,
    gainXp,
    rebuildTalents,
    partyState,
    storyProgressForPlayer,
    finiteNumber,
    rollDamage,
    normalizeXpTrack,
    repositoryStatsSnapshot,
    npcDetail,
    npcMemory,
    reconcileTravelQuestState,
    makeGearInstance,
    randomAffix,
    itemization,
    findTradeSession,
    tradeRequests,
    tradeDistanceOk,
    tradeSessions,
    tradeOffer,
    completeTrade,
    resolveLootRollForParty,
    claimDungeonRewardChest,
    partyRole,
    npcInteractionService,
    runtimeId,
  } = ctx;
  handlers["equip"] = async function (p: any, cmd: any) {
    return inv.equip(p, cmd.itemId);
  };
  handlers["unequip"] = async function (p: any, cmd: any) {
    return inv.unequip(p, cmd.slot);
  };
  handlers["sell_shop"] = async function (p: any, cmd: any) {
    if (!npcInteractionService.isActiveNpcNearby(p))
      return [false, "You moved too far away from the shop."];
    const item = items[cmd.itemId];
    if (!item) return [false, "Unknown item."];
    if (p.equipment && Object.values(p.equipment).includes(cmd.itemId))
      return [false, "Unequip the item before selling it."];
    const qty = Math.max(1, Math.min(20, Number(cmd.qty) || 1));
    if (!inv.remove(p, cmd.itemId, qty))
      return [false, "You do not have that item."];
    const value = Math.max(1, Number(item.vendorPrice) || 1) * qty;
    p.gold += value;
    p.recentSales = Array.isArray(p.recentSales) ? p.recentSales : [];
    p.recentSales.unshift({
      itemId: cmd.itemId,
      qty,
      soldAt: Date.now(),
      unitPrice: Math.max(1, Number(item.vendorPrice) || 1),
    });
    p.recentSales = p.recentSales.slice(0, 12);
    quest.onSell(p, cmd.itemId, qty);
    repo.savePlayer(p);
    return [true, `Sold ${qty} × ${item.name} for ${value} gold.`];
  };
  handlers["buyback_shop"] = async function (p: any, cmd: any) {
    if (!npcInteractionService.isActiveNpcNearby(p))
      return [false, "You moved too far away from the shop."];
    const sale = (p.recentSales || []).find(
      (x) =>
        x.itemId === String(cmd.itemId || "") &&
        Number(x.soldAt || 0) > Date.now() - 30 * 60 * 1000,
    );
    if (!sale) return [false, "That item is no longer available for buyback."];
    const qty = Math.max(
      1,
      Math.min(Number(sale.qty || 1), Number(cmd.qty) || Number(sale.qty || 1)),
    );
    const price =
      Math.max(1, Math.ceil(Number(sale.unitPrice || 1) * 1.5)) * qty;
    if (p.gold < price) return [false, `You need ${price} gold for buyback.`];
    if (!inv.canGive(p, sale.itemId, qty)) return [false, "Your bag is full."];
    p.gold -= price;
    if (!inv.give(p, sale.itemId, qty)) {
      p.gold += price;
      return [false, "Buyback failed."];
    }
    sale.qty -= qty;
    if (sale.qty <= 0) p.recentSales = p.recentSales.filter((x) => x !== sale);
    repo.savePlayer(p);
    return [
      true,
      `Bought back ${qty} × ${items[sale.itemId]?.name || sale.itemId} for ${price} gold.`,
    ];
  };
  handlers["select_profession"] = async function (p: any, cmd: any) {
    const id = String(cmd.profession || "");
    if (
      !["mining", "blacksmith", "skinning", "alchemy", "cooking"].includes(id)
    )
      return [false, "Unknown profession."];
    const trainer = (world.zoneNpcs(p.zone) || []).find(
      (n) => n.kind === "profession_trainer" && n.profession === id,
    );
    if (
      !trainer ||
      Math.hypot(p.x - trainer.x, p.y - trainer.y) >
        world.normalizedMeters(p.zone, 12)
    )
      return [false, `Visit the ${id} trainer to learn this profession.`];
    profession.ensure(p);
    if (p.professions.includes(id)) return [true, `${id} is already selected.`];
    if (p.professions.length >= 2)
      return [false, "You can only learn two professions."];
    p.professions.push(id);
    p.profession[id] = p.profession[id] || 1;
    p.professionXp[id] = p.professionXp[id] || 0;
    if (id === "blacksmith" && !p.knownRecipes?.length)
      p.knownRecipes = recipes
        .filter(
          (r: any) =>
            r.profession === "blacksmith" && Number(r.level || 1) <= 1,
        )
        .map((r: any) => r.id);
    return [true, `Learned ${id}.`];
  };
  handlers["auction_list"] = async function (p: any, cmd: any) {
    const r = await economy.list(
      p,
      cmd.itemId,
      Math.max(1, Number(cmd.price) || 1),
      Math.max(1, Number(cmd.qty) || 1),
      cmd.buyout == null ? null : Number(cmd.buyout),
    );
    if (r[0]) {
      quest.onAuction(p, "any", 1);
    }
    return r;
  };
  handlers["auction_buy"] = async function (p: any, cmd: any) {
    return await economy.buy(p, cmd.auctionId, repo.players, false);
  };
  handlers["redeem_gear_token"] = async function (p: any, cmd: any) {
    const tokenId = String(cmd.tokenId || ""),
      setId = String(cmd.setId || ""),
      slot = String(cmd.slot || "");
    const tokenDef = items[tokenId],
      tokenRule = tokenDef?.itemization?.exchange;
    if (!tokenDef || tokenDef.type !== "material" || !tokenRule)
      return [false, "Unknown gear token."];
    const stack = p.inventory.find(
      (x: any) => x.itemId === tokenId && x.qty > 0,
    );
    if (!stack) return [false, "You do not have that gear token."];
    const set = (itemization?.sets || []).find((x: any) => x.id === setId);
    if (!set) return [false, "Unknown gear set."];
    if (
      Array.isArray(tokenRule.families) &&
      !tokenRule.families.includes(set.progressionBand || set.family)
    )
      return [false, "That token cannot purchase this tier."];
    const def = Object.values(items).find(
      (x: any) =>
        x &&
        !x.generated &&
        x.setId === setId &&
        (x.setSlot === slot ||
          (slot === "ring" && x.type === "ring" && x.setSlot === "ring") ||
          (slot === "ring2" && x.type === "ring" && x.setSlot === "ring2") ||
          (slot === "relic" && x.type === "relic" && x.setSlot === "relic") ||
          (slot === "relic2" && x.type === "relic" && x.setSlot === "relic2")),
    );
    if (!def) return [false, "No item exists for that set slot."];
    const cost = Math.max(1, Number(tokenRule.cost || 3));
    if (stack.qty < cost)
      return [false, `You need ${cost} ${tokenDef.name || tokenId}.`];
    const bagBefore = p.inventory.map((x: any) => ({ ...x }));
    stack.qty -= cost;
    p.inventory = p.inventory.filter((x: any) => x.qty > 0);
    if (!inv.give(p, (def as any).id, 1)) {
      p.inventory = bagBefore;
      return [false, "Your bag is full."];
    }
    inv.recalc(p);
    repo.savePlayer(p);
    return [
      true,
      `Purchased ${(def as any).name}.`,
      { itemId: (def as any).id, cost, tokenId },
    ];
  };
  handlers["upgrade_gear"] = async function (p: any, cmd: any) {
    const itemId = String(cmd.itemId || "");
    const stack = p.inventory.find((x) => x.itemId === itemId && x.qty > 0);
    if (!stack) return [false, "You do not own that item."];
    const base = items[itemId];
    if (
      !base ||
      ![
        "weapon",
        "shield",
        "helmet",
        "chest",
        "shoulders",
        "gloves",
        "boots",
        "neck",
        "ring",
        "relic",
      ].includes(base.type)
    )
      return [false, "That item cannot be upgraded."];
    const ensureInstance = (id) => {
      const existing = items[id];
      if (existing?.generated) return id;
      const source = items[id];
      const instanceId = `${id}__up_${runtimeId("item").slice(5)}`;
      const inst = {
        ...source,
        id: instanceId,
        baseItemId: id,
        generated: true,
        upgradeLevel: 0,
        affixes: (source.affixes || []).map((a) => ({ ...a })),
        description: `${source.description || ""} Upgradable equipment.`,
      };
      items[instanceId] = inst;
      p.generatedItems = p.generatedItems || {};
      p.generatedItems[instanceId] = inst;
      stack.itemId = instanceId;
      return instanceId;
    };
    const existing = items[itemId];
    const maxLevel = Number(
        existing?.upgrade?.maxLevel || existing?.level || 1,
      ),
      current = Number(existing?.level || existing?.itemLevel || 1);
    if (current >= maxLevel)
      return [false, "This item is already fully upgraded."];
    const material = String(existing?.upgrade?.material || "ashbound_thread"),
      goldCost = Math.max(
        1,
        Math.round(
          Number(existing?.upgrade?.goldPerLevel || 20) *
            (1 +
              Math.max(
                0,
                current - (Number(existing?.baseItemLevel) || current),
              ) *
                0.15),
        ),
      );
    const mat = p.inventory.find((x) => x.itemId === material && x.qty > 0);
    if (!mat || mat.qty < 1)
      return [false, `You need 1 ${items[material]?.name || material}.`];
    if (Number(p.gold || 0) < goldCost)
      return [false, `You need ${goldCost} gold.`];
    const id = ensureInstance(itemId),
      it = items[id];
    mat.qty--;
    if (mat.qty <= 0) p.inventory = p.inventory.filter((x) => x.qty > 0);
    p.gold -= goldCost;
    it.level = current + 1;
    it.itemLevel = it.level;
    it.upgradeLevel = Number(it.upgradeLevel || 0) + 1;
    const delta = Number(it.upgrade?.powerPerLevel || 1);
    if (it.power != null) it.power = Number((it.power + delta).toFixed(1));
    if (it.armor != null)
      it.armor = Math.round(Number(it.armor) + Math.max(1, delta * 0.8));
    it.price = Math.round(Number(it.price || it.vendorPrice || 20) * 1.06);
    it.name = it.name.replace(/ \+\d+$/, "") + ` +${it.upgradeLevel}`;
    inv.recalc(p);
    repo.savePlayer(p);
    return [
      true,
      `${it.name} upgraded to item level ${it.level}.`,
      { itemId: id, item: it, level: it.level, gold: goldCost, material },
    ];
  };
}
