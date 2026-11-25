const DEFAULT_RULES = {
  version: 3,
  rarity: {
    common: { multiplier: 0.7, maxAffixes: 0, socketChance: 0.0 },
    uncommon: { multiplier: 0.88, maxAffixes: 1, socketChance: 0.1 },
    rare: { multiplier: 1.0, maxAffixes: 2, socketChance: 0.25 },
    epic: { multiplier: 1.18, maxAffixes: 3, socketChance: 0.45 },
    legendary: { multiplier: 1.38, maxAffixes: 4, socketChance: 0.7 },
  },
  quality: {
    poor: 0.88,
    standard: 1,
    fine: 1.06,
    superior: 1.12,
    masterwork: 1.18,
  },
  statWeights: {
    strength: 1,
    agility: 1,
    intellect: 1,
    vitality: 1,
    willpower: 1,
    crit: 1.15,
    haste: 1.15,
    damage: 1.25,
    healing: 1.25,
    hotPower: 1.15,
    dotDamage: 1.2,
    armor: 0.85,
    maxHp: 0.04,
    attack: 1.05,
    threat: 1.0,
    controlDuration: 0.8,
    stunResist: 0.8,
    bleedDamage: 0.8,
    poisonDamage: 0.8,
    bleedDuration: 0.55,
    poisonDuration: 0.55,
    hotDuration: 0.55,
    buffDuration: 0.55,
    debuffDuration: 0.55,
    barrierPower: 0.9,
    rangeDamage: 1.1,
    aoeDamage: 1.1,
    damageTaken: 1.0,
    resourceCost: 0.8,
    versatility: 0.7,
    movementSpeed: 0.35,
    lifesteal: 0.4,
    avoidance: 0.35,
    leech: 0.4,
  },
  statBudgetWeights: {
    strength: 1,
    agility: 1,
    intellect: 1,
    vitality: 1,
    willpower: 1,
    crit: 1,
    haste: 1,
    damage: 1,
    healing: 1,
    hotPower: 1,
    dotDamage: 1,
    armor: 1,
    attack: 1,
    threat: 1,
    controlDuration: 1,
    stunResist: 1,
    bleedDamage: 1,
    bleedDuration: 1,
    poisonDamage: 1,
    poisonDuration: 1,
    hotDuration: 1,
    buffDuration: 1,
    debuffDuration: 1,
    barrierPower: 1,
    rangeDamage: 1,
    aoeDamage: 1,
    damageTaken: 1,
    resourceCost: 1,
    maxHp: 0.05,
  },
  tertiary: [
    { stat: "movementSpeed", weight: 0.35, min: 1, max: 3 },
    { stat: "lifesteal", weight: 0.4, min: 1, max: 2 },
    { stat: "versatility", weight: 0.55, min: 1, max: 2 },
    { stat: "avoidance", weight: 0.35, min: 1, max: 3 },
    { stat: "leech", weight: 0.4, min: 1, max: 2 },
  ],
  sockets: {
    maxPerItem: 2,
    colors: [
      "strength",
      "agility",
      "intellect",
      "vitality",
      "willpower",
      "crit",
      "haste",
      "healing",
    ],
    bonusAtTwo: { stat: "versatility", value: 2 },
    matchMultiplier: 1.1,
  },
  upgrades: {
    maxItemLevelIncrease: 3,
    statPerLevel: 0.055,
    powerPerLevel: 0.07,
    armorPerLevel: 0.055,
  },
  gearScore: {
    itemLevel: 1.0,
    primary: 2.0,
    secondary: 2.4,
    tertiary: 1.4,
    socket: 8,
    enchant: 12,
    setPiece: 3,
    legendaryEffect: 18,
    socketMatch: 3,
    upgradeLevel: 2,
  },
  buildEvaluation: {
    preferred: 1.3,
    secondary: 0.95,
    tertiary: 0.65,
    offSpec: 0.5,
    setPiece: 4,
    legendary: 16,
    socketMatch: 2,
    upgradeLevel: 1.5,
  },
  loot: {
    pity: {
      normalLegendary: 50,
      eliteLegendary: 12,
      bossLegendary: 3,
      bossEpic: 1,
    },
    buildTargetChance: 0.82,
  },
};
function clone(x: any) {
  return JSON.parse(JSON.stringify(x));
}
const rulesCache = new WeakMap<object, any>();
export function itemizationRules(data: any = {}) {
  if (data && typeof data === "object") {
    const cached = rulesCache.get(data);
    if (cached) return cached;
  }
  const src = data?.rules || {};
  const result = {
    ...clone(DEFAULT_RULES),
    ...clone(src),
    rarity: {
      ...DEFAULT_RULES.rarity,
      ...(src.rarity || {}),
      ...(data?.rarity || {}),
    },
    quality: {
      ...DEFAULT_RULES.quality,
      ...(src.quality || {}),
      ...(data?.quality || {}),
    },
    statWeights: {
      ...DEFAULT_RULES.statWeights,
      ...(src.statWeights || {}),
      ...(data?.statWeights || {}),
    },
    statBudgetWeights: {
      ...DEFAULT_RULES.statBudgetWeights,
      ...(src.statBudgetWeights || {}),
      ...(data?.statBudgetWeights || {}),
    },
    sockets: {
      ...DEFAULT_RULES.sockets,
      ...(src.sockets || {}),
      ...(data?.sockets || {}),
    },
    upgrades: {
      ...DEFAULT_RULES.upgrades,
      ...(src.upgrades || {}),
      ...(data?.upgrades || {}),
    },
    gearScore: {
      ...DEFAULT_RULES.gearScore,
      ...(src.gearScore || {}),
      ...(data?.gearScore || {}),
    },
    buildEvaluation: {
      ...DEFAULT_RULES.buildEvaluation,
      ...(src.buildEvaluation || {}),
      ...(data?.buildEvaluation || {}),
    },
    loot: {
      ...DEFAULT_RULES.loot,
      ...(src.loot || {}),
      ...(data?.loot || {}),
      pity: {
        ...DEFAULT_RULES.loot.pity,
        ...(src.loot?.pity || {}),
        ...(data?.loot?.pity || {}),
      },
    },
    tertiaryStats:
      data?.tertiaryStats || src.tertiaryStats || DEFAULT_RULES.tertiary,
    statCaps: data?.statCaps || src.statCaps || {},
    lootTables: data?.lootTables || src.lootTables || {},
    legendaryPaths: data?.legendaryPaths || src.legendaryPaths || {},
    craftingCompetitive:
      data?.craftingCompetitive || src.craftingCompetitive || {},
    maxLevel: Number(data?.maxLevel || src.maxLevel || 0),
    maxGearItemLevel: Number(
      data?.maxGearItemLevel || src.maxGearItemLevel || 0,
    ),
    progressionBands: data?.progressionBands || src.progressionBands || {},
  };
  if (data && typeof data === "object") rulesCache.set(data, result);
  return result;
}
export function getItemEnhancements(item: any, data: any = {}) {
  const gems = data?.gems || {};
  const enchants = data?.enchants || {};
  const stats: any[] = [];
  const colors = Array.isArray(item?.socketColors) ? item.socketColors : [];
  for (let index = 0; index < (item?.gems || []).length; index++) {
    const gemId = item.gems[index],
      gem = gems[gemId];
    if (!gem) continue;
    const matched =
      !!colors[index] &&
      String(gem.socketColor || "") === String(colors[index]);
    for (const [stat, value] of Object.entries(gem.stats || {}))
      stats.push({
        stat,
        value: Number(value) || 0,
        source: "gem",
        id: gemId,
        matched,
        index,
      });
  }
  const enchant = item?.enchantId ? enchants[item.enchantId] : null;
  if (enchant)
    for (const [stat, value] of Object.entries(enchant.stats || {}))
      stats.push({
        stat,
        value: Number(value) || 0,
        source: "enchant",
        id: item.enchantId,
        matched: true,
        index: -1,
      });
  return {
    stats,
    gems: (item?.gems || []).map((id: string) => gems[id]).filter(Boolean),
    enchant,
    matchedSockets: stats.filter((x) => x.source === "gem" && x.matched).length,
  };
}
export function socketCount(item: any, rules: any) {
  const max = Math.min(
    Number(rules?.sockets?.maxPerItem || 2),
    Number(item?.socketCapacity || 0),
  );
  return Math.max(
    0,
    Math.min(max, Math.floor(Number(item?.socketCapacity || 0))),
  );
}
export function matchingSocketCount(item: any, data: any = {}) {
  return getItemEnhancements(item, data).matchedSockets;
}
export function statBudgetCost(
  item: any,
  data: any = {},
  includeEnhancements = false,
) {
  const rules = itemizationRules(data),
    stats = includeEnhancements
      ? effectiveItemStats(item, data)
      : (() => {
          const out: any = {};
          for (const a of item?.affixes || [])
            if (a?.stat)
              out[a.stat] = Number(out[a.stat] || 0) + Number(a.value || 0);
          if (item?.hp)
            out.maxHp = Number(out.maxHp || 0) + Number(item.hp || 0);
          for (const [k, v] of Object.entries(item?.statusBonuses || {}))
            out[k] = Number(out[k] || 0) + Number(v || 0);
          if (item?.tertiary)
            for (const [k, v] of Object.entries(item.tertiary))
              out[k] = Number(out[k] || 0) + Number(v || 0);
          return out;
        })();
  let cost = 0;
  for (const [stat, value] of Object.entries(stats))
    cost +=
      Math.max(0, Number(value || 0)) *
      Number(rules.statBudgetWeights?.[stat] ?? 1);
  return Math.round(cost * 100) / 100;
}
export function statBudgetRatio(item: any, data: any = {}) {
  const budget = Number(item?.statBudget || 0);
  return budget > 0
    ? Math.round((statBudgetCost(item, data) / budget) * 1000) / 1000
    : 0;
}
export function effectiveItemStats(item: any, data: any = {}) {
  const out: any = {};
  for (const a of item?.affixes || [])
    if (a?.stat) out[a.stat] = Number(out[a.stat] || 0) + Number(a.value || 0);
  if (item?.hp) out.maxHp = Number(out.maxHp || 0) + Number(item.hp || 0);
  for (const [k, v] of Object.entries(item?.statusBonuses || {}))
    out[k] = Number(out[k] || 0) + Number(v || 0);
  const enh = getItemEnhancements(item, data);
  for (const a of enh.stats)
    out[a.stat] =
      Number(out[a.stat] || 0) +
      Number(a.value || 0) *
        (a.matched ? Number(data?.rules?.sockets?.matchMultiplier || 1) : 1);
  if (item?.tertiary)
    for (const [k, v] of Object.entries(item.tertiary))
      out[k] = Number(out[k] || 0) + Number(v || 0);
  if (
    enh.matchedSockets >= 2 &&
    socketCount(item, itemizationRules(data)) >= 2
  ) {
    const b = itemizationRules(data).sockets?.bonusAtTwo;
    if (b?.stat) out[b.stat] = Number(out[b.stat] || 0) + Number(b.value || 0);
  }
  const upgradeLevel = Math.max(0, Number(item?.upgradeLevel || 0));
  if (upgradeLevel) {
    const scale =
      1 +
      upgradeLevel *
        Number(itemizationRules(data).upgrades.statPerLevel || 0.055);
    for (const [k, v] of Object.entries(out)) {
      if (k === "maxHp" || k === "armor" || k === "attack") continue;
      out[k] = Math.round(Number(v) * scale * 100) / 100;
    }
  }
  return out;
}
export function itemGearScore(item: any, data: any = {}, setPiece = false) {
  const rules = itemizationRules(data);
  const stats = effectiveItemStats(item, data);
  let score =
    Number(item?.itemLevel || item?.level || 0) * rules.gearScore.itemLevel;
  const primary = new Set([
    "strength",
    "agility",
    "intellect",
    "vitality",
    "willpower",
  ]);
  for (const [stat, value] of Object.entries(stats)) {
    const weight = Number(rules.statWeights[stat] ?? 0.5);
    const tertiary = (rules.tertiaryStats || []).some(
      (x: any) => x.stat === stat,
    );
    const channel = tertiary
      ? "tertiary"
      : primary.has(stat)
        ? "primary"
        : "secondary";
    score +=
      Number(value || 0) *
      weight *
      Number(rules.gearScore[channel] || rules.gearScore.secondary);
  }
  score += socketCount(item, rules) * Number(rules.gearScore.socket || 0);
  score +=
    matchingSocketCount(item, data) * Number(rules.gearScore.socketMatch || 0);
  if (item?.enchantId) score += Number(rules.gearScore.enchant || 0);
  if (setPiece) score += Number(rules.gearScore.setPiece || 0);
  if (item?.gearEffect) score += Number(rules.gearScore.legendaryEffect || 0);
  score +=
    Math.max(0, Number(item?.upgradeLevel || 0)) *
    Number(rules.gearScore.upgradeLevel || 0);
  return Math.round(score * 100) / 100;
}
export function itemBuildScore(
  item: any,
  p: any,
  data: any = {},
  synergies: any = {},
) {
  const rules = itemizationRules(data);
  const stats = effectiveItemStats(item, data);
  const preferred = new Set(
    synergies?.builds?.[p?.activeBuildId]?.preferredStats || [],
  );
  let score = Number(item?.itemLevel || item?.level || 0);
  for (const [stat, value] of Object.entries(stats)) {
    const tertiary = (rules.tertiaryStats || []).some(
      (x: any) => x.stat === stat,
    );
    const weight = preferred.has(stat)
      ? tertiary
        ? rules.buildEvaluation.tertiary
        : rules.buildEvaluation.preferred
      : tertiary
        ? rules.buildEvaluation.offSpec
        : rules.buildEvaluation.secondary;
    score += Number(value || 0) * Number(weight || 0);
  }
  if (item?.buildIds?.includes(p?.activeBuildId))
    score += Number(rules.buildEvaluation.setPiece || 0);
  if (item?.setId) score += Number(rules.buildEvaluation.setPiece || 0);
  if (item?.gearEffect && item?.buildIds?.includes(p?.activeBuildId))
    score += Number(rules.buildEvaluation.legendary || 0);
  score +=
    matchingSocketCount(item, data) *
    Number(rules.buildEvaluation.socketMatch || 0);
  score +=
    Math.max(0, Number(item?.upgradeLevel || 0)) *
    Number(rules.buildEvaluation.upgradeLevel || 0);
  return Math.round(score * 100) / 100;
}
export function compareItems(
  a: any,
  b: any,
  p: any,
  data: any = {},
  synergies: any = {},
) {
  const aScore = itemBuildScore(a, p, data, synergies),
    bScore = itemBuildScore(b, p, data, synergies);
  return {
    aScore,
    bScore,
    delta: Number((bScore - aScore).toFixed(2)),
    upgrade: bScore > aScore,
    gearScoreA: itemGearScore(a, data),
    gearScoreB: itemGearScore(b, data),
    budgetA: statBudgetRatio(a, data),
    budgetB: statBudgetRatio(b, data),
  };
}
export function allowedGemSockets(item: any, data: any = {}) {
  return socketCount(item, itemizationRules(data));
}
export function validateEnhancements(item: any, data: any = {}) {
  const count = allowedGemSockets(item, data),
    gems = Array.isArray(item?.gems) ? item.gems : [];
  if (gems.length > count)
    return [false, `Item supports only ${count} socket(s).`];
  if (new Set(gems).size !== gems.length)
    return [false, "An item cannot contain the same gem twice."];
  if (item?.enchantId && !data?.enchants?.[item.enchantId])
    return [false, "Unknown enchantment."];
  if (Array.isArray(item?.socketColors) && item.socketColors.length < count)
    return [false, "Socket color metadata is incomplete."];
  return [true, "Valid"];
}
export function validateStatBudget(
  item: any,
  data: any = {},
  tolerance = 1.15,
) {
  const budget = Number(item?.statBudget || 0);
  if (!budget) return [true, "Unbudgeted legacy item."];
  const cost = statBudgetCost(item, data);
  return cost <= budget * tolerance
    ? [true, "Within stat budget"]
    : [false, `Stat budget exceeded: ${cost}/${budget}.`];
}
export function upgradeItemProjection(item: any, levels = 1, data: any = {}) {
  const rules = itemizationRules(data),
    baseLevel = Number(
      item?.baseItemLevel ||
        item?.upgradeTrack?.baseItemLevel ||
        item?.level ||
        item?.itemLevel ||
        1,
    ),
    declaredTrack = item?.upgradeTrack?.maxIncrease,
    declaredMax = item?.upgrade?.maxLevel,
    current = Number(item?.upgradeLevel || 0),
    requested = Math.max(0, Math.floor(levels)),
    cap =
      declaredTrack != null
        ? Math.max(0, Number(declaredTrack) - current)
        : declaredMax != null
          ? Math.max(
              0,
              Number(declaredMax) -
                Number(item?.itemLevel || item?.level || baseLevel),
            )
          : Number(rules.upgrades.maxItemLevelIncrease || 3),
    n = Math.max(0, Math.min(cap, requested)),
    copy = clone(item);
  copy.upgradeLevel = current + n;
  copy.itemLevel = Number(item?.itemLevel || item?.level || baseLevel) + n;
  copy.level = copy.itemLevel;
  if (copy.power != null)
    copy.power =
      Math.round(
        Number(copy.power) *
          (1 + n * Number(rules.upgrades.powerPerLevel || 0.07)) *
          100,
      ) / 100;
  if (copy.armor != null)
    copy.armor = Math.round(
      Number(copy.armor) *
        (1 + n * Number(rules.upgrades.armorPerLevel || 0.055)),
    );
  return copy;
}

