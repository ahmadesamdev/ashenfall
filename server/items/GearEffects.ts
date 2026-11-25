export const GEAR_EFFECT_TYPES = new Set([
  "on_cast",
  "on_hit",
  "on_crit",
  "on_heal",
  "on_kill",
  "below_health",
  "on_use",
  "always",
]);

export function collectGearEffects(p: any, items: Record<string, any> = {}) {
  const effects: any[] = [];
  const equipped = new Set(
    Object.values(p?.equipment || {})
      .filter(Boolean)
      .map(String),
  );
  for (const id of equipped) {
    const item = items[id];
    if (
      !item?.gearEffect ||
      !GEAR_EFFECT_TYPES.has(String(item.gearEffect.type))
    )
      continue;
    effects.push({ itemId: id, itemName: item.name || id, ...item.gearEffect });
  }
  return effects;
}

export function effectCooldownReady(p: any, key: string, now = Date.now()) {
  p.combat = p.combat || {};
  p.combat.gearEffectCooldowns = p.combat.gearEffectCooldowns || {};
  return Number(p.combat.gearEffectCooldowns[key] || 0) <= now;
}

export function startEffectCooldown(
  p: any,
  key: string,
  seconds: number,
  now = Date.now(),
) {
  p.combat = p.combat || {};
  p.combat.gearEffectCooldowns = p.combat.gearEffectCooldowns || {};
  p.combat.gearEffectCooldowns[key] =
    now + Math.max(0, Number(seconds || 0)) * 1000;
}

export function effectMatchesBuild(p: any, effect: any) {
  return !effect.buildId || effect.buildId === p?.activeBuildId;
}
