import { InventoryStorage } from "./services/InventoryStorage.js";
import { EquipmentService } from "./services/EquipmentService.js";
import { ItemStatService } from "./services/ItemStatService.js";
import {
  playerMaxHp,
  playerAttack,
  playerArmor,
  playerMaxResolve,
} from "../combat/CombatFormula.js";
import { collectGearEffects } from "../items/GearEffects.js";
import {
  effectiveItemStats,
  itemGearScore,
  itemBuildScore,
  validateEnhancements,
  allowedGemSockets,
  validateStatBudget,
} from "../items/ItemizationEngine.js";

const EQUIP_TYPES = [
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
];
const EQUIPMENT_SLOTS = [
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
const STACKABLE = new Set(["material", "consumable"]);
const PRIMARY_STATS = new Set([
  "strength",
  "agility",
  "intellect",
  "vitality",
  "willpower",
]);

class Inventory {
  private items: Record<string, any>;
  private gearSynergies: Record<string, any>;
  private itemization: Record<string, any>;
  private storage: InventoryStorage;
  private equipmentService: EquipmentService;
  private itemStatService: ItemStatService;
  constructor(items, gearSynergies = {}, itemization = {}) {
    this.items = items;
    this.gearSynergies = gearSynergies || {};
    this.itemization = itemization || {};
    this.storage = new InventoryStorage(this);
    this.equipmentService = new EquipmentService(this);
    this.itemStatService = new ItemStatService(this);
  }
  def(id) {
    return id ? this.items[id] || null : null;
  }
  isStackable(def) {
    return STACKABLE.has(def?.type);
  }
  equippedIds(p) {
    return Object.values(p.equipment || {}).filter(Boolean);
  }
  gearSlotForItem(p, it) {
    if (!it) return null;
    if (it.type === "ring") {
      if (!p.equipment.ring) return "ring";
      if (!p.equipment.ring2) return "ring2";
      return "ring";
    }
    if (it.type === "relic") {
      if (!p.equipment.relic) return "relic";
      if (!p.equipment.relic2) return "relic2";
      return "relic";
    }
    return EQUIP_TYPES.includes(it.type) ? it.type : null;
  }
  gearSynergyFor(p, gear) {
    const buildId = p?.activeBuildId;
    const spec = this.gearSynergies?.builds?.[buildId];
    if (!spec)
      return {
        active: false,
        score: 0,
        matchingAffixes: 0,
        matchedStats: [],
        effects: {},
      };
    const rules = this.gearSynergies?.rules || {};
    const preferred = new Set(spec.preferredStats || []);
    let score = 0,
      matchingAffixes = 0,
      matchedStats = [];
    for (const it of gear) {
      if (!it || !it.type || this.isStackable(it)) continue;
      score +=
        Number(it.itemLevel || it.level || 0) *
        Number(rules.itemLevelWeight || 0);
      for (const a of it.affixes || [])
        if (preferred.has(a.stat)) {
          score += Number(rules.affinityPerMatchingAffix || 1);
          matchingAffixes++;
          if (!matchedStats.includes(a.stat)) matchedStats.push(a.stat);
        }
    }
    const equipped = gear.filter(
      (it) => it && it.type && !this.isStackable(it),
    ).length;
    const active =
      equipped >= Number(rules.minimumEquippedItems || 4) &&
      score >= Number(rules.minimumAffinityScore || 5);
    return {
      active,
      score: Number(score.toFixed(2)),
      matchingAffixes,
      matchedStats,
      equipped,
      effects: active ? spec.effects || {} : {},
      abilityId: spec.abilityId || null,
      abilityPowerPct: active ? Number(spec.abilityPowerPct || 0) : 0,
      resourceGainPct: active ? Number(spec.resourceGainPct || 0) : 0,
      cooldownRecoveryPct: active ? Number(spec.cooldownRecoveryPct || 0) : 0,
      critResourceGain: active ? Number(spec.critResourceGain || 0) : 0,
    };
  }
  gearEffectState(p) {
    return collectGearEffects(p, this.items);
  }
  enhancementStats(it) {
    return effectiveItemStats(it, this.itemization);
  }
  itemGearScore(it) {
    return itemGearScore(it, this.itemization);
  }
  itemBuildScore(it, p) {
    return itemBuildScore(it, p, this.itemization, this.gearSynergies);
  }
  ownsItem(p, id) {
    return (
      !!id &&
      ((p.inventory || []).some((x) => x.itemId === id && x.qty > 0) ||
        Object.values(p.equipment || {}).includes(id))
    );
  }
  socketGem(p, itemId, gemId) {
    const it = this.def(itemId),
      gem = this.itemization?.gems?.[gemId];
    if (!it || !it.generated)
      return [false, "Only generated gear can be socketed."];
    if (!gem) return [false, "Unknown gem."];
    if (!this.ownsItem(p, itemId)) return [false, "You do not own that gear."];
    it.gems = Array.isArray(it.gems) ? it.gems : [];
    const cap = allowedGemSockets(it, this.itemization);
    if (it.gems.length >= cap)
      return [false, `This item has no empty sockets (${cap}/${cap}).`];
    if (it.gems.includes(gemId))
      return [false, "You cannot socket the same gem twice."];
    if (!this.has(p, gemId)) return [false, `You need ${gem.name}.`];
    this.remove(p, gemId, 1);
    it.gems.push(gemId);
    this.recalc(p);
    return [
      true,
      `Socketed ${gem.name} into ${it.name}.`,
      { itemId, gemId, gearScore: this.itemGearScore(it) },
    ];
  }
  removeGem(p, itemId, index = 0) {
    const it = this.def(itemId);
    if (!it || !this.ownsItem(p, itemId))
      return [false, "You do not own that gear."];
    it.gems = Array.isArray(it.gems) ? it.gems : [];
    const i = Math.max(0, Math.floor(Number(index) || 0));
    if (!it.gems[i]) return [false, "No gem is socketed there."];
    const gemId = it.gems[i],
      gem = this.itemization?.gems?.[gemId];
    if (!this.canGive(p, gemId, 1)) return [false, "Your bag is full."];
    it.gems.splice(i, 1);
    this.give(p, gemId, 1);
    this.recalc(p);
    return [
      true,
      `Removed ${gem?.name || gemId} from ${it.name}.`,
      { itemId, gemId },
    ];
  }
  enchantItem(p, itemId, enchantId) {
    const it = this.def(itemId),
      enchant = this.itemization?.enchants?.[enchantId];
    if (!it || !it.generated)
      return [false, "Only generated gear can be enchanted."];
    if (!enchant) return [false, "Unknown enchantment."];
    if (!this.ownsItem(p, itemId)) return [false, "You do not own that gear."];
    const level = Number(it.level || it.itemLevel || 1);
    if (level < Number(enchant.level || 1))
      return [false, `This enchantment requires item level ${enchant.level}.`];
    if (!this.has(p, enchant.material || "arcane_dust"))
      return [false, "You need an Arcane Dust."];
    this.remove(p, enchant.material || "arcane_dust", 1);
    it.enchantId = enchantId;
    this.recalc(p);
    return [
      true,
      `Enchanted ${it.name} with ${enchant.name}.`,
      { itemId, enchantId, gearScore: this.itemGearScore(it) },
    ];
  }
  clearEnchant(p, itemId) {
    const it = this.def(itemId);
    if (!it || !it.enchantId || !this.ownsItem(p, itemId))
      return [false, "No removable enchantment is present."];
    const old = it.enchantId;
    it.enchantId = null;
    this.recalc(p);
    return [
      true,
      `Removed ${this.itemization?.enchants?.[old]?.name || old} from ${it.name}.`,
      { itemId, enchantId: old },
    ];
  }
  gearSetBonuses(p, gear) {
    const defs = this.itemization?.sets || [];
    const byId = new Map<string, any>(defs.map((x: any) => [x.id, x]));
    const counts = new Map();
    for (const it of gear) {
      if (it?.setId) counts.set(it.setId, (counts.get(it.setId) || 0) + 1);
    }
    const result = [];
    const statEffects = {};
    const combatEffects = {};
    const abilityMultipliers = {};
    for (const [setId, count] of counts) {
      const set = byId.get(setId);
      if (!set) continue;
      for (const threshold of [2, 4, 6]) {
        if (count < threshold) continue;
        const bonus = set.bonuses?.[threshold];
        if (!bonus) continue;
        for (const [stat, value] of Object.entries(bonus.affixes || {}))
          statEffects[stat] =
            Number(statEffects[stat] || 0) + Number(value || 0);
        for (const [key, value] of Object.entries(bonus.effects || {}))
          combatEffects[key] =
            Number(combatEffects[key] || 0) + Number(value || 0);
        if (bonus.abilityId && Number(bonus.abilityPowerPct || 0) > 0)
          abilityMultipliers[bonus.abilityId] =
            Number(abilityMultipliers[bonus.abilityId] || 0) +
            Number(bonus.abilityPowerPct || 0);
        result.push({
          setId,
          setName: set.name,
          pieces: count,
          threshold,
          bonus: {
            affixes: bonus.affixes || {},
            effects: bonus.effects || {},
            abilityId: bonus.abilityId || null,
            abilityPowerPct: Number(bonus.abilityPowerPct || 0),
          },
        });
      }
    }
    return {
      active: result.length > 0,
      counts: Object.fromEntries(counts),
      bonuses: result,
      statEffects,
      combatEffects,
      abilityMultipliers,
    };
  }
  give(p, id, qty = 1) {
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    if (qty === 0) return true;
    const def = this.def(id);
    if (!def) return false;
    if (!this.canGive(p, id, qty)) return false;
    if (def.generated) {
      p.generatedItems = p.generatedItems || {};
      p.generatedItems[id] = JSON.parse(JSON.stringify(def));
    }
    if (this.isStackable(def)) {
      const x = p.inventory.find((i) => i.itemId === id && i.qty > 0);
      if (x) {
        x.qty += qty;
        p._questItemEvents?.push({ itemId: id, qty });
        return true;
      }
      p.inventory.push({ itemId: id, qty });
      p._questItemEvents?.push({ itemId: id, qty });
      return true;
    }
    for (let n = 0; n < qty; n++) p.inventory.push({ itemId: id, qty: 1 });
    p._questItemEvents?.push({ itemId: id, qty });
    return true;
  }
  has(p, id) {
    return p.inventory.some((i) => i.itemId === id && i.qty > 0);
  }
  canGive(p, id, qty = 1) {
    if (qty <= 0) return true;
    const def = this.def(id);
    if (!def) return false;
    if (this.isStackable(def) && this.has(p, id)) return true;
    const occupied = p.inventory.filter((i) => i.qty > 0).length;
    return (
      occupied +
        (this.isStackable(def)
          ? this.has(p, id)
            ? 0
            : 1
          : Math.max(0, qty)) <=
      30
    );
  }
  canGiveMany(p, items = []) {
    const inventory = (p.inventory || []).filter(
      (i: any) => Number(i?.qty || 0) > 0,
    );
    let freeSlots = Math.max(0, 30 - inventory.length);
    const stackableExisting = new Set(
      inventory
        .filter((i: any) => this.isStackable(this.def(i.itemId)))
        .map((i: any) => i.itemId),
    );
    const newStackable = new Set<string>();
    for (const item of items) {
      if (!item || Number(item.qty || 0) <= 0) continue;
      const def = this.def(item.itemId);
      if (!def) continue;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      if (this.isStackable(def)) {
        if (stackableExisting.has(item.itemId) || newStackable.has(item.itemId))
          continue;
        newStackable.add(item.itemId);
        freeSlots--;
        if (freeSlots < 0) return false;
        continue;
      }
      freeSlots -= qty;
      if (freeSlots < 0) return false;
    }
    return true;
  }
  remove(p, id, qty = 1) {
    qty = Math.max(0, Math.floor(Number(qty) || 0));
    if (qty === 0) return true;
    const entries = p.inventory.filter((i) => i.itemId === id && i.qty > 0);
    if (entries.reduce((n, i) => n + Number(i.qty || 0), 0) < qty) return false;
    let remaining = qty;
    for (const x of entries) {
      const take = Math.min(Number(x.qty) || 0, remaining);
      x.qty -= take;
      remaining -= take;
      if (remaining <= 0) break;
    }
    p.inventory = p.inventory.filter((i) => i.qty > 0);
    return true;
  }
  recalc(p) {
    const slots = EQUIPMENT_SLOTS;
    const gear = slots
      .map((slot) => this.def(p.equipment?.[slot]))
      .filter(Boolean);
    const w = this.def(p.equipment?.weapon) || {};
    const st = p.stats || {};
    const aff = {
      strength: 0,
      agility: 0,
      intellect: 0,
      vitality: 0,
      willpower: 0,
      maxHp: 0,
      hp: 0,
      haste: 0,
      crit: 0,
      damage: 0,
      healing: 0,
      armor: 0,
      attack: 0,
      bleedDamage: 0,
      bleedDuration: 0,
      poisonDamage: 0,
      poisonDuration: 0,
      stunDuration: 0,
      stunResist: 0,
      hotDuration: 0,
      hotPower: 0,
      buffDuration: 0,
      debuffDuration: 0,
      controlDuration: 0,
      dotDamage: 0,
      versatility: 0,
      movementSpeed: 0,
      lifesteal: 0,
      avoidance: 0,
      leech: 0,
      threat: 0,
      damageTaken: 0,
      barrierPower: 0,
      rangeDamage: 0,
      aoeDamage: 0,
      resourceCost: 0,
    };
    const itemScores: any[] = [];
    for (const it of gear) {
      const stats = this.enhancementStats(it);
      for (const [k, v] of Object.entries(stats))
        if (k in aff) aff[k] += Number(v) || 0;
      itemScores.push({
        id: it.id,
        name: it.name,
        itemLevel: Number(it.itemLevel || it.level || 1),
        rarity: it.rarity || "common",
        gearScore: this.itemGearScore(it),
        buildScore: this.itemBuildScore(it, p),
        gems: (it.gems || []).slice(),
        enchantId: it.enchantId || null,
        setId: it.setId || null,
      });
    }
    const setState = this.gearSetBonuses(p, gear);
    const gearEffects = this.gearEffectState(p);
    for (const [k, v] of Object.entries(setState.statEffects || {})) {
      if (k in aff) aff[k] += Number(v) || 0;
    }
    const b = p.talentBonuses || {},
      baseBuild = p.buildBonuses || {},
      profile = p.combatProfile || {};
    const gearSynergy = this.gearSynergyFor(p, gear);
    const build = { ...baseBuild };
    for (const [k, v] of Object.entries(gearSynergy.effects || {}))
      build[k] = Number(build[k] || 0) + Number(v || 0);
    for (const [k, v] of Object.entries(setState.combatEffects || {})) {
      if (k in aff) aff[k] += Number(v) || 0;
      else build[k] = Number(build[k] || 0) + Number(v || 0);
    }
    const oldMaxHp = Math.max(1, Number(p.maxHp || p.baseHp || 100)),
      oldHp = Math.max(0, Number(p.hp || 0));
    p.maxHp = Math.round(
      playerMaxHp(p, aff, b) *
        Number(profile.durability || 1) *
        (1 + Number(build.maxHpPct || 0) / 100),
    );
    p.maxResolve = playerMaxResolve(p, aff, b);
    p.attack =
      Math.round(
        playerAttack(p, w.power || 0, aff, b) *
          Number(profile.damage || 1) *
          (1 + Number(build.damage || 0) / 100) *
          10,
      ) / 10;
    p.armor =
      Math.round(
        playerArmor(
          p,
          gear.reduce((n, it) => n + (it.armor || 0), 0),
          aff,
          b,
        ) *
          Number(profile.durability || 1) *
          (1 + Number(build.armorPct || 0) / 100) *
          10,
      ) / 10;
    p.spellPower =
      Math.round((p.attack + Number(st.intellect || 10) * 0.35) * 10) / 10;
    const profileHealingBonus = (Number(profile.healing || 1) - 1) * 100;
    const totalGearScore = Number(
      itemScores.reduce((n, x) => n + Number(x.gearScore || 0), 0).toFixed(2),
    );
    const averageItemLevel = itemScores.length
      ? Number(
          (
            itemScores.reduce((n, x) => n + Number(x.itemLevel || 0), 0) /
            itemScores.length
          ).toFixed(2),
        )
      : 0;
    const gearBuildScore = Number(
      itemScores.reduce((n, x) => n + Number(x.buildScore || 0), 0).toFixed(2),
    );
    const enhancementCount = itemScores.reduce(
      (n, x) => n + (x.gems?.length || 0) + (x.enchantId ? 1 : 0),
      0,
    );
    p.bonuses = {
      ...aff,
      gearSynergy,
      gearSets: setState,
      gearEffects,
      gearSetAbilityMultipliers: setState.abilityMultipliers || {},
      gearScore: totalGearScore,
      averageItemLevel,
      gearBuildScore,
      gearEnhancements: enhancementCount,
      gearItems: itemScores,
      primaryStat: profile.primaryStat || "strength",
      secondaryStat: profile.secondaryStat || "vitality",
      haste:
        aff.haste +
        (b.haste || 0) +
        Number(profile.haste || 0) +
        Number(build.haste || 0),
      crit:
        aff.crit +
        (b.crit || 0) +
        Number(profile.crit || 0) +
        Number(build.crit || 0),
      damage: Number(b.damage || 0) + Number(build.damage || 0),
      healing:
        Math.round(
          (aff.healing +
            (b.healing || 0) +
            profileHealingBonus +
            Number(build.healing || 0)) *
            100,
        ) / 100,
      resolveRegen:
        Number(b.resolveRegen || 0) + Number(profile.resourceRegen || 0),
      bleedDamage: aff.bleedDamage + (b.bleedDamage || 0),
      bleedDuration: aff.bleedDuration + (b.bleedDuration || 0),
      poisonDamage: aff.poisonDamage + (b.poisonDamage || 0),
      poisonDuration: aff.poisonDuration + (b.poisonDuration || 0),
      stunDuration: aff.stunDuration + (b.stunDuration || 0),
      stunResist:
        aff.stunResist + (b.stunResist || 0) + Number(build.stunResist || 0),
      hotDuration: aff.hotDuration + (b.hotDuration || 0),
      hotPower: aff.hotPower + Number(build.hotPower || 0),
      buffDuration: aff.buffDuration + (b.buffDuration || 0),
      controlDuration: aff.controlDuration + Number(build.controlDuration || 0),
      threat: aff.threat + Number(build.threat || 0),
      damageTaken: aff.damageTaken + Number(build.damageTaken || 0),
      dotDamage: aff.dotDamage + Number(build.dotDamage || 0),
      barrierPower: aff.barrierPower + Number(build.barrierPower || 0),
      rangeDamage: aff.rangeDamage + Number(build.rangeDamage || 0),
      aoeDamage: aff.aoeDamage + Number(build.aoeDamage || 0),
      debuffDuration: aff.debuffDuration + Number(build.debuffDuration || 0),
      resourceCost: aff.resourceCost + Number(build.resourceCost || 0),
      abilityMultipliers: { ...(build.abilityMultipliers || {}) },
      gearAttunementDamage: Number(gearSynergy.effects?.damage || 0),
      gearAttunementHealing: Number(gearSynergy.effects?.healing || 0),
      gearAttunementResourceGainPct: Number(gearSynergy.resourceGainPct || 0),
      gearAttunementCooldownRecoveryPct: Number(
        gearSynergy.cooldownRecoveryPct || 0,
      ),
      gearAttunementCritResourceGain: Number(gearSynergy.critResourceGain || 0),
      gearAttunementAbilityPowerPct: Number(gearSynergy.abilityPowerPct || 0),
      gearAttunementAbilityId: gearSynergy.abilityId || null,
    };
    const ratio = oldMaxHp > 0 ? oldHp / oldMaxHp : 1;
    p.hp = Math.min(p.maxHp, Math.max(0, Math.round(p.maxHp * ratio)));
    p.resolve = Math.min(p.maxResolve, p.resolve || p.maxResolve);
  }
  validateEquipment(p) {
    p.equipment = p.equipment || {};
    const seen = new Map();
    for (const slot of EQUIPMENT_SLOTS) {
      const id = p.equipment[slot];
      if (!id) continue;
      const def = this.def(id);
      if (!def) continue;
      const enhancement = validateEnhancements(def, this.itemization);
      const budget = validateStatBudget(def, this.itemization);
      if (!enhancement[0] || !budget[0]) {
        p.equipment[slot] = null;
        if (this.canGive(p, id, 1)) this.give(p, id, 1);
        continue;
      }
      const group = def.uniqueGroup;
      if (!group) continue;
      if (seen.has(group) && !def.generated) {
        p.equipment[slot] = null;
        if (this.canGive(p, id, 1)) this.give(p, id, 1);
      } else if (!seen.has(group) || def.generated)
        seen.set(`${group}:${def.generated ? String(id) : ""}`, id);
    }
    this.recalc(p);
    return p;
  }
  equip(p, id) {
    const it = this.def(id);
    if (!it || !this.has(p, id)) return [false, "You do not own that item."];
    if (!EQUIP_TYPES.includes(it.type))
      return [false, "That item cannot be equipped."];
    if (it.level && p.level < it.level)
      return [false, `Reach level ${it.level} to equip ${it.name}.`];
    if (it.class?.length && !it.class.includes(p.classId))
      return [false, `${it.name} is not made for your class.`];
    if (it.uniqueGroup) {
      const duplicate = this.equippedIds(p)
        .map((id) => this.def(id))
        .find((x) => x?.uniqueGroup === it.uniqueGroup && x.id !== id);
      if (duplicate && !it.generated)
        return [
          false,
          `${it.name} is unique: you cannot equip another item from ${it.uniqueGroup}.`,
        ];
    }
    const slot = this.gearSlotForItem(p, it);
    if (!slot) return [false, "That item has no valid equipment slot."];
    const old = p.equipment[slot];
    if (old === id) return [true, `${it.name} is already equipped.`];
    if (!this.remove(p, id, 1)) return [false, "You do not own that item."];
    if (old && old !== id && !this.give(p, old, 1)) {
      this.give(p, id, 1);
      return [false, "Your bag is full."];
    }
    p.equipment[slot] = id;
    this.recalc(p);
    return [true, `Equipped ${it.name} in ${slot}.`];
  }
  unequip(p, slot) {
    if (!EQUIPMENT_SLOTS.includes(slot))
      return [false, "Invalid equipment slot."];
    const old = p.equipment[slot];
    if (!old) return [false, "Nothing is equipped there."];
    if (!this.give(p, old, 1)) return [false, "Your bag is full."];
    p.equipment[slot] = null;
    this.recalc(p);
    return [true, `Unequipped ${this.def(old)?.name || old}.`];
  }
}
export { Inventory, EQUIPMENT_SLOTS };