export function applyStatCaps(stats: any = {}, data: any = {}) {
  const caps = itemizationRules(data).statCaps || {};
  const out = { ...stats };
  const overcap: any = {};
  for (const [stat, rule] of Object.entries(caps)) {
    if (out[stat] == null) continue;
    const hard = Number((rule as any)?.hardCap);
    if (!Number.isFinite(hard) || hard <= 0) continue;
    const value = Number(out[stat] || 0);
    out[stat] = Math.min(value, hard);
    if (value > hard) overcap[stat] = Number((value - hard).toFixed(2));
  }
  return { stats: out, overcap };
}
export function statBreakpointProgress(stats: any = {}, data: any = {}) {
  const caps = itemizationRules(data).statCaps || {};
  const result: any = {};
  for (const [stat, rule] of Object.entries(caps)) {
    const value = Number(stats?.[stat] || 0);
    const points = Array.isArray((rule as any)?.breakpoints)
      ? (rule as any).breakpoints.map(Number).filter(Number.isFinite)
      : [];
    result[stat] = {
      value,
      breakpoints: points.map((x) => ({
        value: x,
        reached: value >= x,
        remaining: Math.max(0, Number((x - value).toFixed(2))),
      })),
      softCap: Number((rule as any)?.softCap || 0),
      hardCap: Number((rule as any)?.hardCap || 0),
    };
  }
  return result;
}
export function scenarioWeights(
  role: any = "dps",
  scenario: any = "singleTarget",
) {
  const base: any =
    {
      dps: {
        strength: 1,
        agility: 1,
        intellect: 1,
        crit: 1.3,
        haste: 1.2,
        damage: 1.5,
        dotDamage: 1.2,
        rangeDamage: 1.1,
        aoeDamage: 1.1,
      },
      healer: {
        intellect: 1,
        willpower: 1,
        healing: 1.6,
        haste: 1.25,
        crit: 1.15,
        hotPower: 1.35,
        hotDuration: 0.7,
        barrierPower: 0.8,
      },
      tank: {
        vitality: 1.2,
        strength: 0.8,
        armor: 1.2,
        maxHp: 0.7,
        damageTaken: 1.4,
        threat: 1.2,
        haste: 0.7,
        crit: 0.5,
      },
      support: {
        willpower: 1.2,
        haste: 1.15,
        controlDuration: 1.25,
        buffDuration: 1.2,
        debuffDuration: 1.2,
        healing: 0.8,
        damage: 0.7,
      },
    }[role] || {};
  const modifiers: any =
    {
      singleTarget: { damage: 1.2, crit: 1.1, haste: 1.05 },
      movement: { movementSpeed: 1.5, rangeDamage: 1.15, haste: 1.1 },
      dungeon: { aoeDamage: 1.35, haste: 1.15, versatility: 1.1 },
      boss: { damage: 1.3, crit: 1.15, haste: 1.1 },
      tankBuster: {
        vitality: 1.2,
        maxHp: 1.25,
        armor: 1.3,
        damageTaken: 1.5,
        avoidance: 1.15,
      },
      partyDamage: { versatility: 1.15, healing: 1.15, barrierPower: 1.15 },
    }[scenario] || {};
  return Object.fromEntries(
    Array.from(new Set([...Object.keys(base), ...Object.keys(modifiers)])).map(
      (stat) => [stat, Number(base[stat] || 1) * Number(modifiers[stat] || 1)],
    ),
  );
}
export function evaluateGearScenario(
  loadout: any[] = [],
  p: any = {},
  data: any = {},
  synergies: any = {},
  role: any = "dps",
  scenario: any = "singleTarget",
) {
  const weights = scenarioWeights(role, scenario);
  let score = 0;
  const stats: any = {};
  for (const it of loadout || []) {
    const s = effectiveItemStats(it, data);
    for (const [k, v] of Object.entries(s))
      stats[k] = Number(stats[k] || 0) + Number(v || 0);
    score += itemBuildScore(it, p, data, synergies);
  }
  for (const [stat, weight] of Object.entries(weights))
    score += Number(stats[stat] || 0) * Number(weight || 0);
  const capped = applyStatCaps(stats, data);
  const breakpoints = statBreakpointProgress(capped.stats, data);
  return {
    score: Number(score.toFixed(2)),
    stats: capped.stats,
    overcap: capped.overcap,
    breakpoints,
    gearScore: Number(
      (loadout || [])
        .reduce((n, it) => n + itemGearScore(it, data), 0)
        .toFixed(2),
    ),
    averageItemLevel: (loadout || []).length
      ? Number(
          (
            (loadout || []).reduce(
              (n, it) => n + Number(it.itemLevel || it.level || 0),
              0,
            ) / (loadout || []).length
          ).toFixed(2),
        )
      : 0,
  };
}
export function chooseLootCandidate(
  candidates: any[] = [],
  p: any = {},
  data: any = {},
  synergies: any = {},
  history: any[] = [],
) {
  const rules = itemizationRules(data).loot?.duplicateProtection || {};
  const recent = Array.isArray(history)
    ? history.slice(-Number(rules.sameItemWindow || 8))
    : [];
  const recentIds = new Set(
    recent.map((x) => String(x.baseItemId || x.itemId || x)),
  );
  const fresh = (candidates || []).filter(
    (it) => !recentIds.has(String(it.baseItemId || it.id)),
  );
  const pool = fresh.length ? fresh : candidates;
  return (
    [...pool].sort(
      (a, b) =>
        itemBuildScore(b, p, data, synergies) -
        itemBuildScore(a, p, data, synergies),
    )[0] || null
  );
}
export function legendaryAcquisitionState(player: any = {}, data: any = {}) {
  const paths = itemizationRules(data).legendaryPaths || {};
  return {
    worldDrop: Number(paths.worldDrop?.chance || 0),
    dungeon: Number(paths.dungeon?.chance || 0),
    boss: Number(paths.boss?.chance || 0),
    crafting: Number(paths.crafting?.chance || 0),
    pity: { ...paths },
  };
}

