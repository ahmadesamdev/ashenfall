import { runtimeId } from "../shared/Ids.js";
import { shuffled } from "../shared/Random.js";
import {
  CHARACTER_PROGRESSION,
  progressionBand,
  levelMilestone,
  availableClassSkills,
  storyChapterForLevel,
} from "../progression/CharacterProgression.js";
import {
  itemizationRules,
  chooseLootCandidate,
} from "../items/ItemizationEngine.js";
export function createProgressionService(ctx: any) {
  const {
    inv,
    items,
    talents,
    repo,
    social,
    quest,
    world,
    worldEvents,
    openWorld,
    classes,
    xpToNextLevel,
    levelAdjustedXp,
    partyXpMultiplier,
    enemies,
    playerMutations,
  } = ctx;
  const ITEM_RULES = ctx.itemization || {};
  const IZR = itemizationRules(ITEM_RULES);
  const rewardClaimLocks = new Set();
  const gearPoolCache = new Map<string, any[]>();
  const GEAR_AFFIX_POOL = [
    { stat: "agility", label: "Agility", min: 1, max: 3, weight: 10 },
    { stat: "strength", label: "Strength", min: 1, max: 3, weight: 7 },
    { stat: "willpower", label: "Willpower", min: 1, max: 3, weight: 9 },
    { stat: "intellect", label: "Intellect", min: 1, max: 3, weight: 6 },
    { stat: "vitality", label: "Vitality", min: 1, max: 4, weight: 8 },
    { stat: "crit", label: "Critical", min: 1, max: 2, weight: 8 },
    { stat: "haste", label: "Haste", min: 1, max: 2, weight: 7 },
    { stat: "healing", label: "Healing", min: 1, max: 3, weight: 6 },
    { stat: "bleedDamage", label: "Bleed Damage", min: 2, max: 5, weight: 5 },
    {
      stat: "bleedDuration",
      label: "Bleed Duration",
      min: 2,
      max: 6,
      weight: 4,
    },
    { stat: "poisonDamage", label: "Poison Damage", min: 2, max: 5, weight: 4 },
    { stat: "stunDuration", label: "Stun Duration", min: 2, max: 6, weight: 3 },
    { stat: "stunResist", label: "Stun Resistance", min: 2, max: 6, weight: 3 },
    { stat: "hotDuration", label: "HoT Duration", min: 2, max: 6, weight: 4 },
    { stat: "damage", label: "Damage", min: 1, max: 4, weight: 5 },
    { stat: "maxHp", label: "Max Health", min: 8, max: 24, weight: 6 },
    { stat: "attack", label: "Attack", min: 1, max: 3, weight: 4 },
    { stat: "armor", label: "Armor", min: 1, max: 4, weight: 4 },
  ];
  const GEAR_RARITY_WEIGHTS: Record<string, Array<[string, number]>> = {
    normal: [
      ["uncommon", 62],
      ["rare", 33],
      ["epic", 5],
    ],
    elite: [
      ["rare", 52],
      ["epic", 40],
      ["legendary", 8],
    ],
    boss: [
      ["epic", 68],
      ["legendary", 32],
    ],
  };
  const LOOT_PITY = {
    normalLegendary: Number(IZR.loot?.pity?.normalLegendary || 50),
    eliteLegendary: Number(IZR.loot?.pity?.eliteLegendary || 12),
    bossLegendary: Number(IZR.loot?.pity?.bossLegendary || 3),
    bossEpic: Number(IZR.loot?.pity?.bossEpic || 1),
  };
  function ensureLootPity(player) {
    player.lootPity = player.lootPity || {
      normal: 0,
      elite: 0,
      boss: 0,
      bossEpic: 0,
    };
    return player.lootPity;
  }
  function pityRarity(player, source) {
    if (!player) return null;
    const pity = ensureLootPity(player);
    if (source === "boss" && Number(pity.boss || 0) >= LOOT_PITY.bossLegendary)
      return "legendary";
    if (source === "boss" && Number(pity.bossEpic || 0) >= LOOT_PITY.bossEpic)
      return "epic";
    if (
      source === "elite" &&
      Number(pity.elite || 0) >= LOOT_PITY.eliteLegendary
    )
      return "legendary";
    if (
      source === "normal" &&
      Number(pity.normal || 0) >= LOOT_PITY.normalLegendary
    )
      return "legendary";
    return null;
  }
  function recordLootRarity(player, source, rarity) {
    if (!player) return;
    const pity = ensureLootPity(player);
    if (source === "normal") {
      pity.normal = rarity === "legendary" ? 0 : Number(pity.normal || 0) + 1;
    }
    if (source === "elite") {
      pity.elite = rarity === "legendary" ? 0 : Number(pity.elite || 0) + 1;
    }
    if (source === "boss") {
      pity.boss = rarity === "legendary" ? 0 : Number(pity.boss || 0) + 1;
      pity.bossEpic = ["epic", "legendary"].includes(rarity)
        ? 0
        : Number(pity.bossEpic || 0) + 1;
    }
    player.lootPity = pity;
  }
  function weighted(list) {
    const total = list.reduce((n, x) => n + x[1], 0);
    let r = Math.random() * total;
    for (const [v, w] of list) {
      r -= w;
      if (r <= 0) return v;
    }
    return list[list.length - 1][0];
  }
  function affixSlotsFor(rarity, level) {
    const base =
      { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 }[rarity] || 0;
    return Math.max(
      0,
      Math.min(4, base + (level >= 10 && rarity === "legendary" ? 1 : 0)),
    );
  }
  function randomAffix(existing, level, rarity, classId, buildId = null) {
    const playerArg = classId && typeof classId === "object" ? classId : null;
    if (playerArg) {
      buildId = playerArg.activeBuildId;
      classId = playerArg.classId;
    }
    const buildPreferred = new Set(
      ctx?.combatGearSynergies?.builds?.[buildId]?.preferredStats || [],
    );
    const classPool =
      classId === "shadowblade"
        ? new Set([
            "agility",
            "crit",
            "haste",
            "bleedDamage",
            "bleedDuration",
            "poisonDamage",
            "stunDuration",
            "vitality",
            "damage",
            "maxHp",
            "attack",
            "armor",
          ])
        : classId === "warden" || classId === "hierophant"
          ? new Set([
              "willpower",
              "healing",
              "hotDuration",
              "stunResist",
              "haste",
              "vitality",
              "intellect",
              "maxHp",
              "damage",
              "attack",
              "armor",
            ])
          : new Set([
              "strength",
              "agility",
              "vitality",
              "haste",
              "crit",
              "armor",
              "damage",
              "maxHp",
              "attack",
              "willpower",
              "intellect",
            ]);
    let candidates = GEAR_AFFIX_POOL.filter(
      (a) => !existing.has(a.stat) && classPool.has(a.stat),
    );
    if (buildPreferred.size) {
      const preferred = candidates.filter((a) => buildPreferred.has(a.stat));
      if (preferred.length)
        candidates = [
          ...preferred.map((a) => ({ ...a, weight: a.weight * 3 })),
          ...candidates.filter((a) => !buildPreferred.has(a.stat)),
        ];
    }
    if (!candidates.length) return null;
    const total = candidates.reduce((n, a) => n + a.weight, 0);
    let r = Math.random() * total;
    let pick = candidates[0];
    for (const a of candidates) {
      r -= a.weight;
      if (r <= 0) {
        pick = a;
        break;
      }
    }
    const rarityMult = Number(IZR.rarity?.[rarity]?.multiplier || 1);
    const scale = Math.max(1, Math.floor(level / 4));
    const value = Math.max(
      pick.min,
      Math.min(
        Math.max(pick.max + scale, Math.ceil(pick.max * rarityMult + scale)),
        Math.round(
          (pick.min + (pick.max - pick.min) * Math.random() + scale * 0.5) *
            rarityMult,
        ),
      ),
    );
    return {
      name: `+${value} ${pick.label}`,
      stat: pick.stat,
      value,
      random: true,
      kind: "substat",
      rarity,
    };
  }
  function makeGearInstance(
    baseId,
    source = "normal",
    player = null,
    craftQuality = null,
    targetLevel = null,
  ) {
    const base = items[baseId];
    if (
      !base ||
      ![
        "weapon",
        "helmet",
        "chest",
        "boots",
        "neck",
        "ring",
        "relic",
        "shield",
        "shoulders",
        "gloves",
      ].includes(base.type)
    )
      return baseId;
    const baseLevel = Number(base.level || 1);
    const level = Math.max(
      1,
      Number(targetLevel || player?.level || baseLevel),
    );
    if (level <= baseLevel && baseLevel < 6 && !base.randomize) return baseId;
    const forcedRarity = pityRarity(player, source);
    const rolledRarity =
      forcedRarity ||
      weighted(
        source === "crafting"
          ? [
              ["uncommon", 25],
              ["rare", 55],
              ["epic", 18],
              ["legendary", 2],
            ]
          : GEAR_RARITY_WEIGHTS[
              source === "boss"
                ? "boss"
                : source === "elite"
                  ? "elite"
                  : "normal"
            ],
      );
    const rank = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    const sourceCap =
      source === "normal"
        ? "rare"
        : source === "elite"
          ? "legendary"
          : "legendary";
    const capRank = forcedRarity ? rank.legendary : rank[sourceCap];
    const baseRank = rank[base.rarity || "common"];
    const rolledRank = rank[rolledRarity];
    const rarityRank = Math.min(capRank, Math.max(rolledRank, baseRank));
    const rarity =
      Object.entries(rank).find(([, v]) => v === rarityRank)?.[0] || "common";
    const levelDelta = level - baseLevel;
    const affixScale = Math.max(0.55, Math.min(2.25, 1 + levelDelta * 0.045));
    const powerScale = Math.max(0.55, Math.min(3.5, 1 + levelDelta * 0.07));
    const armorScale = Math.max(0.55, Math.min(3.0, 1 + levelDelta * 0.055));
    const fixed = (base.affixes || []).map((a) => ({ ...a, fixed: true }));
    const existing = new Set(fixed.map((a) => a.stat));
    const rolls = [];
    const slots = Number(base.randomAffixSlots || affixSlotsFor(rarity, level));
    for (let i = 0; i < slots; i++) {
      const a = randomAffix(
        existing,
        level,
        rarity,
        player?.classId,
        player?.activeBuildId,
      );
      if (!a) break;
      rolls.push(a);
      existing.add(a.stat);
    }
    const prefixes = {
      uncommon: ["Duskwoven", "Wayfarer’s", "Gloamforged"],
      rare: ["Veiled", "Gravebound", "Moonlit"],
      epic: ["Bloodmoon", "Ashen", "Wraithmarked"],
      legendary: ["Hollow Saint’s", "Cinderveil", "Night Sovereign"],
    };
    const prefix = (prefixes[rarity] || ["Gloamforged"])[
      Math.floor(Math.random() * (prefixes[rarity] || ["Gloamforged"]).length)
    ];
    const id = `${baseId}__${runtimeId("gear").slice(5)}`;
    const qualityScale = IZR.quality || {
      poor: 0.88,
      standard: 1,
      fine: 1.06,
      superior: 1.12,
      masterwork: 1.18,
    };
    const qualityRoll =
      craftQuality ||
      base.quality ||
      (Math.random() < 0.06
        ? "masterwork"
        : Math.random() < 0.18
          ? "superior"
          : Math.random() < 0.35
            ? "fine"
            : "standard");
    const qs = Number(qualityScale[qualityRoll] || 1);
    const qualityPowerBonus =
      qualityRoll &&
      player?.professionSpecializations?.blacksmith === "weaponsmith" &&
      ["weapon", "shield"].includes(base.type)
        ? 1.04
        : 1;
    const qualityArmorBonus =
      qualityRoll &&
      player?.professionSpecializations?.blacksmith === "armorsmith" &&
      ["helmet", "chest", "shoulders", "gloves", "boots"].includes(base.type)
        ? 1.04
        : 1;
    const rarityRule = IZR.rarity?.[rarity] || {};
    const socketChance = Number(rarityRule.socketChance || 0);
    const socketCapacity =
      base.socketCapacity != null
        ? Number(base.socketCapacity)
        : Math.random() < socketChance
          ? rarity === "legendary" && Math.random() < 0.25
            ? 2
            : 1
          : 0;
    const preferredSockets = [
      ...(ctx?.combatGearSynergies?.builds?.[player?.activeBuildId]
        ?.preferredStats || []),
      "strength",
      "agility",
      "intellect",
      "vitality",
      "willpower",
      "crit",
      "haste",
      "healing",
    ];
    const socketColors = Array.from(
      { length: socketCapacity },
      (_, i) => preferredSockets[i % preferredSockets.length] || "versatility",
    );
    const tertiary = {};
    if (
      ["epic", "legendary"].includes(rarity) &&
      Math.random() < (rarity === "legendary" ? 0.55 : 0.22)
    ) {
      const pool = IZR.tertiaryStats || [];
      const pick = pool[Math.floor(Math.random() * pool.length)];
      if (pick)
        tertiary[pick.stat] = Math.max(
          Number(pick.min || 1),
          Math.min(
            Number(pick.max || 2),
            Math.round(
              Number(pick.min || 1) +
                (Number(pick.max || 2) - Number(pick.min || 1)) * Math.random(),
            ),
          ),
        );
    }
    const scaledFixed = fixed.map((a) =>
      a.value != null
        ? {
            ...a,
            value: Math.max(1, Math.round(Number(a.value) * affixScale)),
            name: `+${Math.max(1, Math.round(Number(a.value) * affixScale))} ${String(a.name || "").replace(/^\+\d+\s*/, "")}`,
          }
        : a,
    );
    const budgetBase =
      (Number(base.statBudget || 0) +
        Number(base.power || 0) * 0.25 +
        Number(base.armor || 0) * 0.15) *
      Math.max(0.65, 1 + levelDelta * 0.05);
    const budgetWeightsForBase = IZR.statBudgetWeights || {};
    const fixedCostAtLevel = scaledFixed.reduce(
      (n, a) =>
        n + Number(a.value || 0) * Number(budgetWeightsForBase[a.stat] ?? 1),
      0,
    );
    const tertiaryCostAtLevel = Object.entries(tertiary).reduce(
      (n, [stat, value]) =>
        n + Number(value || 0) * Number(budgetWeightsForBase[stat] ?? 1),
      0,
    );
    const budget =
      Math.round(
        Math.max(
          budgetBase * Number(rarityRule.multiplier || 1) * qs,
          (fixedCostAtLevel + tertiaryCostAtLevel) * 1.08,
        ) * 100,
      ) / 100;
    const instance = {
      ...base,
      id,
      name: `${prefix} ${base.name}`,
      level,
      itemLevel: level,
      rarity,
      baseItemId: baseId,
      generated: true,
      randomAffixSlots: slots,
      rerollCount: 0,
      craftQuality: qualityRoll,
      statBudget: budget,
      rollQuality: Math.round(qs * 1000) / 1000,
      socketCapacity,
      socketColors,
      gems: [],
      enchantId: null,
      tertiary,
      upgradeTrack: {
        baseItemLevel: level,
        maxIncrease: Number(base.upgrade?.maxLevel || baseLevel) - baseLevel,
        current: 0,
      },
      affixes: [...scaledFixed, ...rolls].map((a) => ({
        ...a,
        value: a.value
          ? Math.max(1, Math.round(Number(a.value) * qs))
          : a.value,
        name: a.value
          ? `+${Math.max(1, Math.round(Number(a.value) * qs))} ${String(a.name || "").replace(/^\+\d+\s*/, "")}`
          : a.name,
      })),
      power: base.power
        ? Math.max(
            1,
            Math.round(
              Number(base.power) * powerScale * qs * qualityPowerBonus,
            ),
          )
        : base.power,
      armor: base.armor
        ? Math.max(
            1,
            Math.round(
              Number(base.armor) * armorScale * qs * qualityArmorBonus,
            ),
          )
        : base.armor,
      description: `${base.description || ""} Item level ${level}. Randomized ${rarity} gear${tertiary && Object.keys(tertiary).length ? ` with tertiary ${Object.keys(tertiary).join(", ")}` : ""}${socketCapacity ? ` and ${socketCapacity} socket(s)` : ""}.`,
      price: Math.max(
        Number(base.price || 0),
        Math.round(
          Number(base.price || 20) *
            ({ uncommon: 1.1, rare: 1.5, epic: 2.2, legendary: 4 }[rarity] ||
              1) *
            Math.max(0.7, 1 + levelDelta * 0.025),
        ),
      ),
    };
    const budgetWeightsFinal = IZR.statBudgetWeights || {};
    const tertiaryCost = Object.entries(instance.tertiary || {}).reduce(
      (n, [stat, value]) =>
        n + Number(value || 0) * Number(budgetWeightsFinal[stat] ?? 1),
      0,
    );
    const fixedAffixCost =
      (instance.affixes || [])
        .filter((a) => a.fixed)
        .reduce(
          (n, a) =>
            n + Number(a.value || 0) * Number(budgetWeightsFinal[a.stat] ?? 1),
          0,
        ) + tertiaryCost;
    const randomAffixCost = (instance.affixes || [])
      .filter((a) => !a.fixed)
      .reduce(
        (n, a) =>
          n + Number(a.value || 0) * Number(budgetWeightsFinal[a.stat] ?? 1),
        0,
      );
    const allowed = Number(budget) * 1.15;
    if (
      fixedAffixCost + randomAffixCost > allowed &&
      (instance.affixes || []).length
    ) {
      const available = Math.max(0, allowed - fixedAffixCost);
      const scale = randomAffixCost > 0 ? available / randomAffixCost : 0;
      instance.affixes = instance.affixes.map((a) => {
        if (a.fixed || !a.value) return a;
        const value = Math.max(1, Math.floor(Number(a.value) * scale));
        return {
          ...a,
          value,
          name: `+${value} ${String(a.name || "").replace(/^\+\d+\s*/, "")}`,
        };
      });
    }
    const budgetCostNow = () =>
      (instance.affixes || []).reduce(
        (n, a) =>
          n + Number(a.value || 0) * Number(budgetWeightsFinal[a.stat] ?? 1),
        0,
      ) + tertiaryCost;
    while (budgetCostNow() > allowed) {
      const candidate = (instance.affixes || [])
        .filter((a) => !a.fixed && Number(a.value || 0) > 1)
        .sort((a, b) => Number(b.value) - Number(a.value))[0];
      if (!candidate) break;
      candidate.value = Math.max(1, Number(candidate.value) - 1);
      candidate.name = `+${candidate.value} ${String(candidate.name || "").replace(/^\+\d+\s*/, "")}`;
    }
    items[id] = instance;
    if (player) {
      player.generatedItems = player.generatedItems || {};
      player.generatedItems[id] = instance;
      recordLootRarity(player, source, rarity);
    }
    return id;
  }
  function progressionFamilyForLevel(level) {
    const n = Number(level || 1);
    if (n <= 15) return "leveling";
    if (n <= 25) return "veteran";
    if (n <= 35) return "heroic";
    if (n <= 50) return "mythic";
    return "apex";
  }
  function gearPoolFor(p, level, source = "normal", bossId = null) {
    const classId = p.classId;
    const buildId = p.activeBuildId || "";
    const targetLevel = Math.max(1, Math.floor(Number(level) || 1));
    const key = `${classId}|${buildId}|${targetLevel}|${source}|${bossId || ""}`;
    let cached: any = gearPoolCache.get(key);
    if (!cached) {
      const family = progressionFamilyForLevel(targetLevel);
      const bossRule = bossId ? IZR.lootTables?.bosses?.[bossId] : null;
      const sourceFamilies =
        source === "boss"
          ? ["raid", family]
          : source === "elite"
            ? ["dungeon", family]
            : [family];
      const candidates = (Object.values(items) as any[]).filter(
        (it: any) =>
          it &&
          !it.generated &&
          it.level &&
          it.type !== "consumable" &&
          it.type !== "material",
      );
      const classPool = candidates.filter(
        (it: any) => !it.class?.length || it.class.includes(classId),
      );
      const buildPool = classPool.filter(
        (it: any) => buildId && it.buildIds?.includes(buildId),
      );
      const familyPool = buildPool.filter((it: any) =>
        sourceFamilies.some((tag) => it.tags?.includes(tag)),
      );
      const classFamily = classPool.filter((it: any) =>
        sourceFamilies.some((tag) => it.tags?.includes(tag)),
      );
      const fallbackBuild: any[] = buildPool.length ? buildPool : classPool;
      const nearest = (pool: any[]) => {
        if (!pool.length) return [];
        const min = Math.min(
          ...pool.map((it) => Math.abs(Number(it.level) - targetLevel)),
        );
        const nearestPool = pool.filter(
          (it) => Math.abs(Number(it.level) - targetLevel) === min,
        );
        const notOver = nearestPool.filter(
          (it) => Number(it.level) <= targetLevel,
        );
        return notOver.length ? notOver : nearestPool;
      };
      let selected = nearest(
        familyPool.length
          ? familyPool
          : classFamily.length
            ? classFamily
            : fallbackBuild,
      );
      if (bossRule?.uniqueDrops?.length) {
        for (const id of bossRule.uniqueDrops) {
          const u = items[id];
          if (u && !u.generated) selected.push(u);
        }
      }
      cached = { selected, familyPool, classFamily, buildPool, classPool };
      gearPoolCache.set(key, cached);
    }
    const targetChance = Number(IZR.loot?.buildTargetChance || 0.82);
    if (cached.selected.length && buildId && Math.random() < targetChance) {
      const buildOnly = cached.selected.filter((it) =>
        it.buildIds?.includes(buildId),
      );
      if (buildOnly.length) return buildOnly;
    }
    return cached.selected.length
      ? cached.selected
      : cached.buildPool.length
        ? cached.buildPool
        : cached.classPool;
  }
  function addGearDropToPile(p, pile, level, source = "normal", bossId = null) {
    if (!pile) return null;
    const pool = gearPoolFor(p, level, source, bossId);
    if (!pool.length) return null;
    const base: any =
      chooseLootCandidate(
        pool,
        p,
        ITEM_RULES,
        ctx.combatGearSynergies,
        p?.lootHistory || [],
      ) || pool[Math.floor(Math.random() * pool.length)];
    const id = makeGearInstance(base.id, source, p, null, level);
    pile.items = pile.items || [];
    pile.items.push({ itemId: id, qty: 1 });
    p.lootHistory = Array.isArray(p.lootHistory) ? p.lootHistory : [];
    p.lootHistory.push({
      baseItemId: base.id,
      setId: base.setId || null,
      at: Date.now(),
      source,
    });
    p.lootHistory = p.lootHistory.slice(-24);
    const token =
      source === "boss"
        ? "apex_tier_token"
        : source === "elite"
          ? "dungeon_tier_token"
          : null;
    if (
      token &&
      Math.random() < Number(IZR.lootTables?.tierTokenChance?.[source] || 0.75)
    )
      pile.items.push({ itemId: token, qty: 1 });
    return id;
  }
  function gearChance(source) {
    return source === "boss" ? 1 : source === "elite" ? 0.25 : 0.07;
  }
  function prismChance(source) {
    return source === "boss" ? 0.22 : source === "elite" ? 0.02 : 0.003;
  }
  function mailOverflow(
    p: any,
    itemId: string,
    qty: number,
    reason = "Your bag was full",
  ) {
    const economy = ctx.economy;
    if (!economy?.pushMail || !p?.id || !itemId || !items[itemId]) return false;
    try {
      const name = items[itemId]?.name || itemId;
      economy.pushMail(
        String(p.id),
        "Loot waiting for you",
        `${reason}, so ${qty}x ${name} was sent to your mailbox.`,
        { items: [{ itemId, qty }], systemMail: true },
      );
      Promise.resolve(economy.persist?.([p])).catch((error: any) =>
        console.warn(
          "[loot] overflow mail persistence failed:",
          error?.message || error,
        ),
      );
      social?.notify?.(
        String(p.id),
        "loot_overflow",
        `Bag full: ${qty}x ${name} was mailed to you.`,
        { itemId, qty },
      );
      return true;
    } catch (error: any) {
      console.warn("[loot] overflow mail failed:", error?.message || error);
      return false;
    }
  }
  function reward(p, xp = 0, gold = 0, loot = []) {
    const amountXp = Math.max(0, Number(xp) || 0),
      amountGold = Math.max(0, Number(gold) || 0);
    if (amountXp) gainXp(p, amountXp);
    if (amountGold) p.gold = (Number(p.gold) || 0) + amountGold;
    for (const drop of Array.isArray(loot) ? loot : []) {
      const itemId =
        typeof drop === "string"
          ? drop
          : drop?.itemId || drop?.id || drop?.item;
      const qty = Math.max(
        1,
        Math.floor(Number(typeof drop === "object" ? drop?.qty : 1) || 1),
      );
      if (!itemId) continue;
      if (!inv.canGive(p, itemId, qty)) {
        mailOverflow(p, itemId, qty);
        continue;
      }
      inv.give(p, itemId, qty);
    }
    inv.recalc(p);
    return {
      xp: amountXp,
      gold: amountGold,
      loot: Array.isArray(loot) ? loot : [],
    };
  }
  function lootRarityRank(def: any) {
    return (
      {
        poor: 0,
        common: 1,
        uncommon: 2,
        rare: 3,
        epic: 4,
        legendary: 5,
        mythic: 6,
      }[String(def?.rarity || "common").toLowerCase()] ?? 1
    );
  }
  function lootBaseDefinition(itemId: string) {
    const def = items[itemId];
    if (!def) return null;
    return def.generated && def.baseItemId && items[def.baseItemId]
      ? items[def.baseItemId]
      : def;
  }
  function canNeedLoot(player: any, itemId: string) {
    const def = lootBaseDefinition(itemId);
    if (!def || def.soulbound || def.tradeable === false) return false;
    const equipmentTypes = new Set([
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
      "trinket",
      "cloak",
    ]);
    if (
      !equipmentTypes.has(String(def.type || "")) ||
      Number(player?.level || 1) < Number(def.level || 1)
    )
      return false;
    if (
      Array.isArray(def.class) &&
      def.class.length &&
      !def.class.includes(player?.classId)
    )
      return false;
    return true;
  }
  function shouldGroupRoll(itemId: string) {
    const def = items[itemId];
    if (!def) return false;
    const equipmentTypes = new Set([
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
      "trinket",
      "cloak",
    ]);
    return (
      lootRarityRank(def) >= 2 && equipmentTypes.has(String(def.type || ""))
    );
  }
  function distributePartyDrops(
    members: any[],
    drops: any[],
    source: string,
    enemyName: string,
  ) {
    if (members.length === 1) {
      for (const d of drops) {
        let itemId = d.itemId;
        if (d.generateGear)
          itemId = makeGearInstance(
            d.baseItemId || d.itemId,
            source,
            members[0],
            null,
            Number(d.level || members[0]?.level || 1),
          );
        if (inv.canGive(members[0], itemId, d.qty))
          inv.give(members[0], itemId, d.qty);
        else mailOverflow(members[0], itemId, Number(d.qty) || 1);
      }
      inv.recalc(members[0]);
      return;
    }
    const party = social.getParty(members[0]?.partyId);
    if (party)
      party.lootCursor = Number.isInteger(party.lootCursor)
        ? party.lootCursor
        : 0;
    for (const drop of drops) {
      let previewId = drop.itemId;
      if (drop.generateGear)
        previewId = makeGearInstance(
          drop.baseItemId || drop.itemId,
          source,
          members[0],
          null,
          Number(drop.level || members[0]?.level || 1),
        );
      if (shouldGroupRoll(previewId)) {
        const rollId = runtimeId("roll");
        const participantIds = members.map((m: any) => String(m.id));
        for (const m of members) {
          m.pendingLootRolls = m.pendingLootRolls || [];
          m.pendingLootRolls.push({
            id: rollId,
            participantIds: [...participantIds],
            itemId: previewId,
            baseItemId: drop.baseItemId || null,
            generateGear: !!drop.generateGear,
            lootLevel: Number(drop.level || m.level || 1),
            lootSource: source,
            qty: drop.qty || 1,
            source: enemyName || source,
            expiresAt: Date.now() + 15000,
            choice: null,
            canNeed: canNeedLoot(m, previewId),
          });
        }
        continue;
      }
      let awarded = false;
      for (let i = 0; i < members.length; i++) {
        const idx = ((party?.lootCursor || 0) + i) % members.length;
        const m = members[idx];
        const itemId = drop.generateGear
          ? makeGearInstance(
              drop.baseItemId || drop.itemId,
              source,
              m,
              null,
              Number(drop.level || m.level || 1),
            )
          : drop.itemId;
        if (inv.canGive(m, itemId, drop.qty)) {
          inv.give(m, itemId, drop.qty);
          inv.recalc(m);
          if (party) party.lootCursor = (idx + 1) % members.length;
          awarded = true;
          break;
        }
      }
      if (!awarded) {
        const rollId = runtimeId("roll");
        const participantIds = members.map((m: any) => String(m.id));
        for (const m of members) {
          m.pendingLootRolls = m.pendingLootRolls || [];
          m.pendingLootRolls.push({
            id: rollId,
            participantIds: [...participantIds],
            itemId: previewId,
            baseItemId: drop.baseItemId || null,
            generateGear: !!drop.generateGear,
            lootLevel: Number(drop.level || m.level || 1),
            lootSource: source,
            qty: drop.qty || 1,
            source: enemyName || source,
            expiresAt: Date.now() + 15000,
            choice: null,
            canNeed: false,
            autoGreed: true,
          });
        }
      }
    }
  }
  function resolveLootRollForParty(rollId, partyPlayers, force = false) {
    const seed = (partyPlayers || [])
      .map((m: any) =>
        (m.pendingLootRolls || []).find((x: any) => x.id === rollId),
      )
      .find(Boolean);
    const participantIds = Array.isArray(seed?.participantIds)
      ? seed.participantIds.map(String)
      : [];
    const participants = participantIds.length
      ? participantIds.map((id: string) => repo.getPlayer(id)).filter(Boolean)
      : partyPlayers;
    const allChoices = [];
    for (const m of participants) {
      const r = (m.pendingLootRolls || []).find((x) => x.id === rollId);
      if (r) allChoices.push({ m, r });
    }
    if (!allChoices.length) return [false, "Loot roll no longer exists."];
    const expired = force || allChoices.some((x) => Date.now() > x.r.expiresAt);
    if (!expired && !allChoices.every((x) => x.r.choice))
      return [false, "Waiting for the party."];
    for (const x of allChoices) {
      if (x.r.choice === "need" && !canNeedLoot(x.m, x.r.itemId))
        x.r.choice = "greed";
    }
    const eligible = allChoices.filter(
      (x) => x.r.choice && x.r.choice !== "pass",
    );
    if (!eligible.length) {
      for (const x of allChoices)
        x.m.pendingLootRolls = x.m.pendingLootRolls.filter(
          (r) => r.id !== rollId,
        );
      return [true, "Everyone passed on the item."];
    }
    const needs = eligible.filter((x) => x.r.choice === "need");
    const pool = needs.length ? needs : eligible;
    const rollOrder = shuffled([...pool]);
    const winner =
      rollOrder.find((x) => {
        const candidate = x.r.generateGear
          ? makeGearInstance(
              x.r.baseItemId || x.r.itemId,
              x.r.lootSource || "normal",
              x.m,
              null,
              Number(x.r.lootLevel || x.m.level || 1),
            )
          : x.r.itemId;
        return inv.canGive(x.m, candidate, x.r.qty);
      }) || null;
    if (!winner) {
      if (!force)
        return [
          false,
          "Every eligible player needs a free bag slot before this roll can be awarded.",
        ];
      const fallback = rollOrder[0];
      if (fallback) {
        const mailedId = fallback.r.generateGear
          ? makeGearInstance(
              fallback.r.baseItemId || fallback.r.itemId,
              fallback.r.lootSource || "normal",
              fallback.m,
              null,
              Number(fallback.r.lootLevel || fallback.m.level || 1),
            )
          : fallback.r.itemId;
        if (
          mailOverflow(
            fallback.m,
            mailedId,
            Number(fallback.r.qty) || 1,
            "Nobody in the group had bag space",
          )
        ) {
          for (const x of allChoices)
            x.m.pendingLootRolls = x.m.pendingLootRolls.filter(
              (r) => r.id !== rollId,
            );
          if (fallback.r.generateGear && fallback.r.itemId !== mailedId)
            delete items[fallback.r.itemId];
          return [
            true,
            `${items[mailedId]?.name || mailedId} was mailed to ${fallback.m.name}.`,
            { lootWinner: fallback.m.id, itemId: mailedId, mailed: true },
          ];
        }
      }
      return [
        false,
        "Every eligible player needs a free bag slot before this roll can be awarded.",
      ];
    }
    const finalItemId = winner.r.generateGear
      ? makeGearInstance(
          winner.r.baseItemId || winner.r.itemId,
          winner.r.lootSource || "normal",
          winner.m,
          null,
          Number(winner.r.lootLevel || winner.m.level || 1),
        )
      : winner.r.itemId;
    if (!inv.give(winner.m, finalItemId, winner.r.qty))
      return [false, "The winning player no longer has enough bag space."];
    inv.recalc(winner.m);
    for (const x of allChoices)
      x.m.pendingLootRolls = x.m.pendingLootRolls.filter(
        (r) => r.id !== rollId,
      );
    if (winner.r.generateGear && winner.r.itemId !== finalItemId)
      delete items[winner.r.itemId];
    return [
      true,
      `${items[finalItemId]?.name || finalItemId} awarded to ${winner.m.name}.`,
      { lootWinner: winner.m.id, itemId: finalItemId },
    ];
  }
  const resolvingExpiredRolls = new Set<string>();
  function resolveExpiredLootRolls(now) {
    const seen = new Set();
    for (const player of repo.allPlayers()) {
      for (const r of player.pendingLootRolls || []) {
        if (now <= r.expiresAt || seen.has(r.id)) continue;
        seen.add(r.id);
        const participantIds = Array.isArray(r.participantIds)
          ? r.participantIds.map(String)
          : null;
        const party = participantIds?.length
          ? participantIds
          : player.partyId
            ? social.getParty(player.partyId)?.members || []
            : [player.id];
        const members = party.map((id) => repo.getPlayer(id)).filter(Boolean);
        if (resolvingExpiredRolls.has(String(r.id))) continue;
        resolvingExpiredRolls.add(String(r.id));
        const resolve = () => resolveLootRollForParty(r.id, members, true);
        const work = playerMutations?.withPlayers
          ? playerMutations.withPlayers(
              members.map((m: any) => m.id),
              resolve,
            )
          : Promise.resolve().then(resolve);
        void Promise.resolve(work)
          .catch((error: any) => {
            console.warn(
              "Expired loot roll resolution failed:",
              error?.message || error,
            );
          })
          .finally(() => resolvingExpiredRolls.delete(String(r.id)));
      }
    }
  }
  function normalizeXpTrack(p) {
    p.level = Math.max(
      1,
      Math.min(
        CHARACTER_PROGRESSION.maxLevel,
        Math.floor(Number(p.level) || 1),
      ),
    );
    const expected = xpToNextLevel(p.level);
    if (
      !Number.isFinite(Number(p.xpNext)) ||
      (expected > 0 && Math.abs(Number(p.xpNext) - expected) > expected * 0.05)
    )
      p.xpNext = expected;
    if (!Number.isFinite(Number(p.xp))) p.xp = 0;
    if (!Number.isFinite(Number(p.totalXp))) p.totalXp = 0;
    p.progressionBand = progressionBand(p.level)?.id || "initiate";
    if (!Array.isArray(p.milestoneHistory)) p.milestoneHistory = [];
    if (!p.storyFlags || typeof p.storyFlags !== "object") p.storyFlags = {};
    if (!Array.isArray(p.storyChapterHistory)) p.storyChapterHistory = [];
    if (p.level >= CHARACTER_PROGRESSION.maxLevel) {
      p.xp = 0;
      p.xpNext = 0;
    }
  }
  function applyLevelMilestone(p, level) {
    const milestone = levelMilestone(level);
    p.statPoints = (p.statPoints || 0) + Number(milestone.statPoints || 0);
    p.talentPoints =
      (p.talentPoints || 0) + Number(milestone.talentPoints || 0);
    p.milestoneHistory = p.milestoneHistory || [];
    if (!p.milestoneHistory.includes(level)) p.milestoneHistory.push(level);
    p.progressionBand = progressionBand(level)?.id || p.progressionBand;
    const recommendedChapter = storyChapterForLevel(level);
    p.lastLevelMilestone = {
      level,
      band: p.progressionBand,
      recommendedStoryChapter: recommendedChapter,
      unlocks: milestone.unlocks || [],
      at: Date.now(),
    };
  }
  function gainXp(p, n) {
    const before = p.level;
    normalizeXpTrack(p);
    const amount = Math.max(0, Number(n || 0));
    if (p.guildId && social?.awardGuildXp) {
      const guildAmount = Math.max(1, Math.floor(amount * 0.02));
      social.awardGuildXp(p, guildAmount, "character_xp");
    }
    p.totalXp = (Number(p.totalXp) || 0) + amount;
    if (p.level >= CHARACTER_PROGRESSION.maxLevel) {
      p.xp = 0;
      p.xpNext = 0;
      return;
    }
    p.xp = Math.max(0, Number(p.xp || 0)) + amount;
    const levels = [];
    while (p.level < CHARACTER_PROGRESSION.maxLevel && p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      levels.push(p.level);
      applyLevelMilestone(p, p.level);
      p.xpNext = xpToNextLevel(p.level);
    }
    p.xpNext = xpToNextLevel(p.level);
    if (p.level >= CHARACTER_PROGRESSION.maxLevel) {
      p.xp = 0;
      p.xpNext = 0;
    }
    if (p.level > before) {
      const cls = ctx.classes?.[p.classId];
      const available = availableClassSkills(cls, p.level);
      p.availableSkills = available;
      p.lastLevelUp = {
        from: before,
        level: p.level,
        levels,
        availableSkills: available,
        at: Date.now(),
      };
    }
    inv.recalc(p);
    p.resolve = p.maxResolve;
  }
  function rebuildTalents(p) {
    const tb = {
      attack: 0,
      maxHp: 0,
      armor: 0,
      maxResolve: 0,
      haste: 0,
      crit: 0,
      damage: 0,
      healing: 0,
      bleedDamage: 0,
      bleedDuration: 0,
      poisonDamage: 0,
      poisonDuration: 0,
      stunDuration: 0,
      stunResist: 0,
      hotDuration: 0,
      buffDuration: 0,
      resolveRegen: 0,
      controlDuration: 0,
      threat: 0,
      rangeDamage: 0,
      aoeDamage: 0,
      dotDamage: 0,
      hotPower: 0,
    };
    for (const owned of p.talents || []) {
      const tree = talents[p.classId] || [];
      const t = tree.find((x) => x.id === owned.id);
      if (!t) continue;
      const e = t.effect || {};
      for (const key of Object.keys(tb))
        if (e[key]) tb[key] += e[key] * owned.rank;
    }
    p.talentBonuses = tb;
    inv.recalc(p);
  }
  function applyTalent(p, t) {
    rebuildTalents(p);
  }

  function dungeonChestId(instanceId, playerId) {
    return `dchest_${String(instanceId || "unknown")}_${String(playerId || "unknown")}`;
  }
  function createDungeonRewardChest(member, rewardData, meta: any = {}) {
    const data = rewardData || {};
    const id = dungeonChestId(meta.instanceId, member?.id);
    member.dungeonRewardChests = Array.isArray(member.dungeonRewardChests)
      ? member.dungeonRewardChests
      : [];
    const existing = member.dungeonRewardChests.find((x) => x.id === id);
    if (existing) return existing;
    const itemId = data.item || data.itemId || null;
    const now = Date.now();
    const chest = {
      id: dungeonChestId(meta.instanceId, member?.id),
      instanceId: meta.instanceId || null,
      dungeonId: meta.dungeonId || null,
      dungeonName: meta.dungeonName || null,
      createdAt: now,
      claimedAt: null,
      rewards: {
        xp: Math.max(0, Number(data.xp) || 0),
        gold: Math.max(0, Number(data.gold) || 0),
        items: [],
      },
      source: "dungeon_final_boss",
    };
    const lootLevel = Math.max(
      1,
      Number(meta.lootLevel || data.lootLevel || member?.level || 1),
    );
    const gearRolls = Math.max(
      0,
      Math.min(4, Number(meta.gearRolls || data.gearRolls || 0)),
    );
    for (let i = 0; i < gearRolls; i++) {
      const pool = gearPoolFor(member, lootLevel, "boss", meta.bossId || null);
      const generatedPool = pool.filter(
        (it) => Number(it.level || it.itemLevel || 0) >= 6,
      );
      if (pool.length) {
        const candidatePool = generatedPool.length ? generatedPool : pool;
        const base =
          chooseLootCandidate(
            candidatePool,
            member,
            ITEM_RULES,
            ctx.combatGearSynergies,
            member?.lootHistory || [],
          ) || pool[Math.floor(Math.random() * pool.length)];
        const generatedId = makeGearInstance(
          base.id,
          "boss",
          member,
          null,
          lootLevel,
        );
        const generated = member.generatedItems?.[generatedId];
        if (generated) {
          generated.itemLevel = lootLevel;
          generated.level = lootLevel;
          generated.upgradeTrack = {
            ...(generated.upgradeTrack || {}),
            baseItemLevel: lootLevel,
            current: 0,
          };
          generated.description = `${generated.description || ""} Dungeon reward item level ${lootLevel}.`;
        }
        chest.rewards.items.push({
          itemId: generatedId,
          qty: 1,
          source: "dungeonGear",
          lootLevel,
        });
        member.lootHistory = Array.isArray(member.lootHistory)
          ? member.lootHistory
          : [];
        member.lootHistory.push({
          baseItemId: base.id,
          setId: base.setId || null,
          at: Date.now(),
          source: "dungeon",
        });
        member.lootHistory = member.lootHistory.slice(-24);
      }
    }
    if (itemId && !gearRolls) {
      let finalItemId = itemId;
      const base = items[itemId];
      if (base?.randomize || Number(base?.level || 0) >= 6)
        finalItemId = makeGearInstance(
          itemId,
          "boss",
          member,
          null,
          Number(meta.lootLevel || member?.level || 1),
        );
      chest.rewards.items.push({ itemId: finalItemId, qty: 1 });
    }
    member.dungeonRewardChests.push(chest);
    return chest;
  }
  function createDungeonCompletionRewards(members, rewardData, meta = {}) {
    const chests = [];
    for (const member of members || [])
      if (member)
        chests.push(createDungeonRewardChest(member, rewardData, meta));
    return chests;
  }
  async function claimDungeonRewardChest(member, chestId) {
    if (!member) return [false, "Player not found."];
    const id = String(chestId || "");
    const lockKey = `${String(member.id)}:${id}`;
    if (rewardClaimLocks.has(lockKey))
      return [false, "This reward chest is already being claimed."];
    const chest = (member.dungeonRewardChests || []).find((x) => x.id === id);
    if (!chest) return [false, "Dungeon reward chest not found."];
    if (chest.claimedAt)
      return [false, "This reward chest has already been claimed."];
    rewardClaimLocks.add(lockKey);
    const claim = async () => {
      const currentChest = (member.dungeonRewardChests || []).find(
        (x) => x.id === id,
      );
      if (!currentChest) return [false, "Dungeon reward chest not found."];
      if (currentChest.claimedAt)
        return [false, "This reward chest has already been claimed."];
      const itemsToGive = (currentChest.rewards?.items || []).filter(
        (x) => x && x.itemId && Number(x.qty || 0) > 0,
      );
      if (!inv.canGiveMany(member, itemsToGive))
        return [
          false,
          "Your bag is full. Free enough space before opening the reward chest.",
        ];
      const before = JSON.parse(JSON.stringify(member));
      const rewardKey = `dungeon-chest:${String(member.id)}:${String(currentChest.id)}:claim`;
      try {
        const xp = Math.max(0, Number(currentChest.rewards?.xp) || 0),
          gold = Math.max(0, Number(currentChest.rewards?.gold) || 0);
        if (xp) gainXp(member, xp);
        if (gold) member.gold = (Number(member.gold) || 0) + gold;
        for (const drop of itemsToGive) {
          if (!inv.give(member, drop.itemId, drop.qty))
            throw new Error("Reward item could not be placed in inventory.");
        }
        currentChest.claimedAt = Date.now();
        member.lastDungeonReward = {
          chestId: currentChest.id,
          xp,
          gold,
          items: itemsToGive,
          at: currentChest.claimedAt,
        };
        inv.recalc(member);
        const committed = await repo.savePlayerRewardOnce(member, rewardKey);
        if (!committed) {
          for (const key of Object.keys(member)) delete member[key];
          Object.assign(member, before);
          const staleChest = (member.dungeonRewardChests || []).find(
            (x) => x.id === id,
          );
          if (staleChest) staleChest.claimedAt = Date.now();
          return [
            false,
            "This reward chest has already been claimed. Reconnect to refresh your saved character state.",
          ];
        }
        return [
          true,
          "Dungeon reward chest opened.",
          {
            chestId: currentChest.id,
            reward: { xp, gold, items: itemsToGive },
          },
        ];
      } catch (error) {
        for (const key of Object.keys(member)) delete member[key];
        Object.assign(member, before);
        return [
          false,
          "The reward could not be claimed. Nothing was consumed. Please try again.",
        ];
      }
    };
    try {
      return playerMutations?.withPlayer
        ? await playerMutations.withPlayer(String(member.id), claim)
        : await claim();
    } finally {
      rewardClaimLocks.delete(lockKey);
    }
  }
  function awardEncounterLoot(participants, loot, source, level, enemyName) {
    const members = (participants || [])
      .map((id) => repo.getPlayer(String(id)))
      .filter((m: any) => m && m.online && !m.dead);
    if (!members.length || !Array.isArray(loot) || !loot.length) return;
    const drops = loot
      .map((drop: any) => {
        const itemId =
          typeof drop === "string"
            ? drop
            : drop?.itemId || drop?.id || drop?.item;
        const qty = Math.max(
          1,
          Math.floor(Number(typeof drop === "object" ? drop?.qty : 1) || 1),
        );
        const base = items[itemId];
        return itemId &&
          base &&
          (base.randomize || Number(base.level || 0) >= 6)
          ? {
              itemId,
              baseItemId: itemId,
              generateGear: true,
              level: Number(level || members[0]?.level || 1),
              qty,
            }
          : { itemId, qty };
      })
      .filter((x) => x.itemId);
    distributePartyDrops(members, drops, source, enemyName || "Encounter");
  }
  function rewardMobKill(p, info: any = {}) {
    if (info.rewardClaimedAt)
      return { xp: 0, gold: 0, lootPile: null, partySize: 0, duplicate: true };
    const xp = Math.max(0, Number(info.xp || 0)),
      gold = Math.max(0, Number(info.gold || 0));
    const source =
      info.source ||
      (info.enemyId && enemies[info.enemyId]?.ai === "boss"
        ? "boss"
        : info.enemyId && enemies[info.enemyId]?.ai === "elite"
          ? "elite"
          : "normal");
    const participantIds = [
      ...new Set(
        (info.participants || info.lootPile?.eligible || []).map(String),
      ),
    ];
    const party = social.getParty(p.partyId);
    const killX = Number(info.x ?? p.x),
      killY = Number(info.y ?? p.y),
      zone = p.zone;
    let eligible: any[] = [];
    if (party) {
      eligible = party.members
        .map((id) => repo.getPlayer(id))
        .filter(
          (m: any) =>
            m &&
            m.online &&
            !m.dead &&
            m.zone === zone &&
            Math.hypot(m.x - killX, m.y - killY) <=
              world.normalizedMeters(zone, 180),
        );
      for (const id of participantIds) {
        const m = repo.getPlayer(id);
        if (
          m &&
          m.online &&
          !m.dead &&
          m.zone === zone &&
          !eligible.some((x) => x.id === m.id)
        )
          eligible.push(m);
      }
    } else {
      eligible = participantIds
        .map((id) => repo.getPlayer(id))
        .filter((m: any) => m && m.online && !m.dead && m.zone === zone);
      if (!eligible.some((x) => x.id === p.id) && !p.dead) eligible.push(p);
    }
    if (!eligible.length)
      return { xp: 0, gold: 0, lootPile: null, partySize: 0 };
    eligible = eligible.filter(
      (m: any, i: number, a: any[]) => a.findIndex((x) => x.id === m.id) === i,
    );
    quest?.onKill?.(p, String(info.enemyId || ""));
    worldEvents.onKill(p, {
      enemyId: info.enemyId,
      participants: eligible.map((m: any) => m.id),
    });
    if (openWorld) {
      openWorld.onKill(p, { enemyId: info.enemyId });
      const rareDef = (world.mobDefs || []).find(
        (d: any) => d.type === String(info.enemyId || "") && d.rare === true,
      );
      if (rareDef && !p.dungeon) {
        const rareEventId = info.mobId || info.lootPile?.id;
        if (rareEventId)
          void openWorld
            .onRareKill(p, rareDef, rareEventId)
            .catch((error: any) =>
              console.warn(
                "[open-world] rare-hunt reward commit failed; pending reward is queued for retry:",
                String(error?.message || error),
              ),
            );
      }
    }
    const partyMult = partyXpMultiplier(eligible.length);
    const goldBase = Math.floor(gold / eligible.length),
      goldRemainder = gold - goldBase * eligible.length;
    eligible.forEach((m: any, index: number) => {
      const memberBaseXp = levelAdjustedXp(
        xp,
        m.level,
        Number(info.level || m.level),
      );
      const memberPool = Math.round(memberBaseXp * partyMult);
      const xpShare = Math.max(
        1,
        Math.floor(memberPool / eligible.length) +
          (index < memberPool % eligible.length ? 1 : 0),
      );
      const goldShare = goldBase + (index < goldRemainder ? 1 : 0);
      gainXp(m, xpShare);
      m.gold = (Number(m.gold) || 0) + goldShare;
      m.lastCombat = {
        outcome: "victory",
        enemy: info.enemyName || info.enemyId,
        shared: eligible.length > 1,
        partySize: eligible.length,
      };
    });
    let pile = info.lootPile;
    if (pile) {
      pile.items = (pile.items || []).map((x: any) => {
        const base = items[x.itemId];
        if (base?.randomize || Number(base?.level || 0) >= 6)
          return { ...x, itemId: makeGearInstance(x.itemId, source, p) };
        return x;
      });
      if (Math.random() < gearChance(source))
        addGearDropToPile(p, pile, Number(info.level || 1), source);
      if (Math.random() < prismChance(source))
        pile.items.push({ itemId: "veilglass_prism", qty: 1 });
      pile.eligible = eligible.map((m: any) => m.id);
      if (eligible.length > 1) {
        distributePartyDrops(
          eligible,
          pile.items || [],
          source,
          info.enemyName || info.enemyId,
        );
        world.lootPiles.delete(pile.id);
        pile = null;
        info.lootPile = null;
      }
    }
    return { xp, gold, lootPile: pile, partySize: eligible.length };
  }

  function lootTableFor(source = "normal", bossId = null) {
    return bossId
      ? IZR.lootTables?.bosses?.[bossId] || null
      : IZR.lootTables?.[source] || null;
  }
  return {
    weighted,
    affixSlotsFor,
    randomAffix,
    makeGearInstance,
    gearPoolFor,
    addGearDropToPile,
    lootTableFor,
    gearChance,
    prismChance,
    pityRarity,
    recordLootRarity,
    reward,
    resolveLootRollForParty,
    resolveExpiredLootRolls,
    normalizeXpTrack,
    gainXp,
    rebuildTalents,
    applyTalent,
    createDungeonRewardChest,
    createDungeonCompletionRewards,
    claimDungeonRewardChest,
    awardEncounterLoot,
    rewardMobKill,
  };
}
