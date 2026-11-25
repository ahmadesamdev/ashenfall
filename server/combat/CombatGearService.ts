import {
  effectCooldownReady,
  effectMatchesBuild,
  startEffectCooldown,
} from "../items/GearEffects.js";
export class CombatGearService {
  items: Record<string, any>;
  logSynergy: (p: any, msg: string) => void;
  constructor({
    items,
    logSynergy,
  }: {
    items: Record<string, any>;
    logSynergy?: (p: any, msg: string) => void;
  }) {
    this.items = items || {};
    this.logSynergy = logSynergy || (() => {});
  }
  abilityMultiplier(p: any, id: string) {
    const attuned =
      p?.bonuses?.gearAttunementAbilityId === id
        ? Number(p?.bonuses?.gearAttunementAbilityPowerPct || 0)
        : 0;
    const setBonus = Number(p?.bonuses?.gearSetAbilityMultipliers?.[id] || 0);
    return 1 + (attuned + setBonus) / 100;
  }
  effects(p: any) {
    return (p?.bonuses?.gearEffects || []).filter((x: any) =>
      effectMatchesBuild(p, x),
    );
  }
  activeEffects(p: any, n = Date.now()) {
    return Object.values(p?.combat?.gearActiveEffects || {}).filter(
      (x: any) => Number(x?.until || 0) > n,
    ) as any[];
  }
  activeMultiplier(p: any, key: string, n = Date.now()) {
    let m = 1;
    for (const e of this.activeEffects(p, n))
      m *= 1 + Number(e?.[key] || 0) / 100;
    return m;
  }
  use(p: any, itemId: string, n = Date.now()) {
    const item = this.items[itemId];
    if (!item?.gearEffect || item.gearEffect.type !== "on_use")
      return [false, "That item has no active effect."];
    if (!Object.values(p?.equipment || {}).includes(itemId))
      return [false, "Equip the trinket before activating it."];
    const e = item.gearEffect;
    if (!effectMatchesBuild(p, e))
      return [false, "This trinket is bound to another specialization."];
    if (!effectCooldownReady(p, `use:${itemId}`, n))
      return [false, "That trinket is on cooldown."];
    p.combat = p.combat || {};
    p.combat.gearActiveEffects = p.combat.gearActiveEffects || {};
    const duration = Math.max(1, Math.min(15, Number(e.duration || 10)));
    const active = {
      id: `use:${itemId}`,
      itemId,
      itemName: item.name,
      until: n + duration * 1000,
      damagePct: Number(e.damagePct || 0),
      healingPct: Number(e.healingPct || 0),
      damageReductionPct: Number(e.damageReductionPct || 0),
      hastePct: Number(e.hastePct || 0),
    };
    p.combat.gearActiveEffects[active.id] = active;
    startEffectCooldown(
      p,
      `use:${itemId}`,
      Math.max(30, Number(e.cooldown || 60)),
      n,
    );
    this.logSynergy(p, `⚡ ${item.name} activated for ${duration}s.`);
    return [
      true,
      `${item.name} activated.`,
      { itemId, duration, until: active.until },
    ];
  }
  castCostMultiplier(p: any, a: any, n = Date.now()) {
    let m = 1;
    for (const e of this.effects(p)) {
      if (
        e.type !== "on_cast" ||
        (e.abilityId && e.abilityId !== a.id) ||
        !effectCooldownReady(p, e.id, n) ||
        Number(e.costPct || 0) === 0
      )
        continue;
      m *= Math.max(0.1, 1 + Number(e.costPct || 0) / 100);
    }
    return m;
  }
  beforeCast(p: any, a: any, target: any, n = Date.now()) {
    let powerPct = 0,
      costPct = 0;
    for (const e of this.effects(p)) {
      if (
        e.type !== "on_cast" ||
        (e.abilityId && e.abilityId !== a.id) ||
        !effectCooldownReady(p, e.id, n)
      )
        continue;
      if (e.powerPct) powerPct += Number(e.powerPct);
      if (e.costPct) costPct += Number(e.costPct);
      if (e.cooldown) startEffectCooldown(p, e.id, e.cooldown, n);
    }
    powerPct += Number(this.activeMultiplier(p, "damagePct", n) - 1) * 100;
    return { powerPct, costPct };
  }
  afterHit(p: any, a: any, target: any, result: any, n = Date.now()) {
    const triggered: any[] = [];
    for (const e of this.effects(p)) {
      const ok =
        (e.type === "on_hit" && result.damage > 0) ||
        (e.type === "on_crit" && result.crit) ||
        (e.type === "on_kill" && result.killed);
      if (!ok || !effectCooldownReady(p, e.id, n)) continue;
      if (e.resourcePct)
        p.resolve = Math.min(
          p.maxResolve,
          p.resolve + (Number(p.maxResolve || 0) * Number(e.resourcePct)) / 100,
        );
      if (e.resourceFlat)
        p.resolve = Math.min(p.maxResolve, p.resolve + Number(e.resourceFlat));
      if (e.healPct)
        p.hp = Math.min(
          p.maxHp,
          p.hp + Math.round((Number(p.maxHp || 0) * Number(e.healPct)) / 100),
        );
      if (e.nextPowerPct)
        p.combat.gearNextPowerPct = Math.max(
          Number(p.combat.gearNextPowerPct || 0),
          Number(e.nextPowerPct),
        );
      if (e.cooldown) startEffectCooldown(p, e.id, e.cooldown, n);
      triggered.push(e.id);
      this.logSynergy(p, `✨ ${e.itemName} triggered.`);
    }
    return triggered;
  }
  afterHeal(p: any, a: any, healed: number, n = Date.now()) {
    const triggered: any[] = [];
    for (const e of this.effects(p)) {
      if (
        e.type !== "on_heal" ||
        healed <= 0 ||
        !effectCooldownReady(p, e.id, n)
      )
        continue;
      if (e.resourcePct)
        p.resolve = Math.min(
          p.maxResolve,
          p.resolve + (Number(p.maxResolve || 0) * Number(e.resourcePct)) / 100,
        );
      if (e.nextPowerPct)
        p.combat.gearNextPowerPct = Math.max(
          Number(p.combat.gearNextPowerPct || 0),
          Number(e.nextPowerPct),
        );
      if (e.cooldown) startEffectCooldown(p, e.id, e.cooldown, n);
      triggered.push(e.id);
      this.logSynergy(p, `✨ ${e.itemName} triggered.`);
    }
    return triggered;
  }
  incomingMultiplier(p: any, n = Date.now()) {
    let m = this.activeMultiplier(p, "damageReductionPct", n);
    const hpPct =
      Number(p?.maxHp || 1) > 0 ? Number(p.hp || 0) / Number(p.maxHp || 1) : 1;
    for (const e of this.effects(p)) {
      if (e.type !== "below_health" || hpPct > Number(e.healthPct || 0) / 100)
        continue;
      m *=
        1 - Math.max(0, Math.min(50, Number(e.damageReductionPct || 0))) / 100;
    }
    return Math.max(0.25, m);
  }
}