export function optimizeGearLoadout(
  candidates: any[],
  p: any,
  data: any = {},
  synergies: any = {},
  slots: any[] = [],
) {
  const targetSlots = slots.length
    ? slots
    : [
        "weapon",
        "shield",
        "helmet",
        "chest",
        "shoulders",
        "gloves",
        "boots",
        "neck",
        "ring",
        "ring2",
        "relic",
        "relic2",
      ];
  const scoreCache = new Map<any, number>();
  const score = (it: any) => {
    const key = it?.id || it;
    if (!scoreCache.has(key))
      scoreCache.set(key, itemBuildScore(it, p, data, synergies));
    return scoreCache.get(key) || 0;
  };
  const bySlot: any = {};
  for (const it of candidates || []) {
    const slot =
      it.type === "ring"
        ? it.setSlot === "ring2"
          ? "ring2"
          : "ring"
        : it.type === "relic"
          ? it.setSlot === "relic2"
            ? "relic2"
            : "relic"
          : it.type;
    if (!targetSlots.includes(slot)) continue;
    (bySlot[slot] ??= []).push(it);
  }
  for (const slot of targetSlots)
    bySlot[slot] = (bySlot[slot] || [])
      .sort((a: any, b: any) => score(b) - score(a))
      .slice(0, 8);
  let states = [{ gear: [], score: 0, setCounts: new Map() }];
  for (const slot of targetSlots) {
    const pool = bySlot[slot];
    if (!pool?.length) continue;
    const next: any[] = [];
    for (const state of states)
      for (const it of pool) {
        const countMap = new Map(state.setCounts);
        let bonus = 0;
        if (it.setId) {
          const before = Number(countMap.get(it.setId) || 0),
            after = before + 1;
          countMap.set(it.setId, after);
          if (after === 2) bonus += 5;
          else if (after === 4) bonus += 12;
          else if (after === 6) bonus += 24;
        }
        next.push({
          gear: [...state.gear, it],
          score: state.score + score(it) + bonus,
          setCounts: countMap,
        });
      }
    next.sort((a, b) => b.score - a.score);
    states = next.slice(0, 48);
  }
  const best = states[0] || { gear: [], score: 0 };
  return {
    gear: best.gear,
    score: best.score,
    alternatives: states
      .slice(0, 10)
      .map((x) => ({
        score: Math.round(x.score * 100) / 100,
        items: x.gear.map((i: any) => i.id),
      })),
    evaluatedStates: states.length,
  };
}
