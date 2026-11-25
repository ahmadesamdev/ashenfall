import { runtimeId } from "../shared/Ids.js";
import {
  ensureStoryState,
  makeChoice,
  discoverLore,
  classStoryState,
  claimClassStory,
  narrativeSnapshot,
} from "../progression/StoryProgression.js";
import {
  cloneLoadout,
  normalizeLoadoutSlot,
  LOADOUT_SLOTS,
} from "../progression/Loadouts.js";
import { LoadoutService } from "../progression/LoadoutService.js";
import { NpcInteractionService } from "../world/NpcInteractionService.js";
import { createMovementCommands } from "./commands/MovementCommands.js";
import { registerCharacterCommands } from "./commands/CharacterCommands.js";
import { registerWorldCombatCommands } from "./commands/WorldCombatCommands.js";
import { registerQuestStoryCommands } from "./commands/QuestStoryCommands.js";
import { registerSocialCommands } from "./commands/SocialCommands.js";
import { registerEncounterCombatCommands } from "./commands/EncounterCombatCommands.js";
import { registerInventoryEconomyCommands } from "./commands/InventoryEconomyCommands.js";
import { registerDungeonCommands } from "./commands/DungeonCommands.js";
import { registerPvpCommands } from "./commands/PvpCommands.js";

export function createCommandHandlers(ctx: any) {
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
  } = ctx;
  const loadoutService = new LoadoutService({
    items,
    talents,
    classBuilds,
    talentTrees,
    inventory: inv,
    rebuildTalents,
  });
  const npcInteractionService = new NpcInteractionService(world);
  const movementCommands = createMovementCommands({ world });
  const commandCtx: any = {
    ...ctx,
    loadoutService,
    npcInteractionService,
    movementCommands,
    runtimeId,
    ensureStoryState,
    makeChoice,
    discoverLore,
    classStoryState,
    claimClassStory,
    narrativeSnapshot,
    cloneLoadout,
    normalizeLoadoutSlot,
    LOADOUT_SLOTS,
  };
  const handlers: any = {};
  handlers["move"] = async function (p: any, cmd: any) {
    return movementCommands.move(p, cmd);
  };
  handlers["move_input"] = async function (p: any, cmd: any) {
    return movementCommands.moveInput(p, cmd);
  };
  handlers["stop"] = async function (p: any, cmd: any) {
    return movementCommands.stop(p);
  };
  handlers["toggle_run"] = async function (p: any, cmd: any) {
    return movementCommands.toggleRun(p);
  };
  handlers["drop_profession"] = async function (p: any, cmd: any) {
    const id = String(cmd.profession || "");
    const trainer = (world.zoneNpcs(p.zone) || []).find(
      (n) => n.kind === "profession_trainer" && n.profession === id,
    );
    if (
      !trainer ||
      Math.hypot(p.x - trainer.x, p.y - trainer.y) >
        world.normalizedMeters(p.zone, 12)
    )
      return [false, `Visit the ${id} trainer to forget this profession.`];
    profession.ensure(p);
    if (!p.professions.includes(id))
      return [false, "You do not know that profession."];
    p.professions = p.professions.filter((x) => x !== id);
    delete p.profession[id];
    delete p.professionXp[id];
    p.professionSpecializations[id] = null;
    if (id === "blacksmith") {
      const blacksmithRecipeIds = new Set(
        recipes
          .filter((r: any) => r.profession === "blacksmith")
          .map((r: any) => r.id),
      );
      p.knownRecipes = (p.knownRecipes || []).filter(
        (recipeId: any) => !blacksmithRecipeIds.has(recipeId),
      );
    }
    return [true, `Forgot ${id}.`];
  };
  handlers["set_profession_specialization"] = async function (
    p: any,
    cmd: any,
  ) {
    const id = String(cmd.profession || ""),
      spec = String(cmd.specialization || "");
    if (!p.professions?.includes(id))
      return [false, "You do not know that profession."];
    return profession.setSpecialization(p, id, spec);
  };
  handlers["auction_search"] = async function (p: any, cmd: any) {
    const filters =
      cmd.filters && typeof cmd.filters === "object" ? cmd.filters : cmd;
    return [true, "Market search.", { market: economy.search(filters) }];
  };
  handlers["market_stats"] = async function (p: any, cmd: any) {
    return [
      true,
      "Market statistics.",
      { stats: economy.marketStats(cmd.itemId, cmd.days) },
    ];
  };
  handlers["auction_seller_history"] = async function (p: any, cmd: any) {
    return [
      true,
      "Seller history.",
      { history: economy.sellerHistory(p.id, cmd.days) },
    ];
  };
  handlers["auction_cancel"] = async function (p: any, cmd: any) {
    return await economy.cancel(p, cmd.auctionId);
  };
  handlers["auction_bid"] = async function (p: any, cmd: any) {
    return await economy.bid(
      p,
      cmd.auctionId,
      Math.max(1, Number(cmd.amount) || 0),
      repo.players,
    );
  };
  handlers["mail_state"] = async function (p: any, cmd: any) {
    await economy.ready();
    economy.purgeMail(p.id, Date.now(), false);
    return [
      true,
      "Mailbox loaded.",
      { mail: economy.mailFor(p.id), summary: economy.mailSummary(p.id) },
    ];
  };
  handlers["mail_read"] = async function (p: any, cmd: any) {
    return await economy.markMailRead(p, cmd.mailId, true);
  };
  handlers["mail_unread"] = async function (p: any, cmd: any) {
    return await economy.markMailRead(p, cmd.mailId, false);
  };
  handlers["claim_mail"] = async function (p: any, cmd: any) {
    return await economy.claimMail(p, cmd.mailId);
  };
  handlers["claim_all_mail"] = async function (p: any, cmd: any) {
    return await economy.claimAllMail(p);
  };
  handlers["delete_mail"] = async function (p: any, cmd: any) {
    return await economy.deleteMail(p, cmd.mailId);
  };
  handlers["buy_shop"] = async function (p: any, cmd: any) {
    if (!npcInteractionService.isActiveNpcNearby(p))
      return [false, "You moved too far away from the shop."];
    const shop = (shops[p.zone] || []).find((s) => s.id === cmd.shopId);
    const line = shop?.items?.find((x) => x.itemId === cmd.itemId);
    if (!shop || !line) return [false, "That shop does not sell this item."];
    const qty = Math.max(1, Math.min(20, Number(cmd.qty) || 1));
    const cost = line.price * qty;
    if (p.gold < cost) return [false, `You need ${cost} gold.`];
    if (!inv.canGive(p, cmd.itemId, qty)) return [false, "Your bag is full."];
    p.gold -= cost;
    if (!inv.give(p, cmd.itemId, qty)) {
      p.gold += cost;
      return [false, "Purchase failed because your bag is full."];
    }
    return [
      true,
      `Purchased ${qty} × ${items[cmd.itemId]?.name || cmd.itemId} for ${cost} gold.`,
    ];
  };
  handlers["open_skill"] = async function (p: any, cmd: any) {
    return [true, abilities[cmd.abilityId] || null];
  };
  handlers["story_snapshot"] = async function (p: any, cmd: any) {
    ensureStoryState(p);
    return [
      true,
      "Story snapshot.",
      {
        storyProgress: narrativeSnapshot(
          p,
          storyline,
          worldStory,
          classStories,
          lore,
        ),
      },
    ];
  };
  handlers["make_story_choice"] = async function (p: any, cmd: any) {
    ensureStoryState(p);
    const choice = (storyChoices?.choices || []).find(
      (x: any) => x.id === String(cmd.choiceId || ""),
    );
    if (!choice) return [false, "Unknown story choice."];
    const r = makeChoice(p, choice);
    if (r[0]) repo.savePlayer(p);
    return r;
  };
  handlers["class_story"] = async function (p: any, cmd: any) {
    ensureStoryState(p);
    return [
      true,
      "Class story.",
      { classStory: classStoryState(p, classStories) },
    ];
  };
  handlers["complete_class_story"] = async function (p: any, cmd: any) {
    ensureStoryState(p);
    const st = classStoryState(p, classStories);
    const step = (st?.steps || []).find(
      (x: any) => x.id === String(cmd.stepId || ""),
    );
    if (!step) return [false, "Unknown class story chapter."];
    const r = claimClassStory(p, step, classStories);
    if (r[0]) {
      const xp = Number((r[2] as any)?.reward?.xp || 0);
      if (xp > 0) gainXp(p, xp);
      repo.savePlayer(p);
    }
    return r;
  };
  handlers["discover_lore"] = async function (p: any, cmd: any) {
    ensureStoryState(p);
    const entry = (lore || []).find(
      (x: any) => x.id === String(cmd.loreId || ""),
    );
    const r = discoverLore(p, entry);
    if (r[0]) {
      const xp = Number((r[2] as any)?.reward?.xp || 0);
      if (xp > 0) gainXp(p, xp);
      repo.savePlayer(p);
    }
    return r;
  };
  handlers["open_story"] = async function (p: any, cmd: any) {
    if (!p.hasCharacter) return [false, "Create your character first."];
    p.storyDialogueOpen = true;
    return [
      true,
      "The prologue is open.",
      {
        story: true,
        step: p.storyDialogueStep || 0,
        dialogue: storyIntro.steps?.[p.storyDialogueStep || 0],
      },
    ];
  };
  handlers["advance_story"] = async function (p: any, cmd: any) {
    if (!p.storyDialogueOpen) return [false, "The story is already closed."];
    const total = storyIntro.steps.length;
    if (p.storyDialogueStep < total - 1) {
      p.storyDialogueStep++;
      return [
        true,
        "Continue.",
        {
          story: true,
          step: p.storyDialogueStep,
          dialogue: storyIntro.steps?.[p.storyDialogueStep],
        },
      ];
    }
    const introWasSeen = !!p.storyIntroSeen;
    p.storyDialogueOpen = false;
    p.storyIntroSeen = true;
    const qs = p.quests.call_of_ashenfall || {
      progress: 0,
      complete: false,
      claimed: false,
      visible: true,
      accepted: false,
    };
    if (!introWasSeen && !qs.claimed && !qs.accepted && !qs.complete) {
      qs.visible = true;
      qs.accepted = true;
      qs.complete = false;
      qs.progress = 0;
    }
    p.quests.call_of_ashenfall = qs;
    return [
      true,
      "Your journey begins. Captain Aric is waiting to brief you.",
      { offeredQuest: "call_of_ashenfall", story: true, closed: true },
    ];
  };
  handlers["mine_ore"] = async function (p: any, cmd: any) {
    if (p.professions?.length && !p.professions.includes("mining"))
      return [false, "You have not selected Mining."];
    const r = world.mineOre(p, cmd.oreId);
    if (!r[0]) return r;
    if (r[1]?.approaching) return r;
    if (r[1]?.mining)
      return [
        true,
        `Mining started.`,
        { mining: true, endsAt: r[1].endsAt, duration: r[1].duration },
      ];
    return [false, "Mining could not be started."];
  };
  handlers["craft_blacksmith"] = async function (p: any, cmd: any) {
    if (!npcInteractionService.isActiveNpcNearby(p))
      return [false, "You moved too far away from the blacksmith."];
    profession.ensure(p);
    if (!(p.professions || []).includes("blacksmith"))
      return [false, "You have not selected Blacksmithing."];
    const recipesByItem: any = {
      iron_sword: { level: 1, materials: [["copper_ore", 3]] },
      grave_steel_blade: { level: 3, materials: [["umbral_iron_ore", 5]] },
      blacksteel_blade: { level: 6, materials: [["blacksteel_ore", 6]] },
    };
    const output = String(cmd.itemId || "");
    const plan = recipesByItem[output];
    const def = items[output];
    if (!plan || !def) return [false, "That item is not forgeable here."];
    if (Number(p.profession?.blacksmith || 0) < plan.level)
      return [false, `Reach Blacksmithing ${plan.level}.`];
    for (const [itemId, qty] of plan.materials)
      if (
        !inv.has(p, itemId) ||
        Number(p.inventory.find((x: any) => x.itemId === itemId)?.qty || 0) <
          qty
      )
        return [false, `You need ${qty} × ${items[itemId]?.name || itemId}.`];
    if (!inv.canGive(p, output, 1)) return [false, "Your bag is full."];
    for (const [itemId, qty] of plan.materials)
      if (!inv.remove(p, itemId, qty))
        return [false, "Forge materials changed; try again."];
    if (!inv.give(p, output, 1)) {
      for (const [itemId, qty] of plan.materials) inv.give(p, itemId, qty);
      return [false, "Could not place the forged item in your bag."];
    }
    const xp = 25 + plan.level * 12;
    const prog = profession.awardXp(p, "blacksmith", xp);
    quest.onCraft(p, output, 1);
    inv.recalc(p);
    repo.savePlayer(p);
    return [
      true,
      `Forged ${def.name}.`,
      {
        itemId: output,
        qty: 1,
        profession: "blacksmith",
        xp,
        professionProgress: prog,
      },
    ];
  };
  handlers["craft_recipe"] = async function (p: any, cmd: any) {
    if (!npcInteractionService.isActiveNpcNearby(p))
      return [false, "You moved too far away from the crafting NPC."];
    profession.ensure(p);
    const recipe = recipes.find(
      (r: any) => r.id === String(cmd.recipeId || cmd.itemId || ""),
    );
    if (!recipe) return [false, "Unknown recipe."];
    const prof = String(recipe.profession || "");
    if (!(p.professions || []).includes(prof))
      return [false, `You have not learned ${prof}.`];
    if (!profession.knownRecipe(p, recipe))
      return [false, "You have not discovered this recipe yet."];
    if ((p.profession?.[prof] || 1) < Number(recipe.level || 1))
      return [false, `Reach ${prof} ${recipe.level}.`];
    const plan = profession.materialPlanForRecipe(p, recipe);
    for (const mat of plan)
      if (
        !inv.has(p, mat.itemId) ||
        (p.inventory.find((x: any) => x.itemId === mat.itemId)?.qty || 0) <
          mat.qty
      )
        return [
          false,
          `You need ${mat.qty} × ${items[mat.itemId]?.name || mat.itemId}.`,
        ];
    const out = String(recipe.output),
      qty = Math.max(1, Number(recipe.qty || 1));
    if (!items[out])
      return [false, "Recipe output is missing from the item catalog."];
    if (!inv.canGive(p, out, qty)) return [false, "Your bag is full."];
    const quality = profession.qualityFor(p, recipe);
    const base = items[out];
    const craftedId = [
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
      ? makeGearInstance(out, "crafting", p, quality)
      : out;
    if (!inv.canGive(p, craftedId, qty)) return [false, "Your bag is full."];
    for (const mat of plan) inv.remove(p, mat.itemId, mat.qty);
    if (!inv.give(p, craftedId, qty)) {
      for (const mat of plan) inv.give(p, mat.itemId, mat.qty);
      if (craftedId !== out) {
        delete items[craftedId];
        delete p.generatedItems?.[craftedId];
      }
      return [false, "Could not place the crafted item in your bag."];
    }
    const xp = 25 + Number(recipe.level || 1) * 12;
    const prog = profession.awardXp(p, prof, xp);
    quest.onCraft(p, recipe.id, 1);
    inv.recalc(p);
    const item = items[craftedId] || items[out];
    return [
      true,
      `Crafted ${item?.name || out}${item?.craftQuality ? ` (${item.craftQuality} quality)` : ""}.`,
      {
        profession: prof,
        level: prog.level,
        itemId: craftedId,
        quality: item?.craftQuality || "standard",
        materialsSaved: plan.filter((x) => x.saved).length,
        discoveries: prog.discoveries,
      },
    ];
  };
  handlers["pickup_loot"] = async function (p: any, cmd: any) {
    const id = String(cmd.pileId || "");
    const pile = world.lootPiles.get(id);
    if (!pile) return [false, "That loot is no longer available."];
    if (!inv.canGiveMany(p, pile.items || []))
      return [
        false,
        "Your bag is full. Free a slot before collecting this loot.",
      ];
    const inventoryBefore = (p.inventory || []).map((x: any) => ({ ...x }));
    const goldBefore = Number(p.gold || 0);
    const professionBefore = structuredClone(p.profession || {});
    const professionXpBefore = structuredClone(p.professionXp || {});
    const recipesBefore = [...(p.knownRecipes || [])];
    const pileBefore = structuredClone(pile);
    const r = world.pickupLoot(p, id);
    if (!r[0]) return r;
    if (r[1].approaching) return r;
    const rewards = r[1] || { gold: 0, items: [] };
    if (!inv.canGiveMany(p, rewards.items || [])) {
      world.lootPiles.set(id, pileBefore);
      return [
        false,
        "Your bag is full. Free a slot before collecting this loot.",
      ];
    }
    let committed = true;
    for (const it of rewards.items || []) {
      if (!inv.give(p, it.itemId, it.qty)) {
        committed = false;
        break;
      }
    }
    if (!committed) {
      p.inventory = inventoryBefore;
      p.gold = goldBefore;
      inv.recalc(p);
      world.lootPiles.set(id, pileBefore);
      return [
        false,
        "Loot could not be added. Your inventory and the loot pile were restored.",
      ];
    }
    p.gold = goldBefore + Math.max(0, Number(rewards.gold || 0));
    let prog = null;
    if (
      p.professions?.includes("skinning") &&
      (rewards.items || []).some((x: any) => x.itemId === "wolf_fang")
    )
      prog = profession.awardXp(p, "skinning", profession.skinningXp(p, 12));
    inv.recalc(p);
    try {
      await repo.savePlayerNow(p);
    } catch (error: any) {
      p.inventory = inventoryBefore;
      p.gold = goldBefore;
      p.profession = professionBefore;
      p.professionXp = professionXpBefore;
      p.knownRecipes = recipesBefore;
      inv.recalc(p);
      world.lootPiles.set(id, pileBefore);
      return [
        false,
        "Loot could not be saved. Your inventory and the loot pile were restored.",
      ];
    }
    return [
      true,
      `Loot collected: +${Math.max(0, Number(rewards.gold || 0))} gold.${prog ? " Skinning XP gained." : ""}`,
      prog
        ? {
            profession: "skinning",
            level: prog.level,
            discoveries: prog.discoveries,
          }
        : undefined,
    ];
  };
  handlers["reroll_gear"] = async function (p: any, cmd: any) {
    const id = String(cmd.itemId || ""),
      it = items[id];
    if (!it?.generated)
      return [false, "That item has no randomized stats to roll."];
    if (!inv.has(p, "veilglass_prism"))
      return [false, "You need a Veilglass Prism to reroll gear."];
    if (
      !p.inventory.some((x) => x.itemId === id && x.qty > 0) &&
      !Object.values(p.equipment || {}).includes(id)
    )
      return [false, "That gear is not yours."];
    const randomAffixes = (it.affixes || []).filter((a) => a.random);
    if (!randomAffixes.length)
      return [false, "This item has no randomized affix to reroll."];
    const index = Math.floor(Math.random() * randomAffixes.length),
      existing = new Set(
        (it.affixes || [])
          .filter((a, i) => !a.random || i !== index)
          .map((a) => a.stat),
      );
    const fresh = randomAffix(existing, Number(it.level || 1), it.rarity, p);
    if (!fresh)
      return [false, "No alternate affix is available for this item."];
    const original = it.affixes.findIndex(
      (a) => a.random === true && a.stat === randomAffixes[index].stat,
    );
    if (original < 0)
      return [false, "The randomized affix could not be found."];
    it.affixes[original] = fresh;
    it.rerollCount = (it.rerollCount || 0) + 1;
    it.description = `${it.baseItemId ? items[it.baseItemId]?.description || "Gear item." : ""} Reforged ${it.rarity} gear.`;
    inv.remove(p, "veilglass_prism", 1);
    inv.recalc(p);
    return [
      true,
      `Reforged ${it.name}: ${fresh.name}.`,
      { itemId: id, item: it },
    ];
  };
  handlers["use_item"] = async function (p: any, cmd: any) {
    if (p.dead) return [false, "You cannot use items while dead."];
    const it = items[cmd.itemId];
    if (it?.effect === "reroll_gear")
      return [
        false,
        "Select a gear item and use a Veilglass Prism to reroll its randomized stats.",
      ];
    if (it?.effect === "hearthstone")
      return [
        false,
        "Use the Ashen Homeward Stone from its dedicated control.",
      ];
    if (
      !it ||
      it.type !== "consumable" ||
      (!(Number(it.heal) > 0) && !(Number(it.resource) > 0))
    )
      return [false, "That item is not usable."];
    if (!inv.has(p, cmd.itemId)) return [false, "You do not have that item."];
    p.itemCooldowns = p.itemCooldowns || {};
    const n = Date.now();
    if ((p.itemCooldowns[cmd.itemId] || 0) > n)
      return [false, `${it.name} is on cooldown.`];
    const hpBefore = p.hp,
      resBefore = p.resolve;
    const hpAmount = Math.round(p.maxHp * (it.heal || 0));
    const resAmount = Math.round(p.maxResolve * (it.resource || 0));
    p.hp = Math.min(p.maxHp, p.hp + hpAmount);
    p.resolve = Math.min(p.maxResolve, p.resolve + resAmount);
    inv.remove(p, cmd.itemId, 1);
    p.itemCooldowns[cmd.itemId] = n + (it.cooldown || 0) * 1000;
    return [
      true,
      `${it.name} restores ${p.hp - hpBefore} HP${resAmount ? ` and ${p.resolve - resBefore} ${p.resourceName}` : ""}.`,
    ];
  };
  handlers["use_hearthstone"] = async function (p: any, cmd: any) {
    const itemId = "ashen_homeward_stone";
    if (!inv.has(p, itemId))
      return [false, "You do not have an Ashen Homeward Stone."];
    if (p.dead) return [false, "You cannot use the Homeward Stone while dead."];
    if (p.dungeon || p.encounterId)
      return [
        false,
        "You cannot use the Homeward Stone inside a dungeon or encounter. Leave combat first.",
      ];
    if (
      p.pvp?.state === "arena" ||
      p.pvp?.state === "battleground" ||
      p.battlegroundId
    )
      return [
        false,
        "You cannot use the Homeward Stone in an arena or battleground.",
      ];
    if (p.worldCombatMobId || p.combat?.autoAttack)
      return [false, "You cannot use the Homeward Stone during combat."];
    if ((p.itemCooldowns?.[itemId] || 0) > Date.now())
      return [false, "The Homeward Stone is on cooldown."];
    const home = world.byId[p.homeCity]?.city
      ? p.homeCity
      : world.zones.find((z) => z.city)?.id || "stonehold";
    world.combatService?.clearWorldCombat?.(p);
    p.combat.manualMove = false;
    p.combat.queuedAbility = null;
    const r = world.travel(p, home, false);
    if (!r[0]) return r;
    const cooldownSeconds = Math.max(
      1,
      Number(items[itemId]?.cooldown || 1200),
    );
    p.itemCooldowns[itemId] = Date.now() + cooldownSeconds * 1000;
    return [true, `You return to ${world.byId[home].name}.`, { zoneId: home }];
  };
  handlers["save_loadout"] = async function (p: any, cmd: any) {
    if (p.encounterId || p.worldCombatMobId || p.dungeon)
      return [
        false,
        "You cannot save a loadout during combat or inside a dungeon.",
      ];
    const slot = normalizeLoadoutSlot(cmd.slot);
    const name =
      String(cmd.name || slot)
        .trim()
        .slice(0, 28) || slot;
    p.loadouts = Array.isArray(p.loadouts) ? p.loadouts : [];
    const saved = cloneLoadout(p, slot, name);
    const index = p.loadouts.findIndex(
      (x: any) => x.id === saved.id || x.slot === slot,
    );
    if (index >= 0) p.loadouts[index] = saved;
    else p.loadouts.push(saved);
    p.activeLoadoutId = saved.id;
    await repo.savePlayerNow(p);
    return [true, `Saved loadout: ${saved.name}.`, { loadout: saved }];
  };
  handlers["delete_loadout"] = async function (p: any, cmd: any) {
    const requestedId = String(cmd.loadoutId || "");
    const slot = normalizeLoadoutSlot(cmd.slot || requestedId);
    const deleted = (p.loadouts || []).find(
      (x: any) => x.id === requestedId || x.slot === slot,
    );
    p.loadouts = (p.loadouts || []).filter(
      (x: any) => x.id !== requestedId && x.slot !== slot,
    );
    if (deleted && p.activeLoadoutId === deleted.id) p.activeLoadoutId = null;
    await repo.savePlayerNow(p);
    return [true, "Loadout deleted."];
  };
  handlers["apply_loadout"] = async function (p: any, cmd: any) {
    const l = loadoutService.find(p, cmd.loadoutId || cmd.slot);
    const r = loadoutService.apply(p, l);
    if (r[0]) await repo.savePlayerNow(p);
    return r;
  };
  handlers["set_specialization"] = async function (p: any, cmd: any) {
    return loadoutService.applyBuild(p, String(cmd.buildId || ""));
  };
  handlers["choose_build"] = async function (p: any, cmd: any) {
    return loadoutService.applyBuild(p, String(cmd.buildId || ""));
  };
  handlers["allocate_stat"] = async function (p: any, cmd: any) {
    const stat = cmd.stat;
    if (
      !["strength", "agility", "intellect", "vitality", "willpower"].includes(
        stat,
      )
    )
      return [false, "Invalid stat."];
    const amount = Math.max(1, Math.min(10, Number(cmd.amount) || 1));
    if ((p.statPoints || 0) < amount) return [false, "Not enough stat points."];
    p.statPoints -= amount;
    p.stats[stat] = (p.stats[stat] || 0) + amount;
    inv.recalc(p);
    p.lastBuildChange = {
      stat,
      at: Date.now(),
      stats: { ...p.stats },
      statPoints: p.statPoints,
    };
    return [true, `+${amount} ${stat}.`, { build: p.lastBuildChange }];
  };
  handlers["reset_stats"] = async function (p: any, cmd: any) {
    if (p.encounterId || p.worldCombatMobId || p.dungeon)
      return [
        false,
        "You cannot reset stats during combat or inside a dungeon.",
      ];
    const refund =
      (p.stats?.strength || 10) -
      10 +
      (p.stats?.agility || 10) -
      10 +
      (p.stats?.intellect || 10) -
      10 +
      (p.stats?.vitality || 10) -
      10 +
      (p.stats?.willpower || 10) -
      10;
    p.statPoints = (p.statPoints || 0) + Math.max(0, refund);
    p.stats = {
      strength: 10,
      agility: 10,
      intellect: 10,
      vitality: 10,
      willpower: 10,
    };
    inv.recalc(p);
    return [true, "Stat points reset."];
  };
  handlers["reset_talents"] = async function (p: any, cmd: any) {
    if (p.dungeon) return [false, "You cannot reset talents inside a dungeon."];
    if (p.encounterId || p.worldCombatMobId)
      return [false, "You cannot reset talents during combat."];
    let refund = 0;
    for (const t of p.talents || []) {
      const def = loadoutService.talentDefinition(p, t.id);
      if (def) refund += (t.rank || 0) * def.cost;
    }
    p.talentPoints = (p.talentPoints || 0) + refund;
    p.talents = [];
    p.combat = p.combat || {};
    p.combat.synergyNextPowerPct = 0;
    p.combat.synergyHistory = [];
    rebuildTalents(p);
    return [
      true,
      `Talents reset. Refunded ${refund} point(s).`,
      { refunded: refund },
    ];
  };
  handlers["learn_talent"] = async function (p: any, cmd: any) {
    if (p.dungeon)
      return [false, "You cannot change talents inside a dungeon."];
    if (p.encounterId || p.worldCombatMobId)
      return [false, "You cannot learn talents during combat."];
    const t = loadoutService.talentDefinition(p, cmd.talentId);
    if (!t) return [false, "Talent not found."];
    if ((p.level || 1) >= 10 && !p.activeBuildId)
      return [
        false,
        "Choose a specialization before learning advanced talents.",
      ];
    const node = loadoutService.talentNode(p, t.id);
    const allowed = loadoutService.canLearnTalent(p, t, node);
    if (!allowed[0]) return allowed;
    if ((p.talentPoints || 0) < t.cost)
      return [false, "Not enough talent points."];
    const rank = loadoutService.talentRank(p, t.id);
    p.talentPoints -= t.cost;
    const existing = p.talents.find((x: any) => x.id === t.id);
    if (existing) existing.rank++;
    else p.talents.push({ id: t.id, rank: 1 });
    rebuildTalents(p);
    return [
      true,
      `Talent learned: ${t.name} rank ${rank + 1}.`,
      { talentId: t.id, rank: rank + 1, keystone: !!node?.keystone },
    ];
  };
  handlers["unlearn_talent"] = async function (p: any, cmd: any) {
    if (p.dungeon)
      return [false, "You cannot change talents inside a dungeon."];
    if (p.encounterId || p.worldCombatMobId)
      return [false, "You cannot unlearn talents during combat."];
    const t = loadoutService.talentDefinition(p, cmd.talentId);
    if (!t) return [false, "Talent not found."];
    const existing = p.talents.find((x: any) => x.id === t.id);
    if (!existing || existing.rank <= 0)
      return [false, "Talent is not learned."];
    const descendants = (
      talentTrees?.builds?.[p.classId]?.[p.activeBuildId] || []
    ).filter(
      (n: any) =>
        (n.requires || []).includes(t.id) ||
        (n.requiresAny || []).includes(t.id),
    );
    if (
      existing.rank === 1 &&
      descendants.some((n: any) => loadoutService.talentRank(p, n.talentId) > 0)
    )
      return [false, "Unlearn dependent talents first."];
    existing.rank--;
    p.talentPoints = (p.talentPoints || 0) + t.cost;
    if (existing.rank === 0)
      p.talents = p.talents.filter((x: any) => x.id !== t.id);
    rebuildTalents(p);
    return [true, `Talent unlearned: ${t.name}.`];
  };
  handlers["trade_request"] = async function (p: any, cmd: any) {
    const target = repo.getPlayer(cmd.targetId);
    if (!target || !target.online || target.zone !== p.zone)
      return [false, "That player is not nearby."];
    if (target.id === p.id) return [false, "You cannot trade with yourself."];
    if (social.isIgnored?.(p, target.id) || social.isIgnored?.(target, p.id))
      return [
        false,
        "Trade request unavailable. One player has restricted contact with the other.",
      ];
    if (findTradeSession(p) || findTradeSession(target))
      return [false, "One of the players is already trading."];
    if (
      Math.hypot(target.x - p.x, target.y - p.y) >
      world.normalizedMeters(p.zone, 25)
    )
      return [false, "Move closer to trade."];
    tradeRequests.set(target.id, { from: p.id, at: Date.now() });
    return [true, `Trade request sent to ${target.name}.`];
  };
  handlers["trade_accept"] = async function (p: any, cmd: any) {
    {
      const req = tradeRequests.get(p.id);
      if (!req || req.from !== cmd.fromId)
        return [false, "Trade request not found."];
      const requester = repo.getPlayer(req.from);
      if (
        !requester ||
        social.isIgnored?.(p, requester.id) ||
        social.isIgnored?.(requester, p.id)
      ) {
        tradeRequests.delete(p.id);
        return [
          false,
          "Trade request unavailable. One player has restricted contact with the other.",
        ];
      }
      if (Date.now() - Number(req.at || 0) > 60000) {
        tradeRequests.delete(p.id);
        return [false, "Trade request expired."];
      }
      const other = repo.getPlayer(req.from);
      if (!tradeDistanceOk(p, other))
        return [false, "That player is no longer close enough."];
      if (findTradeSession(p) || findTradeSession(other))
        return [false, "One of the players is already trading."];
      const id = runtimeId("trade");
      tradeSessions.set(id, {
        id,
        a: other.id,
        b: p.id,
        offers: {
          [other.id]: { gold: 0, items: [] },
          [p.id]: { gold: 0, items: [] },
        },
        locked: { [other.id]: false, [p.id]: false },
        confirmed: { [other.id]: false, [p.id]: false },
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 120000,
      });
      tradeRequests.delete(p.id);
      return [true, "Trade opened."];
    }
  };
  handlers["trade_decline"] = async function (p: any, cmd: any) {
    tradeRequests.delete(p.id);
    return [true, "Trade declined."];
  };
  handlers["trade_offer"] = async function (p: any, cmd: any) {
    return tradeOffer(p, cmd);
  };
  handlers["trade_lock"] = async function (p: any, cmd: any) {
    {
      const t = findTradeSession(p);
      if (!t) return [false, "No active trade."];
      const other = repo.getPlayer(t.a === p.id ? t.b : t.a);
      if (!tradeDistanceOk(p, other)) {
        tradeSessions.delete(t.id);
        return [
          false,
          "Trade cancelled because the players are too far apart.",
        ];
      }
      t.locked[p.id] = true;
      t.confirmed[p.id] = false;
      return [true, "Your trade offer is locked."];
    }
  };
  handlers["trade_unlock"] = async function (p: any, cmd: any) {
    {
      const t = findTradeSession(p);
      if (!t) return [false, "No active trade."];
      t.locked[p.id] = false;
      t.confirmed[p.id] = false;
      t.confirmed[t.a === p.id ? t.b : t.a] = false;
      return [true, "Trade unlocked. Both confirmations were reset."];
    }
  };
  handlers["trade_confirm"] = async function (p: any, cmd: any) {
    {
      const t = findTradeSession(p);
      if (!t) return [false, "No active trade."];
      if (t.committing)
        return [false, "This trade is already being completed."];
      const otherId = t.a === p.id ? t.b : t.a;
      const other = repo.getPlayer(otherId);
      if (!tradeDistanceOk(p, other)) {
        tradeSessions.delete(t.id);
        return [false, "Trade cancelled because you are too far apart."];
      }
      if (!t.locked[p.id]) return [false, "Lock your trade offer first."];
      t.confirmed[p.id] = true;
      if (t.confirmed[otherId]) {
        const r = await completeTrade(t);
        if (r[0]) tradeSessions.delete(t.id);
        else {
          t.confirmed[p.id] = false;
          t.confirmed[otherId] = false;
        }
        return r;
      }
      return [true, "Trade confirmed. Waiting for the other player."];
    }
  };
  handlers["trade_cancel"] = async function (p: any, cmd: any) {
    const t = findTradeSession(p);
    if (t) tradeSessions.delete(t.id);
    return [true, "Trade cancelled."];
  };
  handlers["loot_roll"] = async function (p: any, cmd: any) {
    const rollId = String(cmd.rollId || ""),
      choice = String(cmd.choice || "pass");
    if (!["need", "greed", "pass"].includes(choice))
      return [false, "Invalid loot choice."];
    const ownRoll = (p.pendingLootRolls || []).find(
      (x: any) => x.id === rollId,
    );
    if (!ownRoll) return [false, "Loot roll not found."];
    const stableIds = Array.isArray(ownRoll.participantIds)
      ? ownRoll.participantIds.map(String)
      : null;
    const participantIds = stableIds?.length
      ? stableIds
      : p.partyId
        ? social.getParty(p.partyId)?.members || []
        : [p.id];
    const partyPlayers = participantIds
      .map((id: string) => repo.getPlayer(id))
      .filter(Boolean);
    const submit = () => {
      const idx = (p.pendingLootRolls || []).findIndex(
        (x: any) => x.id === rollId,
      );
      if (idx < 0) return [false, "Loot roll not found."];
      const my = p.pendingLootRolls[idx];
      if (Date.now() > my.expiresAt) return [false, "Loot roll expired."];
      my.choice = choice;
      return resolveLootRollForParty(rollId, partyPlayers, false);
    };
    const playerMutations = commandCtx.playerMutations;
    return playerMutations?.withPlayers
      ? playerMutations.withPlayers(
          partyPlayers.map((x: any) => x.id),
          submit,
        )
      : submit();
  };
  registerCharacterCommands(handlers, commandCtx);
  registerWorldCombatCommands(handlers, commandCtx);
  registerQuestStoryCommands(handlers, commandCtx);
  registerSocialCommands(handlers, commandCtx);
  registerEncounterCombatCommands(handlers, commandCtx);
  registerInventoryEconomyCommands(handlers, commandCtx);
  registerDungeonCommands(handlers, commandCtx);
  registerPvpCommands(handlers, commandCtx);
  const playerMutationCommands = [
    "equip",
    "unequip",
    "sell_shop",
    "buyback_shop",
    "select_profession",
    "drop_profession",
    "set_profession_specialization",
    "craft_blacksmith",
    "craft_recipe",
    "redeem_gear_token",
    "upgrade_gear",
    "reroll_gear",
    "use_item",
    "pickup_loot",
    "save_loadout",
    "delete_loadout",
    "apply_loadout",
    "set_specialization",
    "choose_build",
    "allocate_stat",
    "reset_stats",
    "reset_talents",
    "learn_talent",
    "unlearn_talent",
  ];
  const playerMutations = commandCtx.playerMutations;
  if (playerMutations?.withPlayer) {
    for (const commandName of playerMutationCommands) {
      const original = handlers[commandName];
      if (
        typeof original !== "function" ||
        (original as any).__playerMutationWrapped
      )
        continue;
      const wrapped = async (player: any, command: any) =>
        playerMutations.withPlayer(String(player.id), () =>
          original(player, command),
        );
      (wrapped as any).__playerMutationWrapped = true;
      handlers[commandName] = wrapped;
    }
  }
  return handlers;
}
